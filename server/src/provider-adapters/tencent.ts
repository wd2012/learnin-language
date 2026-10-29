import { BadGatewayException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { asr } from 'tencentcloud-sdk-nodejs-asr';
import { tts } from 'tencentcloud-sdk-nodejs-tts';
import type { SentenceRecognitionRequest, SentenceRecognitionResponse } from 'tencentcloud-sdk-nodejs-asr/tencentcloud/services/asr/v20190614/asr_models';
import type { TextToVoiceRequest, TextToVoiceResponse } from 'tencentcloud-sdk-nodejs-tts/tencentcloud/services/tts/v20190823/tts_models';
import type { AsrProvider, Audio, Language, TtsProvider } from '../providers';
import { PaidCallGate, providerCall, validText } from './policy';

export interface TencentConfig {
  secretId: string;
  secretKey: string;
  sessionToken?: string;
  region: string;
  engines: Partial<Record<Language, string>>;
  voices: Partial<Record<Language, { id: number; primaryLanguage?: 1 | 2 }>>;
}
export interface TencentTransport {
  recognize(request: SentenceRecognitionRequest, signal: AbortSignal): Promise<SentenceRecognitionResponse>;
  synthesize(request: TextToVoiceRequest, signal: AbortSignal): Promise<TextToVoiceResponse>;
}

/** Official SDK v4.1.335; TC3 signing remains entirely on the server. */
export function tencentTransport(config: TencentConfig): TencentTransport {
  const credentials = () => {
    if (!config.secretId || !config.secretKey) throw new ServiceUnavailableException('腾讯云服务端签名凭据尚未配置');
    return { secretId: config.secretId, secretKey: config.secretKey, token: config.sessionToken };
  };
  const clientConfig = () => ({
    credential: credentials(), region: config.region,
    profile: { signMethod: 'TC3-HMAC-SHA256' as const, httpProfile: { reqTimeout: 15, proxy: process.env.HTTPS_PROXY || process.env.https_proxy } },
  });
  return {
    recognize: (request, signal) => new asr.v20190614.Client(clientConfig()).request('SentenceRecognition', request, { signal }),
    synthesize: (request, signal) => new tts.v20190823.Client(clientConfig()).request('TextToVoice', request, { signal }),
  };
}

export function tencentAudioFormat(audio: Buffer): 'wav' | 'mp3' | 'aac' {
  if (!audio.length || audio.length > 2 * 1024 * 1024) throw new BadRequestException('录音大小不符合要求');
  if (audio.length >= 12 && audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (audio.length >= 3 && audio.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (audio.length >= 2 && audio[0] === 0xff) {
    if ((audio[1] & 0xf6) === 0xf0) return 'aac';
    if ((audio[1] & 0xe0) === 0xe0) return 'mp3';
  }
  throw new BadRequestException('无法确定录音编码格式');
}

export class TencentAsrProvider implements AsrProvider {
  constructor(private readonly config: TencentConfig, private readonly gate = new PaidCallGate(), private readonly transport = tencentTransport(config)) {}
  async transcribe(audio: Buffer, language: Language, signal: AbortSignal) {
    this.gate.assertAllowed(signal);
    const engine = this.config.engines[language];
    if (!engine) throw new ServiceUnavailableException(`尚未配置 ${language} ASR 引擎`);
    const request: SentenceRecognitionRequest = { EngSerViceType: engine, SourceType: 1, VoiceFormat: tencentAudioFormat(audio), Data: audio.toString('base64'), DataLen: audio.length };
    const result = await providerCall('ASR', signal, () => this.transport.recognize(request, signal));
    return { text: validText(result?.Result, 2000, 'ASR'), mock: false };
  }
}

export class TencentTtsProvider implements TtsProvider {
  constructor(private readonly config: TencentConfig, private readonly gate = new PaidCallGate(), private readonly transport = tencentTransport(config)) {}
  async synthesize(text: string, language: Language, signal: AbortSignal): Promise<Audio> {
    this.gate.assertAllowed(signal);
    const voice = this.config.voices[language];
    if (!voice || !Number.isSafeInteger(voice.id) || voice.id <= 0) throw new ServiceUnavailableException(`尚未核实并配置 ${language} TTS 音色`);
    // Conservative provider-specific limits; split/chunking requires separate review.
    if (!text.trim() || Array.from(text).length > (language === 'en' ? 500 : 150)) throw new BadRequestException('文本超过当前 TTS 单次长度限制');
    const result = await providerCall('TTS', signal, () => this.transport.synthesize({
      Text: text, SessionId: randomUUID(), VoiceType: voice.id, Codec: 'wav', SampleRate: 16000,
      ...(voice.primaryLanguage === undefined ? {} : { PrimaryLanguage: voice.primaryLanguage }),
    }, signal));
    const base64 = result?.Audio;
    if (typeof base64 !== 'string' || !base64 || base64.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0)
      throw new BadGatewayException('TTS 返回音频无效');
    const wav = Buffer.from(base64, 'base64');
    if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new BadGatewayException('TTS 返回音频不是 WAV');
    try {
      const { parseBuffer } = await import('music-metadata');
      const metadata = await parseBuffer(new Uint8Array(wav), { mimeType: 'audio/wav' });
      if (!metadata.format.duration || !Number.isFinite(metadata.format.duration) || metadata.format.duration > 120) throw new Error('duration');
    } catch { throw new BadGatewayException('TTS 返回音频不可解析或时长无效'); }
    return { audioBase64: base64, mimeType: 'audio/wav', kind: 'speech', mock: false };
  }
}

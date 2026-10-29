import { BadRequestException, GatewayTimeoutException, Injectable } from '@nestjs/common';
import { AsrProvider, LlmProvider, TtsProvider } from './providers';
import { TurnDto, SynthesizeDto } from './dto';
import { Operation, Quantities, UsageService } from './usage';
import { Settings } from './config';

@Injectable()
export class PracticeService {
  constructor(
    private readonly asr: AsrProvider, private readonly llm: LlmProvider, private readonly tts: TtsProvider,
    private readonly usage: UsageService, private readonly config: Settings,
  ) {}
  private async run<T>(operation: Operation, action: (signal: AbortSignal) => Promise<T>, measure: (result: T) => Partial<Quantities> = () => ({})) {
    const settle = this.usage.reserve(operation);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => action(controller.signal)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new GatewayTimeoutException('Provider 超时，请手动重试')); }, this.config.providerTimeoutMs); }),
      ]);
      settle(true, measure(result));
      return { ...result, usage: this.usage.snapshot() };
    } catch (error) { settle(false); throw error; }
    finally { clearTimeout(timer); }
  }
  async transcribe(file: Express.Multer.File | undefined, language: 'en' | 'ja') {
    if (!file || !file.size || file.size > 2 * 1024 * 1024) throw new BadRequestException('请上传 1 字节到 2 MiB 的录音');
    // Check magic bytes too; MIME and extension alone are untrusted.
    const b = file.buffer;
    const wav = b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE';
    const mp3 = b.length >= 3 && (b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));
    const aac = b.length >= 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0;
    if (!(wav || mp3 || aac) || !['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/aac', 'application/octet-stream'].includes(file.mimetype))
      throw new BadRequestException('仅支持 MP3、WAV、AAC 录音');
    let durationMs: number;
    try {
      const { parseBuffer } = await import('music-metadata');
      const metadata = await parseBuffer(new Uint8Array(b), { mimeType: wav ? 'audio/wav' : aac ? 'audio/aac' : 'audio/mpeg' }, { duration: true });
      durationMs = Math.round((metadata.format.duration ?? 0) * 1000);
      // Allow 100 ms of encoder padding for a 60-second recording.
      if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 60100) throw new Error('duration');
    } catch { throw new BadRequestException('录音不可解析或时长超过60秒'); }
    return this.run('asr', signal => this.asr.transcribe(b, language, signal), () => ({ asrDurationMs: durationMs }));
  }
  turn(input: TurnDto) {
    if (!input.text.trim() || input.history.some(message => !message.text.trim())) throw new BadRequestException('内容不能为空白');
    const estimate = (text: string) => Math.ceil(Array.from(text).length / (input.language === 'en' ? 4 : 1));
    return this.run('llm', signal => this.llm.reply(input, signal), reply => ({
      llmInputTokensEstimate: estimate(input.text + input.history.map(message => message.text).join('')),
      llmOutputTokensEstimate: estimate(reply.text + Object.values(reply.feedback).join('')),
    }));
  }
  synthesize(input: SynthesizeDto) {
    if (!input.text.trim()) throw new BadRequestException('内容不能为空白');
    return this.run('tts', signal => this.tts.synthesize(input.text, input.language, signal), () => ({ ttsCharacters: Array.from(input.text).length }));
  }
}

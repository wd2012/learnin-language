import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { AsrProvider, Language, LlmProvider, Message, Scene, TtsProvider } from '../providers';
import { tencentAudioFormat } from './tencent';

export interface Prices {
  asrMicrosPerSecond: Record<Language, number>;
  ttsMicrosPerCharacter: Record<Language, number>;
  llmInputMicrosPerToken: number;
  llmOutputMicrosPerToken: number;
}
export interface VerificationCase { language: Language; scene: Scene; audio: { bytes: Buffer; durationMs: number }[] }
export interface VerificationPlan { prices: Prices; cases: VerificationCase[] }
export interface VerificationEvent { language: Language; round: number; stage: 'asr' | 'llm' | 'tts'; status: 'reserved' | 'completed'; upperEstimateMicros: number; latencyMs?: number; inputTokens?: number; outputTokens?: number }
export interface VerificationOutput {
  event(event: VerificationEvent): void;
  turn(language: Language, round: number, transcript: string, reply: Awaited<ReturnType<LlmProvider['reply']>>, audioBase64: string): void;
}

function positive(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1000000) throw new Error(`请配置并核实官方单价：${label}`);
  return value;
}

/** Reading fixtures and preparing a plan never uses credentials or a network. */
export async function readVerificationPlan(manifestPath: string): Promise<VerificationPlan> {
  if (readFileSync(manifestPath).length > 65536) throw new Error('验证清单过大');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const prices: Prices = {
    asrMicrosPerSecond: { en: positive(manifest.prices?.asrMicrosPerSecond?.en, '英语ASR/秒'), ja: positive(manifest.prices?.asrMicrosPerSecond?.ja, '日语ASR/秒') },
    ttsMicrosPerCharacter: { en: positive(manifest.prices?.ttsMicrosPerCharacter?.en, '英语TTS/字符'), ja: positive(manifest.prices?.ttsMicrosPerCharacter?.ja, '日语TTS/字符') },
    llmInputMicrosPerToken: positive(manifest.prices?.llmInputMicrosPerToken, 'LLM输入/Token'),
    llmOutputMicrosPerToken: positive(manifest.prices?.llmOutputMicrosPerToken, 'LLM输出/Token'),
  };
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== 2 || !['en', 'ja'].every(language => manifest.cases.some((item: { language?: string }) => item.language === language))) throw new Error('清单须包含英语和日语各一组');
  const { parseBuffer } = await import('music-metadata');
  const cases: VerificationCase[] = [];
  for (const item of manifest.cases) {
    if (!['interview', 'daily'].includes(item.scene) || !Array.isArray(item.audioFiles) || item.audioFiles.length !== 5) throw new Error('每种语言须提供5个音频和有效场景');
    const audio: VerificationCase['audio'] = [];
    for (const file of item.audioFiles) {
      if (typeof file !== 'string') throw new Error('录音路径无效');
      const bytes = readFileSync(resolve(dirname(manifestPath), file));
      if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('验证录音须为1字节到2MiB');
      tencentAudioFormat(bytes);
      const metadata = await parseBuffer(new Uint8Array(bytes), undefined, { duration: true });
      const durationMs = Math.ceil((metadata.format.duration ?? 0) * 1000);
      if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 10000) throw new Error('付费验证仅接受不超过10秒的短录音');
      audio.push({ bytes, durationMs });
    }
    cases.push({ language: item.language, scene: item.scene, audio });
  }
  return { prices, cases };
}

/** Conservative local estimates, not a promise of the provider's eventual bill. */
export class VerificationBudget {
  usedMicros = 0;
  constructor(readonly limitMicros: number) {
    if (!Number.isSafeInteger(limitMicros) || limitMicros <= 0 || limitMicros > 5000000) throw new Error('本次验证预算必须大于0且不超过5元');
  }
  reserve(upperEstimateMicros: number) {
    if (!Number.isSafeInteger(upperEstimateMicros) || upperEstimateMicros <= 0 || this.usedMicros + upperEstimateMicros > this.limitMicros) throw new Error('达到本次验证估算预算，停止后续调用');
    this.usedMicros += upperEstimateMicros;
    // No refund on errors: a failed/aborted upstream call may still be billed.
  }
}

export async function verifyPipeline(
  plan: VerificationPlan,
  providers: { asr: AsrProvider; llm: LlmProvider; tts: TtsProvider },
  budget: VerificationBudget,
  output: VerificationOutput,
  signal: AbortSignal,
) {
  for (const scenario of plan.cases) {
    const history: Message[] = [];
    for (let index = 0; index < scenario.audio.length; index++) {
      const round = index + 1;
      const run = async <T>(stage: VerificationEvent['stage'], estimate: number, action: (callSignal: AbortSignal) => Promise<T>): Promise<T> => {
        signal.throwIfAborted();
        const upperEstimateMicros = Math.ceil(estimate);
        budget.reserve(upperEstimateMicros);
        // Persist the reservation before dispatch; an interrupted report is not a free retry.
        output.event({ language: scenario.language, round, stage, status: 'reserved', upperEstimateMicros });
        const start = Date.now();
        const result = await action(AbortSignal.any([signal, AbortSignal.timeout(20000)]));
        const usage = stage === 'llm' ? (result as Awaited<ReturnType<LlmProvider['reply']>>).providerUsage : undefined;
        output.event({ language: scenario.language, round, stage, status: 'completed', upperEstimateMicros, latencyMs: Date.now() - start,
          ...(usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : {}) });
        return result;
      };
      const sample = scenario.audio[index];
      // Round up to a full minute to cover common ASR billing granularity.
      const transcript = await run('asr', Math.ceil(sample.durationMs / 60000) * 60 * plan.prices.asrMicrosPerSecond[scenario.language], callSignal => providers.asr.transcribe(sample.bytes, scenario.language, callSignal));
      if (transcript.mock) throw new Error('真实验证不能使用Mock转写');
      // UTF-8 byte count plus a generous system/chat overhead; verify against the
      // chosen model's actual tokenizer/pricing before a paid run.
      const inputUpperTokens = Buffer.byteLength(JSON.stringify({ text: transcript.text, history }), 'utf8') + 4096;
      const reply = await run('llm', inputUpperTokens * plan.prices.llmInputMicrosPerToken + 1024 * plan.prices.llmOutputMicrosPerToken,
        callSignal => providers.llm.reply({ language: scenario.language, scene: scenario.scene, text: transcript.text, history }, callSignal));
      if (!reply.providerUsage) throw new Error('缺少实际LLM用量，停止验证并核对账单');
      if (reply.mock || reply.providerUsage.inputTokens > inputUpperTokens || reply.providerUsage.outputTokens > 1024) throw new Error('模型模式或实际Token超过估算边界，停止并核对账单');
      const audio = await run('tts', Math.max(1, Array.from(reply.text).length) * plan.prices.ttsMicrosPerCharacter[scenario.language], callSignal => providers.tts.synthesize(reply.text, scenario.language, callSignal));
      if (audio.mock || audio.kind !== 'speech') throw new Error('真实验证不能使用Mock提示音');
      output.turn(scenario.language, round, transcript.text, reply, audio.audioBase64);
      history.push({ role: 'user', text: transcript.text }, { role: 'assistant', text: reply.text });
    }
  }
}

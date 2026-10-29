import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MockTtsProvider } from '../src/providers';
import { CompatibleLlmProvider, compatibleTransport } from '../src/provider-adapters/llm';
import { PaidCallGate } from '../src/provider-adapters/policy';
import { TencentAsrProvider, TencentConfig, TencentTransport, TencentTtsProvider } from '../src/provider-adapters/tencent';
import { realProviderConfig } from '../src/provider-adapters/config';
import { readVerificationPlan, VerificationBudget, VerificationEvent, VerificationPlan, verifyPipeline } from '../src/provider-adapters/verification';
import { verifyMain } from '../src/provider-adapters/verify-main';

const signal = () => new AbortController().signal;
const prices = { asrMicrosPerSecond: { en: 1, ja: 1 }, ttsMicrosPerCharacter: { en: 1, ja: 1 }, llmInputMicrosPerToken: 1, llmOutputMicrosPerToken: 1 };
const config: TencentConfig = { secretId: 'test-only', secretKey: 'test-only', region: 'test-only', engines: { en: '16k_en', ja: '16k_ja' }, voices: { en: { id: 1 }, ja: { id: 2 } } };

async function fixture() {
  const audio = await new MockTtsProvider().synthesize('', 'en', signal());
  const bytes = Buffer.from(audio.audioBase64, 'base64');
  const plan: VerificationPlan = { prices, cases: ['en', 'ja'].map(language => ({ language: language as 'en' | 'ja', scene: 'daily', audio: Array.from({ length: 5 }, () => ({ bytes, durationMs: 250 })) })) };
  return { audio, plan };
}

test('actual adapter classes complete offline English/Japanese five-round ASR→LLM→TTS pipelines', async () => {
  const { audio, plan } = await fixture();
  let asrCalls = 0, llmCalls = 0, ttsCalls = 0;
  const transport: TencentTransport = {
    async recognize(request) { asrCalls++; return { Result: request.EngSerViceType === '16k_en' ? 'I learn English.' : '日本語を勉強しています。' }; },
    async synthesize() { ttsCalls++; return { Audio: audio.audioBase64 }; },
  };
  const gate = new PaidCallGate(true);
  const llm = new CompatibleLlmProvider({ apiKey: 'test-only', endpoint: 'https://invalid.example', model: 'test-only', maxTokens: 512 }, gate, {
    async complete(request) {
      llmCalls++;
      assert.equal((request.messages.length - 2) % 2, 0);
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: request.messages[0].content.includes('Japanese') ? '今日は何をしましたか。' : 'What did you learn?', feedback: { correction: '示例', naturalRewrite: '示例', example: '示例', explanation: '示例', encouragement: '示例' } }) } }], usage: { prompt_tokens: 40, completion_tokens: 60 } };
    },
  });
  const events: VerificationEvent[] = [];
  const turns: string[] = [];
  const budget = new VerificationBudget(5000000);
  await verifyPipeline(plan, { asr: new TencentAsrProvider(config, gate, transport), llm, tts: new TencentTtsProvider(config, gate, transport) }, budget, {
    event: event => events.push(event),
    turn: (language, round, transcript, reply, audioBase64) => {
      turns.push(`${language}-${round}`); assert(transcript); assert(!reply.mock); assert.equal(audioBase64, audio.audioBase64);
    },
  }, signal());
  assert.deepEqual([asrCalls, llmCalls, ttsCalls], [10, 10, 10]);
  assert.equal(turns.length, 10); assert(turns.includes('en-5') && turns.includes('ja-5'));
  assert.equal(events.filter(event => event.status === 'reserved').length, 30);
  assert.equal(events.filter(event => event.status === 'completed').length, 30);
  assert(budget.usedMicros > 0 && budget.usedMicros <= 5000000);
});

test('verification stops before exceeding estimates and never refunds unknown billed failures', async () => {
  const { plan } = await fixture();
  let calls = 0;
  const budget = new VerificationBudget(59); // One ASR reserves at least a billed minute (60).
  const providers = {
    asr: { transcribe: async () => { calls++; return { text: 'test', mock: false }; } },
    llm: { reply: async () => { throw new Error('must not run'); } },
    tts: { synthesize: async () => { throw new Error('must not run'); } },
  };
  await assert.rejects(verifyPipeline(plan, providers, budget, { event: () => undefined, turn: () => undefined }, signal()), /预算/);
  assert.equal(calls, 0);
  const failedBudget = new VerificationBudget(5000000);
  const events: VerificationEvent[] = [];
  providers.asr.transcribe = async () => { calls++; throw new Error('test failure'); };
  await assert.rejects(verifyPipeline(plan, providers, failedBudget, { event: event => events.push(event), turn: () => undefined }, signal()), /test failure/);
  assert.equal(calls, 1); assert.equal(failedBudget.usedMicros, 60); assert.equal(events.length, 1);
  assert.equal(events[0].status, 'reserved');
});

test('manifest and CLI dry-run validate local fixtures and prices without credentials or paid calls', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'linguapath-plan-'));
  const originalLog = console.log;
  const logs: string[] = [];
  try {
    const { audio } = await fixture();
    writeFileSync(join(directory, 'sample.wav'), Buffer.from(audio.audioBase64, 'base64'));
    const manifest = { prices, cases: ['en', 'ja'].map(language => ({ language, scene: 'daily', audioFiles: Array(5).fill('sample.wav') })) };
    const file = join(directory, 'plan.json'); writeFileSync(file, JSON.stringify(manifest));
    const plan = await readVerificationPlan(file); assert.equal(plan.cases[0].audio.length, 5);
    console.log = value => logs.push(String(value));
    await verifyMain(['--manifest', file, '--budget-cny', '5', '--dry-run']);
    assert.equal(JSON.parse(logs[0]).paidCalls, 0);
    assert.equal(JSON.parse(logs[0]).plannedCalls, 30);
    await assert.rejects(verifyMain(['--manifest', file, '--budget-cny', '5']), /allow-paid/);
    await assert.rejects(verifyMain(['--manifest', file, '--budget-cny', '6', '--dry-run']), /不超过5元/);
    manifest.prices.asrMicrosPerSecond.en = 0;
    writeFileSync(file, JSON.stringify(manifest)); await assert.rejects(readVerificationPlan(file), /单价/);
    assert(readFileSync(join(directory, 'sample.wav')).length > 0);
  } finally { console.log = originalLog; rmSync(directory, { recursive: true, force: true }); }
});

test('configuration errors reveal variable names only; non-TLS or unapproved LLM hosts are rejected before network', async () => {
  assert.throws(() => realProviderConfig({}), /TENCENT_SECRET_ID/);
  for (const endpoint of ['http://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'https://invalid.example/compatible-mode/v1/chat/completions', 'https://user:password@dashscope.aliyuncs.com/compatible-mode/v1/chat/completions']) {
    await assert.rejects(compatibleTransport({ apiKey: 'test-only', endpoint, model: 'test-only', maxTokens: 1 }).complete({ model: 'test-only', messages: [], max_tokens: 1, stream: false, response_format: { type: 'json_object' } }, signal()), /地址/);
  }
});

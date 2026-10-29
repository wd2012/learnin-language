import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app';
import { Settings, settings } from '../src/config';
import { MockAsrProvider, MockLlmProvider, MockTtsProvider } from '../src/providers';
import { PracticeService } from '../src/practice.service';
import { RateLimiter, SessionService } from '../src/security';
import { UsageService } from '../src/usage';

const config: Settings = { monthlyBudgetMicros: 5000, requestsPerMinute: 2, providerTimeoutMs: 20 };

test('budget reservations are atomic, failed work rolls back, and Shanghai month resets', () => {
  let now = Date.parse('2026-10-31T15:59:59Z');
  const usage = new UsageService(config, () => now);
  const finish = usage.reserve('llm');
  const finish2 = usage.reserve('llm');
  assert.throws(() => usage.reserve('llm'), /模拟预算/);
  finish(true); finish(true); // idempotent settlement
  finish2(false);
  assert.equal(usage.snapshot().simulatedCostMicros, 2000);
  assert.equal(usage.snapshot().failed, 1);
  assert.equal(usage.snapshot().reservedMicros, 0);
  usage.reserve('llm')(true);
  assert.equal(usage.snapshot().reminder, 'warning');
  usage.reserve('tts')(true);
  assert.equal(usage.snapshot().reminder, 'exhausted');
  now += 2000;
  assert.equal(usage.snapshot().month, '2026-11');
  assert.equal(usage.snapshot().simulatedCostMicros, 0);
  assert.equal(usage.snapshot().actualCostMicros, 0);
});

test('session expiry and rate windows use the server clock', () => {
  let now = 1000;
  const sessions = new SessionService(() => now);
  const session = sessions.create();
  sessions.verify(`Bearer ${session.token}`);
  assert.throws(() => sessions.verify('Bearer invalid'));
  const limiter = new RateLimiter(config, () => now);
  limiter.consume(); limiter.consume();
  assert.throws(() => limiter.consume(), /过于频繁/);
  now += 60000;
  limiter.consume();
  now += 3600000;
  assert.throws(() => sessions.verify(`Bearer ${session.token}`), /过期/);
});

test('provider timeout aborts work and releases simulated budget', async () => {
  const usage = new UsageService(config);
  let aborted = false;
  const service = new PracticeService(new MockAsrProvider(), {
    reply: (_input, signal) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); }),
  }, new MockTtsProvider(), usage, config);
  await assert.rejects(service.turn({ language: 'en', scene: 'interview', text: 'Hello', history: [] }), /超时/);
  assert(aborted);
  assert.equal(usage.snapshot().reservedMicros, 0);
  assert.equal(usage.snapshot().simulatedCostMicros, 0);
  assert.equal(usage.snapshot().failed, 1);
});

test('provider errors roll back usage and successful manual retry is counted once', async () => {
  const usage = new UsageService(config);
  let calls = 0;
  const mock = new MockLlmProvider();
  const service = new PracticeService(new MockAsrProvider(), {
    async reply(input, signal) { if (++calls === 1) throw new Error('Mock unavailable'); return mock.reply(input, signal); },
  }, new MockTtsProvider(), usage, config);
  const input = { language: 'ja' as const, scene: 'daily' as const, text: 'こんにちは', history: [] };
  await assert.rejects(service.turn(input), /unavailable/);
  assert.equal(calls, 1);
  await service.turn(input);
  assert.equal(usage.snapshot().operations.llm, 1);
  assert.equal(usage.snapshot().failed, 1);
});

test('only development Mock providers can be activated', () => {
  const mode = process.env.PROVIDER_MODE;
  const nodeEnv = process.env.NODE_ENV;
  try {
    process.env.PROVIDER_MODE = 'paid';
    assert.throws(settings, /Only mock/);
    process.env.PROVIDER_MODE = 'mock'; process.env.NODE_ENV = 'production';
    assert.throws(settings, /development-only/);
  } finally {
    if (mode === undefined) delete process.env.PROVIDER_MODE; else process.env.PROVIDER_MODE = mode;
    if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
  }
});

test('HTTP: both languages complete five ASR → LLM → TTS rounds; rejects invalid requests', async () => {
  process.env.REQUESTS_PER_MINUTE = '1000';
  const app = await createApp();
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const json = async (path: string, data?: unknown, token = '') => fetch(base + '/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    assert.equal((await json('/usage')).status, 401);
    const session = await (await json('/session', {})).json() as { token: string };
    const token = session.token;
    assert(token.length >= 64);
    const upload = (blob: Blob, language = 'en') => {
      const form = new FormData(); form.append('language', language); form.append('audio', blob, 'practice.wav');
      return fetch(base + '/api/speech/transcribe', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    };
    const audio = await new MockTtsProvider().synthesize('', 'en', new AbortController().signal);
    const wav = Buffer.from(audio.audioBase64, 'base64');
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    const blob = new Blob([new Uint8Array(wav)], { type: 'audio/wav' });
    for (const language of ['en', 'ja'] as const) {
      const history: { role: 'user' | 'assistant'; text: string }[] = [];
      const questions = new Set<string>();
      for (let round = 0; round < 5; round++) {
        const asrResponse = await upload(blob, language);
        assert.equal(asrResponse.status, 201);
        const transcript = await asrResponse.json() as { text: string; mock: boolean };
        assert.equal(transcript.mock, true);
        assert(language === 'en' ? transcript.text.includes('React') : transcript.text.includes('日本語'));
        const response = await json('/conversation/turn', { language, scene: language === 'en' ? 'interview' : 'daily', text: transcript.text, history }, token);
        assert.equal(response.status, 201);
        const reply = await response.json() as { text: string; feedback: { explanation: string }; mock: boolean };
        assert.equal(reply.mock, true);
        assert(reply.feedback.explanation.includes(`第 ${round + 1} 轮`));
        questions.add(reply.text);
        history.push({ role: 'user', text: transcript.text }, { role: 'assistant', text: reply.text });
        const ttsResponse = await json('/speech/synthesize', { language, text: reply.text }, token);
        assert.equal(ttsResponse.status, 201);
        const tts = await ttsResponse.json() as { kind: string; audioBase64: string };
        assert.equal(tts.kind, 'mock-tone');
        assert(Buffer.from(tts.audioBase64, 'base64').equals(wav));
      }
      assert.equal(questions.size, 5);
    }
    const statsResponse = await json('/usage', undefined, token);
    assert.equal(statsResponse.headers.get('cache-control'), 'no-store');
    const stats = await statsResponse.json() as { actualCostMicros: number; simulatedCostMicros: number; operations: unknown; currency: string; quantities: { asrDurationMs: number; llmInputTokensEstimate: number; llmOutputTokensEstimate: number; ttsCharacters: number } };
    assert.equal(stats.actualCostMicros, 0);
    assert.equal(stats.simulatedCostMicros, 40000);
    assert.deepEqual(stats.operations, { asr: 10, llm: 10, tts: 10 });
    assert.equal(stats.currency, 'CNY');
    assert.equal(stats.quantities.asrDurationMs, 2500);
    assert(stats.quantities.llmInputTokensEstimate > 0);
    assert(stats.quantities.llmOutputTokensEstimate > 0);
    assert(stats.quantities.ttsCharacters > 0);
    const input = { language: 'en', scene: 'interview', text: 'hello', history: [] };
    for (const invalid of [
      { ...input, language: 'fr' }, { ...input, scene: 'unknown' }, { ...input, text: ' ' },
      { ...input, history: [{ role: 'system', text: 'bad' }] }, { ...input, history: Array(21).fill({ role: 'user', text: 'x' }) },
      { ...input, text: 'x'.repeat(2001) }, { ...input, apiKey: 'not-a-secret' }, {},
    ]) assert.equal((await json('/conversation/turn', invalid, token)).status, 400);
    assert.equal((await upload(new Blob(['invalid'], { type: 'audio/wav' }))).status, 400);
    assert.equal((await upload(new Blob([]))).status, 400);
    assert.equal((await upload(blob, 'fr')).status, 400);
    assert.equal((await upload(new Blob([new Uint8Array(wav)], { type: 'text/plain' }))).status, 400);
    assert.equal((await upload(new Blob(['ID3invalid'], { type: 'audio/mpeg' }))).status, 400);
    const longWav = Buffer.alloc(44 + 61 * 32000);
    wav.copy(longWav, 0, 0, 44); longWav.writeUInt32LE(longWav.length - 8, 4); longWav.writeUInt32LE(longWav.length - 44, 40);
    assert.equal((await upload(new Blob([new Uint8Array(longWav)], { type: 'audio/wav' }))).status, 400);
    assert.equal((await upload(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'audio/wav' }))).status, 413);
    assert.equal((await json('/conversation/turn', { ...input, text: 'x'.repeat(70000) }, token)).status, 413);
    const after = await (await json('/usage', undefined, token)).json() as { simulatedCostMicros: number };
    assert.equal(after.simulatedCostMicros, 40000);
  } finally { await app.close(); delete process.env.REQUESTS_PER_MINUTE; }
});

test('HTTP: aggregate limiter includes session creation and returns Retry-After', async () => {
  process.env.REQUESTS_PER_MINUTE = '2';
  const app = await createApp();
  try {
    await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
    assert.equal((await fetch(base + '/api/session', { method: 'POST' })).status, 201);
    assert.equal((await fetch(base + '/api/usage')).status, 401);
    const limited = await fetch(base + '/api/session', { method: 'POST' });
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60');
  } finally { await app.close(); delete process.env.REQUESTS_PER_MINUTE; }
});

test('HTTP: monthly warning and budget exhaustion are enforced on the server', async () => {
  process.env.MOCK_MONTHLY_BUDGET_MICROS = '5000';
  const app = await createApp();
  try {
    await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
    const session = await (await fetch(base + '/api/session', { method: 'POST' })).json() as { token: string };
    const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    const send = () => fetch(base + '/api/conversation/turn', { method: 'POST', headers, body: JSON.stringify({ language: 'ja', scene: 'daily', text: 'こんにちは', history: [] }) });
    assert.equal((await send()).status, 201);
    const second = await (await send()).json() as { usage: { reminder: string } };
    assert.equal(second.usage.reminder, 'warning');
    assert.equal((await send()).status, 429);
    const usage = await (await fetch(base + '/api/usage', { headers })).json() as { simulatedCostMicros: number; reservedMicros: number };
    assert.equal(usage.simulatedCostMicros, 4000); assert.equal(usage.reservedMicros, 0);
  } finally { await app.close(); delete process.env.MOCK_MONTHLY_BUDGET_MICROS; }
});

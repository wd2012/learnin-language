const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Run the actual service/hook modules against a deterministic mini-program API
// double; these tests make no network requests and do not claim device coverage.
function modules(taro, react = {}) {
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(__dirname, '..', filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const localRequire = name => {
      if (name === '@tarojs/taro') return taro;
      if (name === 'react') return react;
      if (name.startsWith('.')) return load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(filename), name + '.ts')));
      throw new Error('Unexpected dependency: ' + name);
    };
    vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})', { filename })(localRequire, module, module.exports);
    return module.exports;
  }
  return load;
}

test('client connects using an in-memory session, preserves language/scene, bounds context, and sends multipart audio', async () => {
  const calls = [];
  const taro = {
    request: async options => {
      calls.push(options);
      return { statusCode: options.url.endsWith('/session') ? 201 : 200, data: options.url.endsWith('/session') ? { token: 'test-session' } : { mock: true } };
    },
    uploadFile: async options => { calls.push(options); return { statusCode: 201, data: JSON.stringify({ text: '演示', mock: true }) }; },
  };
  const { ConversationClient } = modules(taro)('src/services/conversation.ts');
  const client = new ConversationClient();
  await client.connect();
  await client.turn('ja', 'daily', 'こんにちは', Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: String(i) })));
  await client.transcribe('ja', 'wxfile://temporary.mp3');
  assert.equal(calls[1].header.Authorization, 'Bearer test-session');
  assert.equal(calls[2].data.language, 'ja');
  assert.equal(calls[2].data.scene, 'daily');
  assert.equal(calls[2].data.history.length, 20);
  assert.equal(calls[2].data.history[0].text, '4');
  assert.equal(calls[3].name, 'audio');
  assert.deepEqual(calls[3].formData, { language: 'ja' });
  assert.equal(calls[3].header['Content-Type'], undefined);
  assert.equal(calls[3].timeout, 10000);
});

test('client surfaces expiry, rate limits and malformed responses without automatically retrying', async () => {
  let requests = 0;
  let status = 401;
  const taro = {
    request: async () => { requests++; return { statusCode: status, data: { message: '请求过于频繁' } }; },
    uploadFile: async () => ({ statusCode: 500, data: '<html>error</html>' }),
  };
  const { ConversationClient } = modules(taro)('src/services/conversation.ts');
  const client = new ConversationClient();
  await assert.rejects(client.usage(), /会话过期/);
  status = 429;
  await assert.rejects(client.usage(), /过于频繁/);
  assert.equal(requests, 2);
  await assert.rejects(client.transcribe('en', 'temp'), /格式错误/);
});

function audioDouble() {
  const handlers = {};
  const deleted = [], played = [];
  let starts = 0, stops = 0, destroyed = 0;
  const recorder = { onStop: fn => { assert(!handlers.stop); handlers.stop = fn; }, onError: fn => { assert(!handlers.error); handlers.error = fn; },
    start: () => { starts++; }, stop: () => { stops++; } };
  const player = { src: '', stop: () => undefined, play() { played.push(this.src); }, destroy: () => { destroyed++; }, onError: fn => { handlers.audioError = fn; }, offError: () => undefined };
  const taro = {
    getRecorderManager: () => recorder, createInnerAudioContext: () => player,
    getFileSystemManager: () => ({ unlink: options => { deleted.push(options.filePath); }, writeFile: options => options.success() }),
    authorize: async () => undefined, env: { USER_DATA_PATH: '/sandbox' },
    useDidHide: fn => { handlers.hide = fn; }, useDidShow: fn => { handlers.show = fn; },
  };
  return { taro, handlers, deleted, played, starts: () => starts, stops: () => stops, destroyed: () => destroyed };
}

test('shared recorder has one listener set and drains late stop events before accepting another page', () => {
  const audio = audioDouble();
  const { recordingSession } = modules(audio.taro)('src/services/recorder.ts');
  let deliveries = 0;
  const first = recordingSession(() => { deliveries++; }, () => undefined);
  const second = recordingSession(() => { deliveries++; }, () => undefined);
  first.start(); first.release();
  assert.throws(() => second.start(), /正在结束/);
  audio.handlers.stop({ tempFilePath: 'orphan.mp3', duration: 500 });
  assert.equal(deliveries, 0);
  assert.deepEqual(audio.deleted, ['orphan.mp3']);
  second.start();
  audio.handlers.stop({ tempFilePath: 'second.mp3', duration: 500 });
  assert.equal(deliveries, 1);
  assert.equal(audio.starts(), 2);
});

function hookHarness(audio) {
  const slots = [];
  const effects = [];
  let cursor = 0;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect) { const i = cursor++; if (!(i in slots)) { slots[i] = true; effects.push(effect()); } },
  };
  const { usePracticeAudio } = modules(audio.taro, react)('src/hooks/usePracticeAudio.ts');
  return { render() { cursor = 0; return usePracticeAudio(); }, unmount() { effects.forEach(cleanup => cleanup?.()); } };
}

test('audio hook handles permission denial and cleans recordings/player on hide and unmount', async () => {
  const audio = audioDouble();
  const harness = hookHarness(audio);
  let state = harness.render();
  audio.taro.authorize = async () => { throw new Error('permission denied'); };
  await state.start();
  state = harness.render();
  assert.match(state.error, /麦克风权限/); assert.equal(audio.starts(), 0);
  audio.taro.authorize = async () => undefined;
  await state.start();
  assert.equal(audio.starts(), 1);
  audio.handlers.stop({ tempFilePath: 'local.mp3', duration: 500 });
  state = harness.render();
  assert.equal(state.file, 'local.mp3');
  state.replay(); assert.deepEqual(audio.played, ['local.mp3']);
  await state.playTone('base64');
  assert.equal(audio.played.length, 2);
  audio.handlers.hide();
  assert(audio.deleted.includes('local.mp3'));
  assert(audio.deleted.some(file => file.endsWith('.wav')));
  await state.playTone('base64');
  assert.equal(audio.played.length, 2); // no background playback
  harness.unmount();
  assert.equal(audio.destroyed(), 1);
});

test('audio hook discards a late temporary file after page unmount', async () => {
  const audio = audioDouble(); const harness = hookHarness(audio);
  const state = harness.render(); await state.start(); harness.unmount();
  assert(audio.stops() >= 1);
  audio.handlers.stop({ tempFilePath: 'late.mp3', duration: 500 });
  assert(audio.deleted.includes('late.mp3'));
});

test('audio hook does not start recording after permission resolves on a hidden page', async () => {
  const audio = audioDouble();
  let allow;
  audio.taro.authorize = () => new Promise(resolve => { allow = resolve; });
  const harness = hookHarness(audio); const state = harness.render();
  const starting = state.start(); audio.handlers.hide(); allow(); await starting;
  assert.equal(audio.starts(), 0); harness.unmount();
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'audio.js'), 'utf8');

// Minimal Web Audio fake that records nodes and lifecycle calls.
function makeEnv({ withAudio = true, fetchFail = false, embedded = false } = {}) {
  const log = { ticks: [], ctx: null, oscillators: [], gains: [], buffers: [], sources: [], contexts: 0, resumes: 0, fetches: [], filters: [] };
  const param = () => ({ value: 0, ramps: [], targets: [], setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime(v) { this.ramps.push(v); }, setTargetAtTime(v) { this.targets.push(v); }, cancelScheduledValues() {} });
  const node = extra => Object.assign({ connect() {}, disconnect() { this.disconnected = true; }, start() { this.started = true; }, stop() { this.stopped = true; } }, extra);
  class FakeContext {
    constructor() { log.contexts++; log.ctx = this; this.currentTime = 0; this.sampleRate = 8000; this.state = 'suspended'; this.destination = {}; }
    resume() { log.resumes++; this.state = 'running'; return Promise.resolve(); }
    createOscillator() { const o = node({ type: 'sine', frequency: param(), detune: param(), starts: [] }); o.start = function (t) { this.started = true; this.starts.push(t); }; log.oscillators.push(o); return o; }
    createBiquadFilter() { const f = node({ frequency: param(), Q: param() }); log.filters.push(f); return f; }
    createDelay() { return node({ delayTime: param() }); }
    createGain() { const g = node({ gain: param() }); log.gains.push(g); return g; }
    createBuffer(ch, len) { const d = new Float32Array(len); const b = { length: len, getChannelData: () => d }; log.buffers.push(b); return b; }
    decodeAudioData() { return Promise.resolve({ duration: 1.5, kind: 'voice', numberOfChannels: 1, getChannelData: () => new Float32Array([0.1, -0.05]) }); }
    createBufferSource() { const s = node({}); log.sources.push(s); return s; }
  }
  const intervals = new Set();
  const sandbox = {
    setInterval: fn => { const id = intervals.size + 1; intervals.add(id); log.ticks.push(fn); return id; },
    clearInterval: id => intervals.delete(id),
    Math, Float32Array, Promise,
    fetch: url => { log.fetches.push(url); return fetchFail ? Promise.reject(new Error('offline')) :
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); }
  };
  if (embedded) sandbox.atob = atob;
  if (withAudio) sandbox.AudioContext = FakeContext;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { win: sandbox, log, intervals };
}

test('loading starts no sound and exposes the API', () => {
  const { win, log } = makeEnv();
  for (const n of ['playClick', 'playSiren', 'stopSiren', 'playStatic', 'startBGM', 'stopBGM', 'setMusicEnabled', 'playCookComplete', 'stopCookAudio']) assert.equal(typeof win[n], 'function');
  assert.equal(log.contexts, 0);
  assert.equal(log.oscillators.length, 0);
});

test('playClick is a short high square bleep, shares one context and resumes it', () => {
  const { win, log } = makeEnv();
  win.playClick();
  win.playClick();
  assert.equal(log.contexts, 1);
  assert.ok(log.resumes >= 1);
  const osc = log.oscillators[0];
  assert.equal(osc.type, 'square');
  assert.ok(osc.started && osc.stopped);
  osc.onended();
  assert.ok(osc.disconnected);
});

test('siren wobbles, does not stack, and stops cleanly', () => {
  const { win, log } = makeEnv();
  win.playSiren();
  win.playSiren();
  assert.equal(log.oscillators.length, 2); // carrier + LFO, once
  win.stopSiren();
  log.oscillators.forEach(o => { if (o.onended) o.onended(); });
  assert.ok(log.oscillators.every(o => o.stopped && o.disconnected));
  win.playSiren();
  assert.equal(log.oscillators.length, 4);
  win.stopSiren();
  win.stopSiren(); // idempotent
});

test('static is two seconds of noise that stops itself', () => {
  const { win, log } = makeEnv();
  win.playStatic();
  assert.equal(log.buffers[0].length, 2 * 8000);
  const data = log.buffers[0].getChannelData(0);
  assert.ok(data.some(v => v !== 0));
  assert.ok(log.sources[0].started && log.sources[0].stopped);
  log.sources[0].onended();
  assert.ok(log.sources[0].disconnected);
});

test('BGM is loud, does not stack, and stop cleans up', () => {
  const { win, log, intervals } = makeEnv();
  win.startBGM();
  const count = log.oscillators.length;
  assert.ok(count > 0);
  assert.deepEqual(log.gains[0].gain.ramps, [0.25], 'dedicated music bus fades in');
  win.startBGM();
  assert.equal(log.oscillators.length, count);
  assert.equal(intervals.size, 1);
  win.stopBGM();
  assert.equal(intervals.size, 0);
  assert.ok(log.oscillators.every(o => o.stopped));
  win.stopBGM();
});

// Drive the lookahead scheduler like the browser does: advance the audio clock, then tick.
function advance(env, seconds) {
  const tick = env.log.ticks.at(-1);
  for (let t = 0; t < seconds; t += 0.25) { env.log.ctx.currentTime += 0.25; tick(); }
}

const STEP = 60 / 68 / 2;
const LOOP = 64 * STEP;

test('the music is a swung eight-bar phrase with guitar, bass, pad and a slow pulse', () => {
  const env = makeEnv();
  env.win.startBGM();
  advance(env, 20);
  const types = new Set(env.log.oscillators.map(o => o.type));
  for (const type of ['sawtooth', 'square', 'triangle', 'sine']) assert.ok(types.has(type), type);
  assert.ok(env.log.sources.length > 0, 'sparse percussion ticks');
  const kicks = env.log.oscillators.filter(o => o.type === 'sine').map(o => o.starts[0]);
  assert.ok(Math.abs(kicks[1] - kicks[0] - 4 * STEP) < 1e-6, 'the pulse falls on beats 1 and 3');
  const lead = env.log.oscillators.filter(o => o.type === 'square');
  const offbeat = lead.some(o => Math.abs(((o.starts[0] - 0.05) / STEP) % 2 - 1.14) < 1e-6);
  assert.ok(offbeat, 'off-beat eighths are swung');
  const pitches = new Set(env.log.oscillators.filter(o => o.type === 'triangle').map(o => Math.round(o.frequency.value)));
  assert.ok(pitches.size >= 6, 'bass and pad use many pitches, not a four-note bed');
});

test('the loop repeats seamlessly: identical content per pass and no gap in the pulse', () => {
  const env = makeEnv();
  env.win.startBGM();
  advance(env, 3 * LOOP + 2);
  const start = 0.05;
  const inPass = k => env.log.oscillators.filter(o => o.starts[0] >= start + k * LOOP - 1e-6 && o.starts[0] < start + (k + 1) * LOOP - 1e-6);
  assert.ok(inPass(0).length > 100);
  assert.equal(inPass(0).length, inPass(1).length);
  assert.equal(inPass(1).length, inPass(2).length);
  const kicks = env.log.oscillators.filter(o => o.type === 'sine').map(o => o.starts[0]);
  for (let i = 1; i < kicks.length; i++) assert.ok(Math.abs(kicks[i] - kicks[i - 1] - 4 * STEP) < 1e-6, `pulse gap ${i}`);
  assert.equal(env.intervals.size, 1, 'exactly one loop');
});

test('a throttled background tab skips ahead on the beat grid instead of bursting notes', () => {
  const env = makeEnv();
  env.win.startBGM();
  const before = env.log.oscillators.length;
  env.log.ctx.currentTime += 60;
  env.log.ticks.at(-1)();
  const late = env.log.oscillators.slice(before);
  assert.ok(late.length > 0 && late.length < 80);
  assert.ok(late.every(o => o.starts[0] >= 60));
  const grid = (late[0].starts[0] - 0.05) / STEP;
  assert.ok(Math.abs(grid - Math.round(grid)) < 0.3, 'still on the original grid (allowing swing)');
});

test('muting stops only the music; unmuting restores exactly one loop', () => {
  const env = makeEnv();
  const { win, log, intervals } = env;
  win.startBGM();
  win.setMusicEnabled(false);
  assert.equal(intervals.size, 0);
  assert.ok(log.oscillators.every(o => o.stopped));
  const count = log.oscillators.length;
  win.startBGM(); // A later interaction while muted never undoes the mute.
  win.startBGM();
  assert.equal(intervals.size, 0);
  assert.equal(log.oscillators.length, count);
  win.playClick(); // Effects still play while muted.
  assert.equal(log.oscillators.length, count + 1);
  win.setMusicEnabled(true);
  win.setMusicEnabled(true);
  assert.equal(intervals.size, 1);
  assert.ok(log.oscillators.length > count + 1);
  win.setMusicEnabled(true);
  win.startBGM();
  assert.equal(intervals.size, 1);
});

test('music enabled before the first interaction waits for it; muted-first stays silent', () => {
  const env = makeEnv();
  env.win.setMusicEnabled(false);
  env.win.setMusicEnabled(true);
  assert.equal(env.log.contexts, 0, 'toggling alone creates no audio');
  assert.equal(env.intervals.size, 0);
  env.win.setMusicEnabled(false);
  env.win.startBGM();
  assert.equal(env.intervals.size, 0);
  env.win.setMusicEnabled(true);
  assert.equal(env.intervals.size, 1, 'unmuting an active game starts the loop');
});

test('after the game ends unmuting cannot restart music, and teardown releases every node', () => {
  const env = makeEnv();
  const { win, log, intervals } = env;
  win.startBGM();
  advance(env, 2);
  win.stopBGM();
  assert.equal(intervals.size, 0);
  win.setMusicEnabled(false);
  win.setMusicEnabled(true);
  assert.equal(intervals.size, 0);
  const count = log.oscillators.length;
  win.startBGM(); // a brand-new run may start it again
  assert.equal(intervals.size, 1);
  assert.ok(log.oscillators.length > count);
  win.stopBGM();
  [...log.oscillators, ...log.sources].forEach(node => { if (node.onended) node.onended(); });
  assert.ok(log.oscillators.every(o => o.disconnected));
  assert.ok(log.sources.every(o => o.disconnected));
  assert.ok(log.gains.every(g => g.disconnected), 'every gain is released');
  assert.ok(log.filters.every(f => f.disconnected), 'every filter is released');
});

test('missing Web Audio is a silent no-op', () => {
  const { win } = makeEnv({ withAudio: false });
  assert.doesNotThrow(() => { win.playClick(); win.playSiren(); win.stopSiren(); win.playStatic(); win.startBGM(); win.setMusicEnabled(false); win.setMusicEnabled(true); win.stopBGM(); });
});


test('normal completions never request the meme; rare voices use the shared context and stop cleanly', async () => {
  const { win, log } = makeEnv();
  win.playCookComplete(false);
  assert.equal(log.fetches.length, 0);
  await win.playCookComplete(true);
  assert.equal(log.contexts, 1);
  assert.equal(log.fetches.length, 1);
  assert.ok(fs.statSync(path.join(__dirname, log.fetches[0])).isFile());
  const first = log.sources[0];
  assert.equal(first.buffer.kind, 'voice');
  assert.equal(first.started, true);
  assert.ok(log.gains.at(-1).gain.value > 6, 'quiet source is normalized above the bed');
  await win.playCookComplete(true);
  assert.equal(first.stopped, true, 'existing voice stops before a new one starts');
  assert.equal(log.fetches.length, 1, 'decoded clip is cached');
  win.stopCookAudio();
  assert.equal(log.sources[1].stopped, true);
  log.sources[1].onended();
  assert.equal(log.sources[1].disconnected, true);
});

test('the background bus ducks for the voice and restores when it ends', async () => {
  const { win, log } = makeEnv();
  win.startBGM();
  const values = log.gains[0].gain.targets;
  await win.playCookComplete(true);
  assert.equal(values[0], 0.03);
  log.sources.find(s => s.buffer && s.buffer.kind === 'voice').onended();
  assert.equal(values[1], 0.25);
});

test('muting during the quote keeps the music off afterwards, and unmuting mid-quote starts ducked', async () => {
  const env = makeEnv();
  const { win, log, intervals } = env;
  win.startBGM();
  await win.playCookComplete(true);
  const voice = log.sources.find(s => s.buffer && s.buffer.kind === 'voice');
  win.setMusicEnabled(false);
  voice.onended();
  assert.equal(intervals.size, 0, 'the end of the quote never undoes mute');
  await win.playCookComplete(true);
  win.setMusicEnabled(true);
  assert.equal(intervals.size, 1);
  const fresh = log.gains.find(g => g.gain.ramps.length && g.gain.ramps[0] === 0.03);
  assert.ok(fresh, 'new bus fades in at the ducked level while the quote plays');
});

test('failed clip loading is contained and a subsequent attempt retries', async () => {
  const { win, log } = makeEnv({ fetchFail: true });
  await win.playCookComplete(true);
  await win.playCookComplete(true);
  assert.equal(log.sources.length, 0);
  assert.equal(log.fetches.length, 2);
});

test('stopping during decode cancels pending voice playback', async () => {
  const { win, log } = makeEnv();
  const pending = win.playCookComplete(true);
  win.stopCookAudio();
  await pending;
  assert.equal(log.sources.length, 0);
});


test('a blocked clip request falls back to the identical bundled MP3 and caches decoding', async () => {
  const { win, log } = makeEnv({ fetchFail: true, embedded: true });
  let decoded;
  win.AudioContext.prototype.decodeAudioData = function(data) {
    decoded = Buffer.from(data);
    return Promise.resolve({ duration: 2, numberOfChannels: 1,
      getChannelData: () => new Float32Array([0.1]) });
  };
  await win.playCookComplete(true);
  assert.deepEqual(decoded, fs.readFileSync(path.join(__dirname, 'assets/audio/youre-goddamn-right.mp3')));
  assert.equal(log.sources[0].started, true);
  await win.playCookComplete(true);
  assert.equal(log.fetches.length, 1);
  assert.equal(log.sources.length, 2);
});

test('fallback decoding does not play a quote cancelled during loading', async () => {
  const { win, log } = makeEnv({ fetchFail: true, embedded: true });
  const pending = win.playCookComplete(true);
  win.stopCookAudio();
  await pending;
  assert.equal(log.sources.length, 0);
});

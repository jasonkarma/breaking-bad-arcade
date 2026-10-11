/* Breaking Bad — procedural arcade audio (native Web Audio plus a local rare-cook voice).
 * Classic browser script. Exposes globals: playClick(), playSiren(), playStatic(),
 * startBGM(), stopSiren(), stopBGM(), setMusicEnabled(), playCookComplete() and stopCookAudio().
 * Loading the file starts no sound; call from a user gesture (browsers keep the
 * shared AudioContext suspended until then). Without Web Audio every call is a no-op.
 */
(function (root) {
  'use strict';

  const BGM_GAIN = 0.25; // Dedicated music bus, ~15 dB above the old 0.045 mix; keeps headroom for overlapping effects.
  const BGM_DUCK = 0.03; // Bus level while the rare-cook quote plays.
  const BGM_LOOKAHEAD = 1.5; // Seconds scheduled ahead of the clock (survives 1 s background-tab timers).
  const BGM_TICK_MS = 250;

  // "Dust and Static" — an original desert-blues loop composed for this game: eight bars of
  // 4/4 at 68 BPM, swung eighth notes, in A minor with a flat-five blue note and an E-major
  // (G#) turnaround. Everything is synthesized from oscillators and noise; no recording or
  // third-party melody is used. See assets/audio/README.md.
  const BPM = 68;
  const STEP = 60 / BPM / 2; // One eighth note.
  const SWING = 0.14; // Fraction of a step by which off-beat eighths lag.
  const LOOP_STEPS = 64; // 8 bars x 8 eighths.
  // [step, MIDI note, length in steps]
  const BASS = [
    [0, 45, 2], [3, 45, 1], [5, 48, 1], [6, 50, 1],
    [8, 45, 2], [11, 45, 1], [12, 43, 1], [14, 40, 2],
    [16, 45, 2], [19, 45, 1], [21, 48, 1], [22, 50, 1],
    [24, 45, 2], [27, 45, 1], [28, 43, 1], [30, 40, 2],
    [32, 41, 2], [35, 41, 1], [37, 45, 1], [38, 44, 1],
    [40, 40, 2], [43, 40, 1], [45, 44, 1], [46, 47, 1],
    [48, 45, 2], [51, 45, 1], [53, 48, 1], [54, 45, 1],
    [56, 40, 2], [59, 40, 1], [61, 44, 1], [62, 47, 1]
  ];
  const LEAD = [
    [2, 69, 3], [6, 72, 1],
    [8, 67, 2], [12, 64, 4],
    [18, 69, 2], [21, 72, 1], [22, 75, 2],
    [25, 74, 1], [26, 72, 2], [28, 69, 4],
    [34, 72, 3], [38, 69, 2],
    [40, 68, 3], [44, 71, 2],
    [50, 69, 2], [54, 76, 2],
    [56, 71, 2], [59, 68, 1], [60, 64, 4]
  ];
  // Pad roots per bar: A A A A F E A E.
  const PAD_ROOTS = [45, 45, 45, 45, 41, 40, 45, 40];
  const KICK_STEPS = [0, 4]; // Slow pulse: beats 1 and 3 of every bar.
  const TICK_STEPS = [6]; // Brushed rim tick on the last off-beat of every bar...
  const TICK_BARS = [1, 3, 5, 7]; // ...every other bar only (sparse).
  const STATIC_SECONDS = 2;

  // Same attributed clip as assets/audio/youre-goddamn-right.mp3. Sandboxed
  // Preview frames can block its fetch because their origin is opaque.
  const MEME_FALLBACK = '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';

  function embeddedClip() {
    const bytes = root.atob(MEME_FALLBACK);
    return Uint8Array.from(bytes, byte => byte.charCodeAt(0)).buffer;
  }

  let ctx = null;
  let siren = null;
  let bgm = null;
  let bgmWanted = false; // startBGM() was requested and not stopped (game still running).
  let musicOn = true; // Music toggle; independent of effects and dialogue.
  let memeBuffer = null;
  let memeGain = 0.7;
  let memeLoading = null;
  let memeVoice = null;
  let memeRequest = 0;

  function filter(c, hz) {
    const node = c.createBiquadFilter();
    node.type = 'lowpass';
    node.frequency.value = hz;
    node.Q.value = 0.7;
    return node;
  }

  // Decode once and play through the already-unlocked game AudioContext. A separate
  // HTMLAudioElement can be blocked when an asynchronous cook finishes in Preview.
  function prepareMeme(c) {
    if (memeBuffer) return Promise.resolve(memeBuffer);
    if (memeLoading) return memeLoading;
    const load = typeof root.fetch === 'function'
      ? Promise.resolve().then(() => root.fetch('assets/audio/youre-goddamn-right.mp3'))
      : Promise.reject(new Error('Fetching unavailable'));
    memeLoading = load
      .then(response => {
        if (!response.ok) throw new Error('Voice clip unavailable');
        return response.arrayBuffer();
      })
      .catch(() => embeddedClip())
      .then(data => c.decodeAudioData(data))
      .then(buffer => {
        // The source excerpt peaks below 0.1. Normalize once so dialogue is audible
        // above the synth bed, leaving headroom for the completion chime.
        let peak = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const data = buffer.getChannelData(channel);
          for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
        }
        memeGain = peak > 0.00001 ? Math.min(12, 0.7 / peak) : 0.7;
        memeBuffer = buffer;
        return buffer;
      })
      .catch(() => null)
      .finally(() => { memeLoading = null; });
    return memeLoading;
  }

  function restoreBed() {
    if (bgm && ctx) bgm.bus.gain.setTargetAtTime(BGM_GAIN, ctx.currentTime, 0.08);
  }

  function duckBed() {
    if (bgm && ctx) bgm.bus.gain.setTargetAtTime(BGM_DUCK, ctx.currentTime, 0.025);
  }

  // Normal batches get a small completion chime; only Flawless Blue gets the quote.
  function playCookComplete(flawless) {
    const c = ready();
    if (!c) return;
    const notes = flawless ? [523.25, 659.25, 783.99] : [392, 523.25];
    notes.forEach((hz, i) => {
      const osc = c.createOscillator(), gain = c.createGain();
      const t = c.currentTime + i * 0.09;
      osc.type = 'triangle';
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.08, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain); gain.connect(c.destination);
      osc.onended = () => disconnect(osc, gain);
      osc.start(t); osc.stop(t + 0.36);
    });
    if (!flawless) return;
    const request = ++memeRequest;
    if (memeVoice) stopSource(memeVoice.src);
    return prepareMeme(c).then(buffer => {
      if (!buffer || request !== memeRequest) return;
      const src = c.createBufferSource(), gain = c.createGain();
      src.buffer = buffer;
      gain.gain.value = memeGain;
      src.connect(gain); gain.connect(c.destination);
      const voice = { src, gain };
      memeVoice = voice;
      duckBed();
      src.onended = () => {
        disconnect(src, gain);
        if (memeVoice === voice) memeVoice = null;
        if (request === memeRequest) restoreBed();
      };
      try { src.start(); } catch (error) {
        disconnect(src, gain);
        if (memeVoice === voice) memeVoice = null;
        restoreBed();
      }
    });
  }

  function stopCookAudio() {
    memeRequest++;
    if (memeVoice) { stopSource(memeVoice.src); memeVoice = null; }
    restoreBed();
  }

  function getContext() {
    if (ctx) return ctx;
    const Ctor = root.AudioContext || root.webkitAudioContext;
    if (typeof Ctor !== 'function') return null;
    try { ctx = new Ctor(); } catch (e) { ctx = null; }
    return ctx;
  }

  // Shared context, resumed when the browser left it suspended.
  function ready() {
    const c = getContext();
    if (!c) return null;
    if (c.state === 'suspended' && typeof c.resume === 'function') {
      try { const p = c.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
    }
    return c;
  }

  function safe(fn) {
    return function () {
      try { return fn.apply(null, arguments); } catch (e) { return undefined; }
    };
  }

  function disconnect() {
    for (let i = 0; i < arguments.length; i++) {
      try { arguments[i].disconnect(); } catch (e) { /* already gone */ }
    }
  }

  function stopSource(node, when) {
    try { node.stop(when); } catch (e) { /* already stopped */ }
  }

  function playClick() {
    const c = ready();
    if (!c) return;
    prepareMeme(c);
    const t = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'square';
    const lowpass = filter(c, 2200);
    osc.frequency.setValueAtTime(920, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.06);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.055, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(c.destination);
    osc.onended = () => disconnect(osc, gain, lowpass);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  function playSiren() {
    const c = ready();
    if (!c || siren) return;
    const osc = c.createOscillator();
    const lfo = c.createOscillator();
    const depth = c.createGain();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = 190;
    lfo.type = 'sine';
    lfo.frequency.value = 1.2; // Wobble rate (Hz).
    depth.gain.value = 55; // Wobble depth (Hz).
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.linearRampToValueAtTime(0.09, c.currentTime + 0.2);
    lfo.connect(depth);
    depth.connect(osc.frequency);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    lfo.start();
    siren = { osc, lfo, depth, gain };
  }

  function stopSiren() {
    if (!siren) return;
    const s = siren;
    siren = null;
    s.gain.gain.cancelScheduledValues(ctx.currentTime);
    s.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.025);
    s.osc.onended = () => disconnect(s.osc, s.lfo, s.depth, s.gain);
    stopSource(s.osc, ctx.currentTime + 0.12);
    stopSource(s.lfo, ctx.currentTime + 0.12);
  }

  function playStatic() {
    const c = ready();
    if (!c) return;
    const frames = Math.max(1, Math.floor(c.sampleRate * STATIC_SECONDS));
    const buffer = c.createBuffer(1, frames, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      // Hard-clipped white noise for a crunchy, bit-crushed edge.
      data[i] = Math.max(-1, Math.min(1, (Math.random() * 2 - 1) * 1.15));
    }
    const src = c.createBufferSource();
    const gain = c.createGain();
    src.buffer = buffer;
    const t = c.currentTime;
    const lowpass = filter(c, 2600);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.03);
    gain.gain.setValueAtTime(0.22, t + 1.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + STATIC_SECONDS);
    src.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(c.destination);
    src.onended = () => disconnect(src, gain, lowpass);
    src.start();
    src.stop(c.currentTime + STATIC_SECONDS);
  }

  // ----- Background music: "Dust and Static" -----

  const mtof = note => 440 * Math.pow(2, (note - 69) / 12);

  // Score lookup: one array of events per eighth-note step of the loop.
  let score = null;
  function buildScore() {
    const steps = Array.from({ length: LOOP_STEPS }, () => []);
    BASS.forEach(([step, note, len]) => steps[step].push({ kind: 'bass', note, len }));
    LEAD.forEach(([step, note, len]) => steps[step].push({ kind: 'lead', note, len }));
    PAD_ROOTS.forEach((note, bar) => steps[bar * 8].push({ kind: 'pad', note, len: 8 }));
    for (let bar = 0; bar < LOOP_STEPS / 8; bar++) {
      KICK_STEPS.forEach(step => steps[bar * 8 + step].push({ kind: 'kick' }));
      if (TICK_BARS.includes(bar)) TICK_STEPS.forEach(step => steps[bar * 8 + step].push({ kind: 'tick' }));
    }
    return steps;
  }

  // Register a source and its helper nodes; everything is released when the source ends.
  function track(state, src, nodes) {
    const voice = { src, nodes };
    state.voices.add(voice);
    src.onended = () => {
      state.voices.delete(voice);
      disconnect(src, ...nodes);
      if (state.stopped && !state.voices.size) teardown(state);
    };
  }

  function teardown(state) {
    disconnect(...state.chain);
    state.noise = null;
  }

  function envelope(gain, t, peak, attack, hold, release) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.setValueAtTime(peak, t + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  function playBass(c, state, t, event) {
    const freq = mtof(event.note), len = event.len * STEP;
    const lowpass = filter(c, 520);
    const gain = c.createGain();
    envelope(gain, t, 0.9, 0.012, Math.max(0.05, len * 0.5), len * 0.5 + 0.18);
    lowpass.connect(gain);
    gain.connect(state.bus);
    [['triangle', 1, 1], ['sawtooth', 1, 0.28]].forEach(([type, mult, level]) => {
      const osc = c.createOscillator(), mix = c.createGain();
      osc.type = type;
      osc.frequency.value = freq * mult;
      mix.gain.value = level;
      osc.connect(mix); mix.connect(lowpass);
      track(state, osc, [mix, lowpass, gain]); // Both oscillators end together.
      osc.start(t); osc.stop(t + len + 0.25);
    });
  }

  // Twangy plucked guitar: detuned saw + square, a filter that snaps shut, a small pitch scoop.
  function playLead(c, state, t, event) {
    const freq = mtof(event.note), len = event.len * STEP + 0.7;
    const lowpass = c.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.Q.value = 2.5;
    lowpass.frequency.setValueAtTime(3400, t);
    lowpass.frequency.exponentialRampToValueAtTime(850, t + 0.32);
    const gain = c.createGain();
    envelope(gain, t, 0.3, 0.006, 0.02, len);
    lowpass.connect(gain);
    gain.connect(state.lead);
    [['sawtooth', 0], ['square', 7]].forEach(([type, cents]) => {
      const osc = c.createOscillator(), mix = c.createGain();
      osc.type = type;
      osc.detune.value = cents;
      osc.frequency.setValueAtTime(freq * 0.965, t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
      mix.gain.value = type === 'square' ? 0.35 : 0.7;
      osc.connect(mix); mix.connect(lowpass);
      track(state, osc, [mix, lowpass, gain]);
      osc.start(t); osc.stop(t + len + 0.05);
    });
  }

  function playPad(c, state, t, event) {
    const len = event.len * STEP;
    const gain = c.createGain();
    envelope(gain, t, 0.13, 0.55, len - 0.55, 0.9);
    gain.connect(state.bus);
    [12, 19].forEach(offset => {
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = mtof(event.note + offset);
      osc.connect(gain);
      track(state, osc, [gain]);
      osc.start(t); osc.stop(t + len + 1);
    });
  }

  function playKick(c, state, t) {
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.14);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.75, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(gain); gain.connect(state.bus);
    track(state, osc, [gain]);
    osc.start(t); osc.stop(t + 0.42);
  }

  // Brushed rim tick: a short band of noise.
  function playTick(c, state, t) {
    const src = c.createBufferSource(), band = c.createBiquadFilter(), gain = c.createGain();
    src.buffer = state.noise;
    band.type = 'bandpass';
    band.frequency.value = 2400;
    band.Q.value = 2.5;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.32, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(band); band.connect(gain); gain.connect(state.bus);
    track(state, src, [band, gain]);
    src.start(t, (state.step % 7) * 0.11); src.stop(t + 0.1);
  }

  const PLAYERS = { bass: playBass, lead: playLead, pad: playPad, kick: playKick, tick: playTick };

  function beginLoop(c) {
    if (!score) score = buildScore();
    const bus = c.createGain();
    const lead = c.createGain();
    const delay = c.createDelay(1);
    const tone = filter(c, 1800);
    const feedback = c.createGain();
    const echo = c.createGain();
    const now = c.currentTime;
    // Fade in (and start ducked if the quote is already playing) so nothing clicks.
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.linearRampToValueAtTime(memeVoice ? BGM_DUCK : BGM_GAIN, now + 0.4);
    bus.connect(c.destination);
    // Slap-back echo on the guitar for desert air.
    delay.delayTime.value = 0.31;
    feedback.gain.value = 0.32;
    echo.gain.value = 0.38;
    lead.connect(bus);
    lead.connect(delay);
    delay.connect(tone); tone.connect(feedback); feedback.connect(delay);
    tone.connect(echo); echo.connect(bus);
    const noise = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate)), c.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 20260711; // Fixed seed: the loop's percussion is reproducible.
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = seed / 2147483648 - 1;
    }
    const state = {
      bus, lead, noise, voices: new Set(), timer: null, next: now + 0.05, step: 0,
      chain: [bus, lead, delay, tone, feedback, echo]
    };

    function schedule() {
      const clock = c.currentTime;
      if (state.next < clock) { // Missed steps (background tab): keep the grid, skip, never burst.
        const skipped = Math.ceil((clock - state.next) / STEP);
        state.next += skipped * STEP;
        state.step += skipped;
      }
      while (state.next < clock + BGM_LOOKAHEAD) {
        const t = state.next + (state.step % 2 ? SWING * STEP : 0);
        for (const event of score[state.step % LOOP_STEPS]) PLAYERS[event.kind](c, state, t, event);
        state.next += STEP;
        state.step++;
      }
    }

    state.schedule = safe(schedule);
    state.schedule();
    state.timer = root.setInterval(state.schedule, BGM_TICK_MS);
    bgm = state;
  }

  function stopLoop() {
    if (!bgm) return;
    const b = bgm;
    bgm = null;
    root.clearInterval(b.timer);
    b.stopped = true;
    b.bus.gain.cancelScheduledValues(ctx.currentTime);
    b.bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.02);
    b.voices.forEach(v => stopSource(v.src, ctx.currentTime + 0.1));
    if (!b.voices.size) teardown(b);
  }

  // Music starts on the first gesture, one loop at a time. While muted it only records the
  // request, so unmuting during the same run brings it back and unmuting after the run
  // ended (stopBGM) cannot.
  function startBGM() {
    const c = ready();
    if (!c) return;
    prepareMeme(c);
    bgmWanted = true;
    if (bgm || !musicOn) return;
    beginLoop(c);
  }

  function stopBGM() {
    bgmWanted = false;
    stopLoop();
  }

  function setMusicEnabled(enabled) {
    musicOn = !!enabled;
    if (!musicOn) { stopLoop(); return; }
    if (!bgmWanted || bgm) return;
    const c = ready();
    if (c) beginLoop(c);
  }

  root.playCookComplete = safe(playCookComplete);
  root.stopCookAudio = safe(stopCookAudio);
  root.playClick = safe(playClick);
  root.playSiren = safe(playSiren);
  root.stopSiren = safe(stopSiren);
  root.playStatic = safe(playStatic);
  root.startBGM = safe(startBGM);
  root.stopBGM = safe(stopBGM);
  root.setMusicEnabled = safe(setMusicEnabled);
})(typeof window !== 'undefined' ? window : globalThis);

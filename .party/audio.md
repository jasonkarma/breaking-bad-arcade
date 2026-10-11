# Game audio

`audio.js` keeps one lazy AudioContext and plays nothing on load. UI clicks use a
quieter filtered square bleep with a short attack/release. Warning audio is a
smooth sine siren; raid noise is filtered and fades over two seconds. BGM is
“Dust and Static”, an original procedural desert-blues loop (see below), on a
0.25 bus gain (raised from 0.045, ~15 dB). Estimated music peak stays well under 1.0 so overlapping effects (peaks <= 0.22) do not clip; not yet measured in a real browser.

## Background music

Eight bars, 4/4, 68 BPM, swung eighths, A minor with a flat-five blue note and an
E-major (G#) turnaround; 28.2 s per pass. Parts: plucked twangy lead (detuned
saw + square through a snapping low-pass, pitch scoop, slap-back echo), deep
triangle/saw bass riff, slow triangle pad on the bar roots, a soft sine kick on
beats 1 and 3 (the slow pulse), and a sparse brushed noise tick every other bar.
The score is plain arrays at the top of `audio.js`; noise uses a fixed LCG seed.
No recording, sample or third-party melody; vocals are not used.

The loop is a lookahead scheduler (250 ms tick, 1.5 s ahead) on the audio clock, so
notes and echoes ring across the loop boundary and the pulse never gaps. After a
throttled background tab it skips missed steps on the grid instead of bursting.
`startBGM()` records the request (`bgmWanted`) and starts one loop unless muted;
`setMusicEnabled(false)` fades and releases the loop but keeps the request, so
`setMusicEnabled(true)` restores exactly one loop during a live game; `stopBGM()`
(game end/teardown) clears the request, so unmuting afterwards cannot restart it.
Mute affects only the music bus: effects and the quote keep playing, and the quote's
duck/restore (0.03 / 0.25) only touches a live music bus.

`main.js` owns the HUD `#music-btn` (“Music: On/Off”, `aria-pressed`). The state is
per page session and resets on init/teardown (no persistence). Offline renders of
the real `audio.js` measured peak ≈ 0.08 and RMS ≈ −35 dBFS for the music alone,
against click peaks 0.055, siren RMS ≈ 0.065 and the quote peaking ≈ 0.7. That
verifies levels and loop continuity only; how musical it sounds is a listening call.

`main.js` starts the bed on the first button click, follows suspicion above 80
with `playSiren()` / `stopSiren()`, and stops bed, siren and voice at game end or
teardown. A confirmed real raid triggers `playStatic()` once.

`playCookComplete(flawless)` plays a small chime for Standard results and the
locally bundled “You’re goddamn right” voice for Flawless Blue. `main.js` uses the
engine lot quality (existing 5% chance), never an extra random roll. Its tracked
completion path prevents repeated frames, historical inventory and presets from
replaying the voice. The local MP3 is fetched/decoded once, with an identical base64 copy in the audio
script as fallback when sandbox/CORS or offline restrictions block the request, and played by an AudioBufferSourceNode on
the existing gesture-unlocked AudioContext. The source excerpt is very quiet
(peak about 0.097); playback normalizes its peak to 0.7, with a gain cap of 12.
The bed ducks to 0.03 while the quote plays. One active voice is reused; cancellation
invalidates pending decode playback. Failed fetching/decoding is contained and
can retry; `stopCookAudio()` silences the voice. See `assets/audio/README.md` for the clip source.

The original six globals remain available, plus `playCookComplete()` and
`stopCookAudio()`. All are optional when Web Audio/media is unavailable.
`audio.test.cjs` covers source lifecycle, duplicate starts, voice selection,
ducking and rejected playback; `main.test.cjs` covers real engine outcomes and
raid integration. Generated browser checks and listening demos stay outside Git.

Automated Chromium playback/signal checks supplement the project tests. They do
not establish subjective sound quality; the attached mix is for direct listening.

Press U (or Shift+U) for an instant Flawless Blue bonus for the selected compound
and workflow, with its inventory, result notification and the same voice cue.
The engine's `grantFlawlessBatch()` requires no cash or free slot and preserves
active cooks and normal 5% rolls. Typing in text fields, modifiers, repeats and
ended games suppress the shortcut; teardown removes its listener.

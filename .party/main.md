# main.js (integration layer)

Script order in `index.html`: `engine.js` (once), `audio.js`, `lab-ui.js`, `street-ui.js`, `main.js`.
`main.js` recreates no game math and never calls `tick()`.

Ownership (one handler per control, so nothing hits the engine twice):

- **Start Cook** (`#cook-start-btn`): `main.js` calls `startCook(compoundId, workflowType)` once with
  `LabUI.getSelection()`. The 3 s CSS animation (`#cook-progress[data-state=running]`) is presentation
  only; real cooks take 5-60 s. Completion is announced only when a tracked batch leaves
  `activeBatches` and a `completedBatches` lot with the same id and compound exists. Flawless Blue
  results get `.neon-cyan-glow`. Confirmed completion calls `playCookComplete()` once;
  only Flawless Blue requests the meme voice. No rarity roll is added.
- **Add Lab Slot**: `main.js` calls `buyLabSlot()` once. The label shows `nextSlotCost()`
  (`$5,000` / `$30,000` / `$50,000` for the 2nd / 3rd / 4th slot) and disables when that price is absent.
- **Hire Dealer ($500)** / **Launder Money**: handled once by `street-ui.js` (roll -> hire -> $500;
  `launderCash()`). `main.js` only renders `playerState.dealers` into `#dealer-roster`
  (Common = Street Hustler, Rare = Middle-Man, Legendary = Cartel Distributor) as `li.dealer-card`
  dossiers with an `img.dealer-mugshot` (`assets/dealer_hustler.jpg` / `dealer_mid.jpg` / `dealer_cartel.jpg`).
- **Siren heat**: the HUD render also toggles `.street-heat` on `#street-container` with panic
  (suspicion > 80). The CSS overlay is a sticky `::before` (container query units) so it stays pinned
  while the screen scrolls; the radar sweep is `#street-dispatch-map::before`. Both stop under
  `prefers-reduced-motion`. The asset files are JPEG bytes (supplied as `.png`), so they keep `.jpg` names.
- **HUD** (`#hud`) and the roster refresh from a 100 ms `setInterval` render loop.
- **Floating cash**: when `timeTicks` advances by a normal step (1-10) and `cash` rose versus the last
  frame, one `.floating-text` (`+$X`) is added to `#cash-float-layer` (inside `#street-dispatch-map`) at
  independently random `left` 18-82% / `top` 18-74% and removed after 1 s. Button clicks re-baseline cash so a purchase cannot hide earnings.
- **Vacuum Repairman** (`#vacuum-btn`): hidden until `launderedCash >= 1,000,000`, then shown with
  `.neon-cyan-glow`. Clicking it clears `blueSkyLegacyFunds` and ends the run as ESCAPED.
- **End game**: a rising `raidCount` (baselined at init, re-baselined on preset loads, never triggered by
  zero cash) ends the run as BUSTED. Both call `stopGameLoop()` once and fill `#scorecard-modal` (CRT
  styling) with a snapshot: Net Profit = cash + launderedCash (post-seizure for raids), ticks =
  `timeTicks`. The frame loop stops; the background stays `inert` even after Close/Escape.
- **Click sound**: every `<button>` gets one extra click listener (after its own handler) calling the
  global `playClick()` from `audio.js` (owned by the Juice Audio issue; optional, errors swallowed).
- A large `timeTicks` jump or a lower `timeTicks`/`nextBatchId` is treated as a preset load: tracked
  cooks, animation and results are dropped.
- Modal: `role="dialog"`, Escape/button close, Tab trapped, `inert` background, focus restored.

Tests: `main.test.cjs` runs the real engine and all three UI scripts in `vm` with a fake DOM and
fake clock. Screenshots use the preinstalled Playwright Chromium (`python3 -m playwright`).

Audio integration: first button interaction starts BGM; the render loop follows
suspicion > 80 with siren start/stop. End-game and teardown stop bed/siren/voice;
a real raid plays two-second static once. All optional audio calls are guarded.

U / Shift+U invokes the engine's explicit `grantFlawlessBatch()` for the current
selection and adds one result + meme cue. It is a free Judge bonus and leaves
active cooks intact. Ignore typing in text fields, Ctrl/Alt/Meta, repeats and
ended runs. The shortcut also recognizes physical KeyU across keyboard layouts and works while
the compound selector is focused. No visible shortcut hint is rendered. Its document capture listener is owned by main and removed on destroy.

8 calls the engine's `grantCash(1000000)` (dirty cash only) then refreshes panels and the HUD at once. Same guards as U (no repeats, typing fields, Ctrl/Alt/Meta, composition, ended runs); capture listener removed on destroy.

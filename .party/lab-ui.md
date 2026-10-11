# Lab UI (left half of index.html)

`lab-ui.js` is a read-only view over `engine.js`: it reads `playerState.activeBatches`,
`compounds`, and `workflows`. It never starts cooks (`main.js` owns Start Cook): compound
cards (`#lab-compound` radiogroup) and the Rapid/Standard/Precision buttons only select
(`aria-checked` / `aria-pressed`, default first compound and Standard). `LabUI.getSelection()`
reports `{compoundId, workflowType}`. Display names are the engine's lab identifiers
(Compound AM-01 through AZ-05); internal IDs are unchanged. Card diagrams are inline SVG
in `lab-ui.js`, not fetched. It never writes engine state or decrements timers;
its own interval (250 ms) only re-renders. Progress is
`100 * (productionTime - remainingTicks) / productionTime`, clamped 0-100.

- `index.html` loads `engine.js` first, then `lab-ui.js`. Lab styles are scoped to
  `#lab-panel`; the right half is the empty `#street-panel` slot (Street UI adds
  `street-ui.js` and its own markup/styles there).
- Loading `lab-ui.js` again calls `LabUI.destroy()` on the old instance, so
  listeners and the refresh interval are never duplicated.
- Judge keys 1/2/3 (engine) reset state; the lab clears stale progress on the
  next refresh.
- Local run: see `.party/preview.md` in this project (static server).
- Lab scene sizing lives in the arcade stylesheet in `index.html`. The Lab screen never scrolls (desktop or narrow): the scene row is `1fr` and takes whatever the controls leave; sprite boxes use `cqh` so characters grow with it. Only the selected compound shows its Potency/Yield/Base time rows (`:has()` on the checked card); they span the full compound grid width. Narrow viewports (`max-aspect-ratio: 4/3`) stack the three option rows.

## Lab Slots (beside Start Cook)

Each compound row keeps the lab-identifier card and structure graphic, plus separate Potency, Yield, and Base time option buttons. Those buttons call `setCompoundSetting` and never start a cook. `#lab-compound-info` shows overall performance as potency × cook time in minutes ÷ effective yield, plus upfront batch cost and selling price per unit from `cookQuote`. Cook cost is $300 × that unrounded score. The score is not labeled potency-units/min. Durations in batch progress state minutes and seconds explicitly.

`#lab-slots` sits in `.lab-start-row` next to `#cook-start-btn` (wraps under it on narrow screens).
`slotCapacity(playerState)` mirrors the engine's `startCook` rule: total = sum of positive
safe-integer `labEquipment` quantities, occupied = `activeBatches.length`, available =
`max(0, total - occupied)`. Text states (not color alone): `Slot available`, `Lab full`,
`No lab equipment` (total 0, e.g. after a raid), `Slot status unavailable` (missing/malformed
state). It is rendered by the existing 250 ms lab refresh; no extra timers, no engine writes.

## Scene animation states

`#lab-scene[data-state]` (set by `lab-ui.js` from `activeBatches`) drives calm idle vs. lively cooking (stirring, bubbles, steam, pipe flow, typing, sparks). `main.js` `pulseScene()` sets `data-complete` (alternating 1/2 to restart the CSS animation) and `data-flawless` for 1.4 s only when `scanBatches` confirms a real engine completion; rejected starts, resets and removals never pulse. Reduced motion drops movement and shows static steam/sparks and a still "BATCH DONE" banner.

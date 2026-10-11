# Visual inventory, Flawless reveal and CRT scorecard

The UI lives in `main.js` and `index.html`. `engine.js` pricing, cost and raid math are untouched; it only snapshots each cook's score and grade.

## Assets (`assets/`, bundled locally)

| File | Use |
|---|---|
| `grade_1.png` … `grade_4.png` | Inventory art for grades 1–4 (Street 50%, Poor Lab 60%, Lab 75%, High Purity 90%) |
| `flawless_batch.png` | Grade-5 inventory still, cropped from frame 1 s of the reveal clip |
| `flawless_reveal.mp4` | Grade-5 Flawless Blue video (10 s, muted inline playback; also the poster fallback) |
| `heisenberg_alert.png` | Image inside `#flawless-alert` |

The user numbered the grades; the numbers printed inside the artwork do not matter.

## Grade rule

Grade comes from the **overall performance score of the cooking result** (the user's rule), not from
potency or price. `pricedCook().performance` is the score; `startCook` snapshots it on the batch and
`completeBatch` stores `lot.performance` and `lot.grade` after the Flawless roll. Dealer splits copy the
lot, so the grade follows. `gradeForScore(score)` in `engine.js`: score < 1 → 1, [1,3) → 2, [3,10) → 3,
≥ 10 → 4 (boundaries enter the higher grade); missing, NaN or negative scores → 1. Flawless Blue (5% roll
or the U bonus) is always grade 5 and overrides the tier. Judge presets carry fixed grades (Mid 2, Late 4,
preset Flawless 5). `gradeOf(lot)` in `main.js` only reads `lot.grade` (Flawless → 5; anything missing,
invalid or a Standard "5" → 1); it never infers from settings or price. The score is potency × effective cook minutes ÷ effective yield. Every ordinary grade is still reachable
from the supported settings (`engine.test.cjs` asserts this).

## Tray (`#inventory-tray`, inside the HUD inventory display)

Stacked by quality grade (Issue #27, replacing the per-unit images of Issue #18). `renderTray()` runs every
frame, sums `completedBatches` remaining units per `gradeOf(lot)` (dealer-held stock included) and draws one
`.inventory-stack` per nonempty grade, ascending 1-5: the grade art (`.inventory-item`, Flawless adds
`flawless-glow`) beside `×N` (`.inventory-count`, exact, `×1` included). Stateless; it skips the DOM when the
`grade:count` signature is unchanged and never writes engine state. At most five pairs, no `+N` overflow.
Each stack is `role="group"` with an `aria-label` such as `Grade 3: Lab Grade, 75% purity: 24 units`; the image
has empty alt and the visible count is `aria-hidden`. The tray's `aria-label` carries the total. Stacks are
`inline-flex; white-space: nowrap` and the tray wraps, so a pair never splits on narrow screens.

## Flawless reveal

Only a tracked cook completion or the U bonus calls `celebrateFlawless()`; frames, presets and
historical stock never do. Alert (CSS `flawless-pop`, 3 s) → muted video → hide on `ended`. Extra
successes queue (max 3 pending), so stages never overlap. Failure to play shows the still for 3 s;
a 12 s guard covers a stalled player. Run end, preset reset and teardown cancel everything.

## Scorecard

`endGame()` captures every value once. Quality is `99.1% (HEISENBERG GRADE)` if a Flawless was cooked
this run (kept after the stock sells; reset by a preset), else `74% (STREET GRADE)`. Reputation is
`timeTicks * 2`; Legal Evasion is `100 - suspicion` (a raid already zeroed suspicion, so BUSTED reads
100%). The CRT prompt is `#scorecard-restart` with a CSS blinking cursor.

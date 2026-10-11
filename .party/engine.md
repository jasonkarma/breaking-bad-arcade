# Core engine

This project is a standalone vanilla JavaScript engine, with no HTML, UI,
dependencies, HTTP server, or preview endpoint. All runtime code is in `engine.js`.
Run `node engine.js` from this project directory for one-second console snapshots;
interrupt with Ctrl+C. A future browser UI can load it as a classic script.

`playerState` and engine operations are exposed on `globalThis`. The script starts
one interval automatically; `stopGameLoop()` and `startGameLoop()` control it.
Reloading the script removes the previous timer and keyboard listener.

Compound potency, yield, and base time are chosen independently from potency 1–5, yield 8/16/24, and base time 10/24/40 minutes (600/1440/2400 seconds). A fresh engine load draws each value once with its own generator, not `Math.random`, so gameplay rolls stay unchanged. `setCompoundSetting(id, setting, value)` rejects anything outside those lists. `cookQuote` and `startCook` share the workflow rounding. Overall performance is potency × effective cook minutes ÷ effective yield. A new cook costs `$300 ×` that unrounded performance, rounded to cents, and stores a unit price of `$2,500 ×` potency × selected yield. Cook time does not change that unit price. A cook copies duration, quantity, unit price, and cost onto the batch; later setting changes do not alter active batches, completed lots, or Judge preset stock. A fresh $1,000 balance cannot afford every random draw, so tests that expect `startCook` to succeed must pin an affordable recipe first. Judge presets do not redraw settings or reprice seeded lots.

Inventory totals are keyed by compound ID. `completedBatches` holds the priced
lots with quality and dealer ownership. Assign lots with `assignDealerInventory`;
manual sales exclude assigned stock. `rollDealerGacha` returns only a tier;
`hireDealer` creates a dealer. Judge keys 1/2/3 load Early/Mid/Late in browsers;
Node callers can use `loadJudgePreset` directly.

`buyLabSlot()` spends dirty cash for the next priced slot and adds one `basicLab` unit. It does not touch laundered cash. Prices are the slot being bought: 2nd `$5,000`, 3rd `$30,000`, 4th `$50,000`. A fresh game already has three slots, so the button offers the 4th at `$50,000`. Slot 1 and slots past 4 are not for sale, including after a raid clears equipment. New games start with three `basicLab` units (three cooking slots). Mid Judge
Mode also loads three slots; Late keeps four. Raids clear cash, equipment,
active cooking, and suspicion. They preserve clean cash, completed stock, and
dealers. New cooks need an available equipment unit and enough dirty cash; a
demo preset can restore a raided lab. Three slots are starting capacity, not a
floor after a raid.

Run `node --check engine.js` and `node --test engine.test.cjs` for project checks.
Tests use built-in Node modules and simulated timers/randomness. They create no
artifacts or caches. The project check manifest is `.party/checks.json`.

The user confirmed Railway as the deployment provider on 2026-10-10. Carry that
choice into future deployment work. The current deliverable remains the core
engine; a hosted service and deployment configuration have not been added.

`grantFlawlessBatch(compoundId, workflowType)` is the explicit U bonus operation.
It reuses the completed-lot accounting, forces Flawless Blue, allocates one unique
batch ID and adds sellable inventory without cost, slots or a random roll.
Normal `completeBatch` calls still make the original 5% roll. Keyboard handling
for U lives in main.js so result presentation and audio are notified immediately.

## Roguelite legacy funds

Raids (`triggerRaid`, via `saveLegacyFunds()`) write `playerState.launderedCash` to localStorage
key `blueSkyLegacyFunds`, replacing any previous value. A successful escape (`main.js` `callVacuum`,
via `clearSave()`) removes that key so the next run does not keep the winning total. At engine load
the saved value (finite, non-negative) is added once to starting Laundered Cash; Judge presets
neither read nor write it. All storage access is wrapped, so missing or throwing storage is silently
ignored.

**Judge demo reset:** open the browser console, run `clearSave()`, then reload the page.
`clearSave()` removes only that key and does not change the active run.

## Dealer wear-out

Each tier has a lifetime `capacity` in `dealerTiers` (Common 100, Rare 300, Legendary 1,000 units). Dealers carry `unitsSold`; a missing counter means full capacity (`dealerRemainingCapacity`). `processDealerSales` caps each dealer's tick sales to remaining capacity. At zero the dealer is removed, their lots return to `dealerId: null`, and `{ id, tier }` is appended to `playerState.dealerDepartures`, which main.js reads to show a departure message. Roster cards show `remaining/max units`, with "Wearing out" strictly below 20%.

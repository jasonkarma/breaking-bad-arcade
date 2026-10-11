# Street UI (right panel)

`index.html` is a static page: left `#lab-panel` slot (owned by the lab UI work) and the
right `#street-panel` (owned by `street-ui.js`). Script order is `engine.js`, then
`street-ui.js`; load the engine once. `street-ui.js` only reads the engine globals
(`playerState`, `rollDealerGacha`, `hireDealer`, `launderCash`) and polls every 250 ms to
refresh; it never calls `tick()`.

Hiring adapter: `rollDealerGacha()` once, `hireDealer(tier)` once, then deduct $500 from
`playerState.cash`. Insufficient funds or a rejected hire change nothing. Panic is
suspicion strictly above 80 (`.street-panic` on `#street-panel`).

`node --test street-ui.test.cjs` uses a tiny fake DOM and the real engine in `vm`; it needs
no browser. Screenshots use the preinstalled Playwright Chromium.

## Arcade cabinet layout

`index.html` wraps everything in `#game-viewport` > `#cabinet` (16:9, fitted with `min(100vw, 177.78vh)`; windows narrower than 4:3 fill the window instead). The persistent `#hud` holds Cash, Laundered, Suspicion, `INVENTORY` total plus the image `#inventory-tray` (see `inventory-scorecard.md`) and the `#nav-lab` / `#nav-street` tabs. `#lab-container` and `#street-container` are never visible together: `switchView(target)` in `main.js` only toggles `.hidden`, so cooks and dealer sales keep running on the hidden screen. Panic (suspicion > 80) adds `.panic-mode` to `#game-viewport` and `data-panic` on `#hud`. The bribe price lives in `playerState.bribeCost` ($1,000, doubling per bribe, reset by a raid, which also clears the dealer roster).

## Street grid

Desktop: map spans rows 2-4 of the left column with `.street-risk` (Suspicion) directly under it in row 5; the dealer roster spans rows 4-5 on the right and `#dealer-roster` flexes to fill it, scrolling internally. Status sits in row 6. In the narrow stacked layout the DOM order is map, Suspicion, stats, actions, roster (list capped at 5.5em).

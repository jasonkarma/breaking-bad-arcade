# Breaking Bad — Arcade

A fictional, browser-based arcade game about running a lab and a street
operation. It is a static, dependency-free vanilla JavaScript project: no
build step, no backend, no database.

You cook compounds in **The Lab**, sell and launder the proceeds in **The
Streets**, keep **Suspicion** below the raid threshold, and try to retire with
over $1,000,000 in laundered cash.

## Quick start

Requires Python 3 (any static file server works) and a modern browser.

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000/>. Opening `index.html` directly also works, but a
server is recommended so the bundled audio and video load reliably.

## How to play

You start with $1,000 in cash and three lab slots.

### The Lab

- Pick one of five compounds (AM-01 to AZ-05) and a workflow
  (**Rapid**, **Standard** or **Precision**).
- Tune each compound's **Potency** (1–5), **Yield** (8/16/24) and **Base
  time** (10/24/40 minutes). The panel shows the batch cost and the selling
  price per unit before you commit.
- **Start Cook** needs a free lab slot and enough dirty cash. Finished batches
  become inventory, graded 1–4 by their overall performance score. About 5% of
  cooks come out as the rare **Flawless Blue** (grade 5), with a special
  reveal and a voice cue.
- **Add Lab Slot** buys the next slot: $5,000 (2nd), $30,000 (3rd), $50,000
  (4th).

### The Streets

- **Burner Phone Call ($500)** hires a dealer through a gacha roll: Street
  Hustler (Common), Middle-Man (Rare) or Cartel Distributor (Legendary).
  Dealers sell your stock, and wear out after a lifetime sales capacity
  (100 / 300 / 1,000 units) and then leave.
- **Launder Money** converts dirty cash into laundered cash.
- **Bribe Informant ($1,000)** cuts Suspicion by 25 points.
- Cooking and dealer sales raise Suspicion. Above 80 the screen goes into
  siren-and-radar panic, and each second carries a random chance of a DEA raid.

### Ending the run

| Ending | Trigger | Result |
|---|---|---|
| **ESCAPED** | Laundered cash reaches $1,000,000, then you click **Call the Vacuum Repairman** | You win; saved legacy funds are cleared |
| **BUSTED** | A DEA raid happens | Dirty cash, equipment, active cooks and suspicion are wiped; laundered cash is saved as legacy funds for the next run |

Either ending shows a CRT-style scorecard with net profit, reputation and
legal evasion.

**Roguelite legacy funds:** after a raid, your laundered cash is saved in the
browser's `localStorage` (key `blueSkyLegacyFunds`) and added to your starting
laundered cash next time.

## Controls

| Input | Action |
|---|---|
| Mouse / touch | All game buttons and the **The Lab** / **The Streets** tabs |
| `Music: On/Off` button | Toggle background music (effects keep playing) |
| `Escape` | Close the scorecard dialog |

### Judge / demo shortcuts

Hidden keys for demos and testing:

| Key | Action |
|---|---|
| `1` / `2` / `3` | Load the Early / Mid / Late game preset |
| `U` or `Shift+U` | Grant a free Flawless Blue batch for the current selection |
| `8` | Grant $1,000,000 of dirty cash |

To reset saved legacy funds, run `clearSave()` in the browser console and
reload.

## Project structure

| File | Purpose |
|---|---|
| `index.html` | Page, arcade-cabinet layout, and all styles |
| `engine.js` | Game engine: state, cooking, pricing, dealers, laundering, suspicion, raids, presets, legacy funds. Also runs in Node (`node engine.js` logs a snapshot each second) |
| `lab-ui.js` | Lab panel (read-only view over the engine) |
| `street-ui.js` | Streets panel: hiring, laundering, bribes |
| `main.js` | Integration layer: HUD, Start Cook, lab slots, dealer roster, inventory tray, Flawless reveal, end game and scorecard, keyboard shortcuts |
| `audio.js` | Web Audio: procedural "Dust and Static" music, click, siren and static effects, cook-complete cues |
| `assets/` | Images, the Flawless reveal video, and the voice clip (`assets/audio/`) |
| `*.test.cjs` | Node tests for each script |
| `Dockerfile`, `deploy/Caddyfile`, `railway.json`, `scripts/railway_deploy.py` | Railway deployment |
| `.party/` | Project notes per module, and the committed check manifest |

Scripts load in this order: `engine.js`, `audio.js`, `lab-ui.js`,
`street-ui.js`, `main.js`. The engine ticks once per second and the UI layers
only read its state and call its operations.

## Testing

Requires Node.js (tests use only built-in modules; no `npm install`).

```bash
node --check engine.js lab-ui.js street-ui.js main.js audio.js
node --test engine.test.cjs lab-ui.test.cjs street-ui.test.cjs main.test.cjs audio.test.cjs
```

The same commands are listed in `.party/checks.json`.

## Deployment

The game is served as static files by Caddy in a container
(`Dockerfile`) on Railway (`railway.json`, health check at `/version.json`).
`scripts/railway_deploy.py` deploys and verifies a revision; it needs a
`RAILWAY_TOKEN` environment variable and the `railway` CLI. Never commit the
token. Production: <https://bb-arcade-production.up.railway.app>. See
`.party/deployment.md` for targets and triggers.

## Credits and notes

- The game is fictional; compounds are abstract lab identifiers and no real
  production details are depicted.
- Background music is original and synthesized in code.
- `assets/audio/youre-goddamn-right.mp3` is a short third-party dialogue
  excerpt; its source is in `assets/audio/README.md`.

# Project checks

`.party/checks.json` runs from this project directory:

- `node --check` for `engine.js`, `lab-ui.js`, `street-ui.js`, `main.js` and `audio.js`
- `node --test engine.test.cjs lab-ui.test.cjs street-ui.test.cjs main.test.cjs audio.test.cjs` (engine
  mechanics, lab UI, street UI and integration behavior; no artifacts or caches)

Write any new generated artifacts to `PARTY_OUTPUT_DIR` and caches to
`XDG_CACHE_HOME`.

Railway deployment targets, triggers, and the manual test are in
`deployment.md`.

## Runtime files and committed checks

Party injects `.claude/skills/` and `.agents/skills/` and downloads attached
session context to `.skipper/sessions/`. These are ephemeral, project-local
runtime files; `.gitignore` excludes them. Keep `.party/` guidance and
`.party/checks.json` tracked.

The cooking-speed commit accidentally tracked six `.claude/skills/` files.
Party later removed those injected files, leaving tracked deletions that
blocked validation before any check command ran. An ignore rule cannot hide
already tracked files: remove them from the index and commit the cleanup.

Before finishing, inspect the complete repository with
`git status --porcelain=v1 --untracked-files=all`, commit intended changes,
then run every command in `.party/checks.json` on that commit. A manual test
pass does not replace Party's commit-before-check validation. Party owns
approval and final merging; report a remaining policy blocker accurately.

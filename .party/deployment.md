# bb-arcade Railway deployment

This project is a static frontend. It does not deploy a backend or database.

## Targets

- Railway project: `Breaking Bad` (`57534ee8-5fbd-4c5c-b63c-ce8d59f9bfda`)
- Environment: `production` (`16492a4e-0aa5-46d2-b6fa-bc37ac9cf1e5`)
- Service: `bb-arcade` (`aecec208-ad66-42e1-be4f-a8d0c67138e0`)
- Public URL: https://bb-arcade-production.up.railway.app
- Credential: repository Actions secret `RAILWAY_TOKEN` (project token for this environment only). Never commit the value.

The token's project has no Conquest `frontend`, `backend`, or `Postgres` service. The deployer refuses to continue if those names appear.

## Trigger

Workflow: `.github/workflows/bb-arcade-railway.yml`

- Push to `main` that changes `projects/45f927f18b09419e9b9ee0033579f027/**` or this workflow
- Manual run: Actions → **Deploy bb-arcade to Railway** → **Run workflow** on `main`

Deploy runs only after `.party/checks.json` succeeds, and only for `main`. A failed check or a failed Railway deployment does not replace the last healthy release.

## Manual test

From this project directory, with `RAILWAY_TOKEN` set and `railway` on `PATH`:

```bash
export DEPLOY_REVISION="$(git rev-parse HEAD)"
python3 scripts/railway_deploy.py
```

Success requires Railway status `SUCCESS`, `GET /` containing `Breaking Bad`, HTTP 200 for `engine.js`, `audio.js`, `lab-ui.js`, `street-ui.js`, `main.js`, and `assets/audio/youre-goddamn-right.mp3`, and `/version.json` `version` equal to `DEPLOY_REVISION`.

Verified on 2026-10-10: https://bb-arcade-production.up.railway.app served revision `1137a7d9a60f2a3d8cabff8a2a39a9cd0758da3d`.

## Not this deployment

Conquest workflow run `38088701698` deploys the separate Conquest frontend, backend, and database. It is not evidence for this game.

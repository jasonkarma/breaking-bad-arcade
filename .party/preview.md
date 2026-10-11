# Local preview

This project is a static frontend. No install step and no backend.

From this project directory, serve the files on localhost only:

```bash
python3 -m http.server "$PORT" --bind 127.0.0.1
```

Party Preview should use that command with a port from `party port allocate`.
Open `/` and confirm the Cook Lab compound cards render. `engine.js` starts
its loop in the page; that is expected and does not need a separate process.

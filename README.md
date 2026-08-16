# Macro Dash

A SAS-themed HTML5 platform bouncer (see PLAN.md), deployable to SAS 9 / Viya / SASjs Server via `@sasjs/cli` streaming.

## Local development (no SAS required)

```bash
npm install
npm run devsetup
```

That's it. `devsetup` (scripts/devsetup.js) downloads the `@sasjs/server` binary for your platform from [GitHub releases](https://github.com/sasjs/server/releases/latest) into `tools/sasjs-server/`, writes a `.env` (desktop mode, JS runtime - no SAS installation needed), starts the server on port 5000, deploys the app (`sasjs cbd -t local`) and the JS mocks, then prints the URL:

**http://localhost:5000/AppStream/MacroDash/**

The script is idempotent - existing downloads and `.env` edits are kept, and an already-running server is reused. Server logs: `tools/sasjs-server/server.log`. (If your shell exports `NODE_OPTIONS`, the bundled Node may reject it - the script already starts the server with `NODE_OPTIONS=""`.)

The four backend services are executable JS mocks (same pattern as react-seed-app / Data Controller), deployed to SASjs Drive where they shadow the `.sas` services. The leaderboard works end-to-end: settings persist on the SASjs Drive (`<drive>/macrodash.settings.json`), scores in the configured rootdir as `scores.json` (the mock analogue of `sb.scores`), and the mock `configure.js` even stamps `configured="true"` into the streamed `index.html` via the Drive API - like the real SAS service. Nothing is written to /tmp.

### Day-to-day

```bash
npm run deploy       # redeploy app to the local server (sasjs cbd -t local)
npm run mock:deploy  # redeploy only the mocks (scripts/deploy-mocks.js)
```

To reset the mock state: delete `<drive>/macrodash.settings.json` (under `tools/sasjs-server/sasjs_root/drive/`) and the configured rootdir's `scores.json`.
To stop the server: `pkill -f api-linux` (or `api-macos` / `api-win.exe`).

### Other scripts

- `npm start` — static-only serving of `src/` on :8000 (no backend; localStorage mode)
- `npm test` — reachability test (BFS over engine physics for all levels)
- `npm run prepare` — refresh `src/sasjs.js` from `node_modules/@sasjs/adapter`

## Deploying to real SAS

Targets `server` (sas.4gl.io), `viya`, `sas9` live in `sasjs/sasjsconfig.json`:

```bash
sasjs cbd -t server   # or viya / sas9
```

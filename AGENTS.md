# Macro Dash — agent/developer notes

Hard-won design decisions and platform learnings. Read this before changing the game, the services, or the dev environment. (What/why: PLAN.md. How to run: README.md.)

## Frontend architecture

- Vanilla JS, no framework/bundler, single `<canvas>`; scripts load via plain `<script src>` tags in dependency order (`sasjs.js` → `js/backend.js` → `level.js` → `audio.js` → `engine.js` → `game.js` → `controls.js`).
- **Strict CSP**: `default-src 'self'`, no `unsafe-*`. Consequences:
  - no inline `<script>`/`<style>`, no `element.style.*` mutations — canvas is sized via `width`/`height` attributes, all layout lives in `macrodash.css`
  - no `eval` / CDN / external fonts
  - (this also means test pages that inject inline scripts must strip the CSP meta tag — it really works)
- `js/engine.js` is renderer-agnostic (tilemap, AABB physics, camera); levels are swapped with `eng.setLevel(rows)` (canvas height derives from row count).
- `test/reachability.js` loads the REAL level + engine via a DOM shim and BFS-explores the physics: every `&` and the portal must be reachable with the FORMAT boost, and `&` at row ≤ 5 must be UNREACHABLE without it. Run `npm test` after ANY level or physics change. Note: it cannot detect an unstompable ABORT (portal gate) — keep ABORTs on open floor/platforms.

## Game design rules

- A game is ONE RUN across all levels: amps, health, error/warning counts and the speedrun clock carry over; `init(true)` = new run, `init(false)` = next level. The score is finalised ONLY at death or the final portal (`finalizeRun()`); mid-level portals show a running total.
- Touching an ABORT ends the job instantly (100 damage). Stomping one heals +25 health. The portal refuses while an ABORT lives in the level ("ERROR: ABORT outstanding").
- HUD counts live REMAINING ERROR/WARNING enemies per level (counts down as you stomp); hits taken are tracked separately for the finale stamp.
- Player sprite (SAS running man) is white; title/finale runners too.
- On-screen controls (`js/controls.js`): RUN button doubles as ENTER on every non-play state (title/dead/win/winname/config/complete/board) — keep the inverted state check (`s !== "play" && s !== "pause"`), NOT an allowlist. Canvas tap = ENTER on non-play screens (mobile). Buttons release on mouseup/mouseleave/touchend/blur so they never stick.

## Backend contract (frontend ↔ SAS / mock)

- `js/backend.js` wraps `@sasjs/adapter` (`window.SASjs`). Adapter config is read from the hidden `<sasjs>` element in index.html; when streamed by SAS there is no `serverUrl` (same-origin ⇒ CSP-safe).
- `adapter.request()` resolves with the webout JSON ALREADY UNWRAPPED: `res.mytable[0].COL` (uppercase columns). A table named `result` is fine — do NOT add a `res.result` unwrapping layer (it breaks exactly that case).
- Services return the standard automatic fields (`_PROGRAM`, `SYSDATE`, `SYSTIME`, `_METAUSER`, `SASJSPROCESSMODE`) plus data tables.
- Every call has a hard 5s timeout; failure degrades to localStorage mode.
- **The `<sasjs configured="...">` attribute is the config flag**: the `configure` service rewrites the streamed `index.html` itself (Drive API `GET` + `PATCH` on SASjs Server via `%ms_getfile`/`%ms_createfile`), so the page knows synchronously at load. When unconfigured the frontend calls NO services except `configure` — no `getconfig` round trip. (On Viya the streamed html cannot self-update; maintain the stamp at deploy time.)
- Leaderboard only exists with a backend: offline the finale board shows the local best run instead. `savescore` aborts when unconfigured (%mp_abort).

## JS mocks (local dev, no SAS)

- `sasjs/mocks/sasjs/services/common/*.js` run on a local `@sasjs/server` (`MODE=desktop`, `RUN_TIMES=js`); they shadow the `.sas` services on the Drive. `npm run devsetup` sets everything up; `npm run mock:deploy` redeploys mocks only (Drive API upload — `sasjs fs sync` needs SAS, don't use it here).
- JS stored-program runtime gotchas (see the `sasjs-server` skill for the full list):
  - `fs` is predeclared — re-requiring it crashes the program
  - input tables arrive EITHER as inline CSV consts OR as uploaded files (`_WEBIN_FILEREF<n>` = Buffer of contents, `_WEBIN_NAME<n>`, `_WEBIN_FILE_COUNT`) — handle both; these consts are module-scope, NOT on `globalThis`
  - adapter CSV: space-separated `name:format.` headers (strip `:format.`), CRLF endings, double-quoted special values
  - mocks persist state WITHOUT /tmp: settings on the Drive (`<drive>/macrodash.settings.json`, derived from `weboutPath` → `../../../drive`), scores as `scores.json` inside the configured rootdir (a real local folder - the analogue of `sb_rootdir/scores.sas7bdat`)
- Mock behaviour must mirror the real services: empty leaderboard until configured + scores exist; `savescore` throws when unconfigured.

## Testing / headless verification

- `npm test` = reachability BFS. Browser smoke tests: headless chromium + pixel analysis (glyph bounding boxes by color) was used to fix title-screen layout — the model can't view images, so measure, don't eyeball.
- `window.MACRODASH_FORCE(state)` and `window.MACRODASH_STATE()` exist as test hooks for driving screens headlessly.

## Conventions

- Markdown files: NO manual line wrapping — one paragraph/line per logical line; let the editor's word wrap handle display.
- Never commit `tools/`, `sasjsbuild/`, `sasjsresults/`, `node_modules/` (see .gitignore). Releases are pipeline-driven; don't bump versions.

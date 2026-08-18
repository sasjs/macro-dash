# Macro Dash — Game Plan

A pure HTML5 platform "bouncer" in the spirit of early Mario, themed entirely around SAS (the language, the platform, the institute). Written for SAS users — the jokes are for us.

## Concept

You are the **SAS Runner** — a little DATA step character looping through variables. Run and jump through levels, avoid `ERROR:` and `WARNING:` enemies, collect ampersands (`&`), and reach the end of the step with your health (log status) intact.

## Core mechanics

- **Run & jump** platforming (keyboard + mouse + on-screen pad).
- **Health bar** = log status. Hits drain it: `ERROR:` enemies 34, `WARNING:` enemies 12. Zero health = job aborted (run ends).
- **ABORT enemies** (fast, dark magenta): touching one ends the job *instantly*. Stomping one heals +25 health. A level's portal refuses to complete while an ABORT is alive.
- **One run, one score:** a game spans all levels — amps, health, counts and the speedrun clock carry over. The score is finalised at death or at the final portal, via **macro resolution**: `&&` resolves to `&`, so collected ampersands collapse through nesting passes for the score.
- **Goal:** reach the `PROC PRINT` portal at the end of each level.
- **Power-up:** the **FORMAT mushroom** (`10.2`) — 12 seconds of super jump (~5 tiles vs ~3), bigger sprite, one-hit protection. High ampersand clusters are gated behind it (enforced by the reachability test).
- **Controls:** arrows/WASD + Space jump, Shift run; mouse (click canvas); on-screen pad (RUN button left — doubles as ENTER on menus; arrows right, up = jump). Canvas tap = ENTER on non-play screens.
- **Character:** the SAS "running man" in white, 2-frame run cycle.
- Dropped (decided against): PROC SORT freeze, `%LET invincible=1;` star.

## Levels

1. **The WORK Library**
2. **Batch at Midnight** — floor gaps, first ABORT patrol
3. **Report-Teleports to HQ** (Cary, NC) — hardest: 3-tile gaps, two ABORTs, ERROR guarding the portal, two FORMAT-gated clusters

Finale: "JOB COMPLETE" celebration animation → high score board (backend leaderboard, or local best run when no backend is configured).

## Backend (optional)

Leaderboard via three services (`configure` / `getscores` / `savescore`). The `<sasjs configured="...">` attribute in index.html is the config flag — the configure service rewrites the streamed index.html itself. Unconfigured ⇒ no service calls except configure; scores live in localStorage. Local dev uses executable JS mocks on a local @sasjs/server (`npm run devsetup`). See AGENTS.md for the contract details and gotchas.

## Tech constraints

- Pure HTML5 canvas, **vanilla JS, no framework/bundler**.
- **CSP: no `unsafe-*` directives at all** (`default-src 'self'`, `object-src 'none'`, `base-uri 'self'`): no CDN/fonts, no `element.style.*` mutations (canvas sized via attributes), no `eval`.
- Deployment: `@sasjs/cli` streaming (`streamWeb: true`), served from a SAS job — same model as pacman.
- Audio: synthesized WebAudio (no files ⇒ no `media-src` needed); starts on user gesture. 112 BPM E-minor funk loop + jump/collect/hit SFX.
- `npm test` = reachability BFS over real engine physics (all levels).
- Retro pixel-art feel; SAS-blue palette; SAS log messages as flavor text.

## Milestones (all done)

1. ~~Project scaffold, strict-CSP-safe build~~
2. ~~Core engine: physics, tilemap, camera~~
3. ~~Levels 1–3 incl. FORMAT gating + ABORT mechanics~~
4. ~~Health/damage, game-over ("Job aborted"), run-based scoring~~
5. ~~Audio: funk loop + SFX~~
6. ~~Polish: title screen, pause, particles, on-screen pad~~
7. ~~Backend: leaderboard, configure flow, JS mocks, finale animation~~

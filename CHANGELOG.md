# [1.4.0](https://github.com/sasjs/macro-dash/compare/v1.3.3...v1.4.0) (2026-08-19)


### Features

* configurator 4-way options + e2e suite + CI workflow ([9bee4e7](https://github.com/sasjs/macro-dash/commit/9bee4e71a42144a4d7316183fdeefda815cda8b0)), closes [#scores](https://github.com/sasjs/macro-dash/issues/scores)

## [1.3.3](https://github.com/sasjs/macro-dash/compare/v1.3.2...v1.3.3) (2026-08-19)


### Bug Fixes

* request initials for DNF runs + make the dump screen #scores ([f94270e](https://github.com/sasjs/macro-dash/commit/f94270e18a9d766ed7299752c84c4716cb70a6d3)), closes [#scores](https://github.com/sasjs/macro-dash/issues/scores) [#scores](https://github.com/sasjs/macro-dash/issues/scores) [hi#score](https://github.com/hi/issues/score) [#scores](https://github.com/sasjs/macro-dash/issues/scores)

## [1.3.2](https://github.com/sasjs/macro-dash/compare/v1.3.1...v1.3.2) (2026-08-19)


### Bug Fixes

* record DNF runs on the local-only leaderboard ([0dec29a](https://github.com/sasjs/macro-dash/commit/0dec29ae2da7e646d43531009e1968edc3e76ccc))

## [1.3.1](https://github.com/sasjs/macro-dash/compare/v1.3.0...v1.3.1) (2026-08-19)


### Bug Fixes

* show initials on local best-scores board + make #scores a page ([9bd4bfb](https://github.com/sasjs/macro-dash/commit/9bd4bfb9b666ca044a9e710bf1e1c00451cc206b)), closes [#scores](https://github.com/sasjs/macro-dash/issues/scores) [hi#score](https://github.com/hi/issues/score) [hi#score](https://github.com/hi/issues/score) [#scores](https://github.com/sasjs/macro-dash/issues/scores) [#scores](https://github.com/sasjs/macro-dash/issues/scores)

# [1.3.0](https://github.com/sasjs/macro-dash/compare/v1.2.0...v1.3.0) (2026-08-19)


### Features

* multiplayer leaderboard (mf_getuser name, DNF entries) + board buttons ([472f47b](https://github.com/sasjs/macro-dash/commit/472f47b6ad25f5360d3eb592b2bf0f4ab091e759)), closes [hi#score](https://github.com/hi/issues/score)

# [1.2.0](https://github.com/sasjs/macro-dash/compare/v1.1.0...v1.2.0) (2026-08-19)


### Features

* deliberate post-configure RUN + SAS log download link ([cff7752](https://github.com/sasjs/macro-dash/commit/cff77524af0a58b40b829885a91a6b05e1f87b09))

# [1.1.0](https://github.com/sasjs/macro-dash/compare/v1.0.0...v1.1.0) (2026-08-18)


### Features

* SAS 9 support for configure (stamp clickme STP) + md_init settings read ([901f59e](https://github.com/sasjs/macro-dash/commit/901f59ea6ec39d89e411b0ca54ed9b8673ecb8c1))

# 1.0.0 (2026-08-18)


### Bug Fixes

* 30s timeout for Viya metadata fetches (contexts payload is MBs over slow links) ([818b29a](https://github.com/sasjs/macro-dash/commit/818b29a475f41edef0b7d5da88a734c1427e277a))
* brighten footer credits for readability ([0e713dd](https://github.com/sasjs/macro-dash/commit/0e713dde1b69b428de5d71c73d8748b53229b81f))
* correct repo url in .releaserc (macro-dash, not macrodash) ([d05dc51](https://github.com/sasjs/macro-dash/commit/d05dc51c692e66f1a9f3d30e36e266b513cc6704))
* deaths are DNF - leaderboards only count completed runs (legacy entries purged) ([9bced65](https://github.com/sasjs/macro-dash/commit/9bced658b9718538d6a2ed1205542214433d5018))
* deaths no longer record a time - only completed runs reach the board ([fbbf80f](https://github.com/sasjs/macro-dash/commit/fbbf80f6d1dd71210cdb2debb5872e1ae051758e))
* debug toggle is Ctrl+D (D types again); steps 1-2 are filter-as-you-type lists ([ac4a435](https://github.com/sasjs/macro-dash/commit/ac4a435de12c279c176b8a04d0cac5ca8ac4539c))
* defer+remove adapter tag so the build rewrites the URL and execution stays lazy ([043ea57](https://github.com/sasjs/macro-dash/commit/043ea5780c6cc03546f972bc4d932f4eb7893821))
* mf_existvar (not mf_existcol) ([d1346bd](https://github.com/sasjs/macro-dash/commit/d1346bdae2f3a7c7651932d84e88032de40eada8))
* no leaderboard submission on death (backend included) - DNF means DNF ([1208b14](https://github.com/sasjs/macro-dash/commit/1208b146714ad1f47d9d0e5263032502c909cfa0))
* pages build ([0d85f45](https://github.com/sasjs/macro-dash/commit/0d85f45eadcc7a946233a8023dd53b1534a44d7d))
* personal best dates in DDMMMYY hh:mm (SAS DATE7. + time) ([81f6c8c](https://github.com/sasjs/macro-dash/commit/81f6c8c3b94212149662566164b66be8b32912b7))
* prefetch link carries the build-rewritten sasjs.js URL for the lazy loader ([6863458](https://github.com/sasjs/macro-dash/commit/68634585aa239d04c588f34fba5105c72972e8c5))
* serve game from branch-based Pages (nojekyll + root redirect) ([bd7be8c](https://github.com/sasjs/macro-dash/commit/bd7be8cadd0478a32ea5748d9922eabb1df55aa6))
* show interactive identity (identities API), not the compute account ([92079bc](https://github.com/sasjs/macro-dash/commit/92079bca13d9cc9ca5e742c948f35e7fb94e9d31))
* unwrap Viya webout (res.result object) so configure success is recognised ([a200156](https://github.com/sasjs/macro-dash/commit/a2001564a1c92fd67b89fc252fd2676bd8cdcaf1))


### Features

* 3-step configurator (account -> context -> folder), mouse-clickable, key-swallowing ([c18d59b](https://github.com/sasjs/macro-dash/commit/c18d59b32d8faee21727307af13dd97585a40857))
* ABEND dump finish page on death with high scores ([2c2d5f2](https://github.com/sasjs/macro-dash/commit/2c2d5f251146f0bcae3eb310c126bfe7b780d0f9))
* backend config ([179bb9a](https://github.com/sasjs/macro-dash/commit/179bb9aa62aa4b8ab5cba82e2c4e1bf63a72e6f3))
* clean-log gate on portal, amps = health only, time-only leaderboards ([ef57c42](https://github.com/sasjs/macro-dash/commit/ef57c426c0eb453b632f8d6df46123536bc18ad4))
* configure stamps the chosen compute context into MacroDash.html (DC pattern) ([fd1cad3](https://github.com/sasjs/macro-dash/commit/fd1cad30606c47985d672e5648f1c47115004ca6))
* context picker shows only reusable contexts with a runAs identity ([4afee78](https://github.com/sasjs/macro-dash/commit/4afee78f814d2441e9c6bc24095cd4565231dae4))
* custom domain dash.sasjs.io ([1e886e4](https://github.com/sasjs/macro-dash/commit/1e886e4cdbe5b9eed6f62ee8a89a33cbbed53aae))
* debug always on, useComputeApi switch, delete settings job before recreate (409 fix) ([0b0649d](https://github.com/sasjs/macro-dash/commit/0b0649d085e00b8b52cf7bd8b6de13b5bd62ae52))
* favicon using existing macrodash.png logo ([f512207](https://github.com/sasjs/macro-dash/commit/f5122076b6e1042884f68abdd575769886a2e037))
* footer with repo link and 4GL Apps credit ([040a5d2](https://github.com/sasjs/macro-dash/commit/040a5d255811cd7396e8aa10403985f8e4c1a7f6))
* ghost-autocomplete filters, username top-right on setup screen ([c8d33ca](https://github.com/sasjs/macro-dash/commit/c8d33cab9f6db96c2e714db8e87695e195229211))
* lazy-load sasjs adapter; Viya compute context picker on setup screen ([5f06462](https://github.com/sasjs/macro-dash/commit/5f064625cd239247b291b715de1716e3ae482143))
* per-level local leaderboards (fastest times) + final run leaderboard ([9057716](https://github.com/sasjs/macro-dash/commit/905771606cf1b7b3f38cace39137f38a41f948bc))
* personal best history (DD/MM/YY hh:mm) on finish pages; footer links open in new tab ([7341f0a](https://github.com/sasjs/macro-dash/commit/7341f0ad269b4896f35f5fee93d42a0f1421d653))
* remember last 10 local runs on the high score board ([7021a79](https://github.com/sasjs/macro-dash/commit/7021a79dcf6cb84023b930a84a793b4baea3c645))
* runAsTask UI switch (OPTIONS step), stamped into MacroDash.html by configure ([0720078](https://github.com/sasjs/macro-dash/commit/072007817d1ee3344bf80fe37f090208cc7b6d55))
* SASLogon session gate on configurator (adapter checkSession, L opens login) ([69c4223](https://github.com/sasjs/macro-dash/commit/69c4223a01ddddc9c100b84bb6b34b015421dffc))
* searchable context picker with runAs identity, job-based context test ([2dea634](https://github.com/sasjs/macro-dash/commit/2dea6349f0e7c51ec23a97fa69cbe269482ed114))
* searchable, windowed account picker (handles hundreds of batch ids) ([69bb054](https://github.com/sasjs/macro-dash/commit/69bb0540f1e6116b4c297fddb3b5dd162f08c7e7))
* timestamp personal bests (MM/DD/YY hh:mm) ([06fe1f4](https://github.com/sasjs/macro-dash/commit/06fe1f497819c3953fcefa644510c0d437ac3727))
* viya services and pipeline ([ead480d](https://github.com/sasjs/macro-dash/commit/ead480dc4241fb2647c71a519df73e7d449ebca0))
* wizard-style configurator - collapsible steps with status, clickable headers ([d474f77](https://github.com/sasjs/macro-dash/commit/d474f772fa98e2ba6acce0000518f3f06f21e0f9))

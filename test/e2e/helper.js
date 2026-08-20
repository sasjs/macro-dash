/* Shared helpers for the Playwright e2e suite (runs against the local
 * @sasjs/server, whose JS mocks act as a fully-functional backend).
 *
 * Each test is a standalone script that exits 0 (pass) / 1 (fail); run.js
 * executes them in sequence.  No test-runner dependency - matches the
 * existing `npm test` (reachability BFS) style. */
const { chromium } = require('playwright');

// candidate chromium executables, in priority order: Playwright's bundled
// (downloaded by `npx playwright install chromium`), then common system
// paths.  The first that exists is used.
const SYS_PATHS = ['/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome', '/snap/bin/chromium'];
let _exe = null;
function resolveExe() {
  if (_exe !== null) return _exe;
  if (process.env.CHROMIUM && require('fs').existsSync(process.env.CHROMIUM)) { _exe = process.env.CHROMIUM; return _exe; }
  for (const p of SYS_PATHS) if (require('fs').existsSync(p)) { _exe = p; return _exe; }
  return undefined; // undefined => let Playwright use its bundled chromium
}

const APP = process.env.MD_APP || 'http://localhost:5000/AppStream/MacroDash/';
const SRC = process.env.MD_SRC || 'http://localhost:8123/index.html'; // no-backend

let _pass = 0, _fail = 0;
const results = [];

function ok(name) { _pass++; results.push(['PASS', name]); console.log('  PASS', name); }
function bad(name, detail) { _fail++; results.push(['FAIL', name]); console.log('  FAIL', name, detail || ''); }

async function launch(viewport) {
  const opts = {};
  const exe = resolveExe();
  if (exe) opts.executablePath = exe;
  const b = await chromium.launch(opts);
  const ctx = await b.newContext({ viewport: viewport || { width: 640, height: 480 } });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') console.log('    CONSOLE-ERR', m.text().slice(0, 150)); });
  return { b, p };
}

/* press a key via a synthetic keydown (works regardless of focus, unlike
 * page.keyboard.press which the browser can intercept e.g. for Tab).
 * For letter keys we also set `key` so the text-entry handler (which
 * tests e.key, not e.code) accepts the character. */
const KEY_KEY = { Enter: 'Enter', Tab: 'Tab', Escape: 'Escape',
  Backspace: 'Backspace', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Space: ' ' };
async function press(p, code) {
  const key = KEY_KEY[code] != null ? KEY_KEY[code]
    : /^Key([A-Z])$/.test(code) ? code.slice(3)
    : /^Digit([0-9])$/.test(code) ? code.slice(5)
    : code;
  await p.evaluate(k => document.dispatchEvent(new KeyboardEvent('keydown', { code: k.code, key: k.key })),
    { code, key });
}

async function state(p) { return p.evaluate(() => window.MACRODASH_STATE()); }
async function levelIdx(p) { return p.evaluate(() => window.MACRODASH_LEVELIDX()); }

/* reach the level-N portal via the test hook (clears enemies + teleports),
   letting update() run the real portal-collision code path.  Poll for the
   win state up to ~3.5s so slow CI runners don't flake a fixed sleep. */
async function reachPortal(p) {
  await p.evaluate(() => window.MACRODASH_REACH_PORTAL && window.MACRODASH_REACH_PORTAL());
  for (let i = 0; i < 35; i++) {
    const s = await p.evaluate(() => window.MACRODASH_STATE());
    if (s === 'win' || s === 'complete') return;
    await p.waitForTimeout(100);
  }
}

function summary(name) {
  console.log('---');
  console.log(name + ': ' + _pass + ' pass, ' + _fail + ' fail');
  return _fail;
}

/* expose for the runner */
module.exports = { APP, SRC, ok, bad, launch, press, state, levelIdx, reachPortal, summary,
  get pass() { return _pass; }, get fail() { return _fail; }, get results() { return results; } };

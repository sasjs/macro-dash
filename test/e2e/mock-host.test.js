/* Mock host: the browser build's own backend (service worker + @sasjs/api).
 *
 * Serves sasjsbuild/mock exactly as a static host does - no API process
 * anywhere - and covers the two things only that arrangement can show:
 *
 *   1. configure reaches the mock service and survives a reload (the page
 *      cannot be re-stamped by a host, so the browser keeps the flag);
 *   2. a site whose drive holds no settings is NOT locked out of setup: the
 *      remembered flag is checked against the drive at start-up and dropped,
 *      and C still opens the configurator.  Without the await in game.js this
 *      test fails with the state stuck on "title".
 *
 * Build first: `npm run mock:build` (the CI test job does this before devsetup).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const H = require('./helper');

const ROOT = path.join(__dirname, '..', '..', 'sasjsbuild', 'mock');
const PORT = parseInt(process.env.MD_MOCK_PORT || '8124', 10);
const URL = 'http://localhost:' + PORT + '/';

function startServer() {
  if (!fs.existsSync(path.join(ROOT, 'sw.js'))) {
    console.log('  FAIL sasjsbuild/mock has no sw.js - run npm run mock:build');
    process.exit(1);
  }
  const child = spawn('python3', ['-m', 'http.server', String(PORT)],
    { cwd: ROOT, stdio: 'ignore', detached: true });
  child.unref();
  return child;
}

async function waitForServer() {
  const http = require('http');
  for (let i = 0; i < 40; i++) {
    const up = await new Promise(resolve => {
      const req = http.get(URL, res => { res.resume(); resolve(res.statusCode === 200); });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
    if (up) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

/* the worker has to be in control before a service call means anything */
async function waitForHost(p) {
  for (let i = 0; i < 40; i++) {
    const ready = await p.evaluate(() => !!(window.MACRODASH_BACKEND &&
      navigator.serviceWorker.controller)).catch(() => false);
    if (ready) return true;
    await p.waitForTimeout(250);
  }
  return false;
}

(async () => {
  const server = startServer();
  const { b, p } = await H.launch();
  try {
    await waitForServer();
    await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    (await waitForHost(p))
      ? H.ok('mock host: service worker answers for the page')
      : H.bad('mock host: no controller');

    const info = await p.evaluate(() => fetch('/SASjsApi/info')
      .then(r => r.json()).then(j => j.runTimes).catch(() => null));
    Array.isArray(info) && info.join() === 'js'
      ? H.ok('mock host: /SASjsApi/info runTimes js')
      : H.bad('mock host: info', JSON.stringify(info));

    // ---- 1. configure, then reload: the flag is the only stamp a static host has
    await H.press(p, 'KeyC'); // opens setup, and clears the field
    await p.waitForTimeout(400);
    await p.evaluate(() => window.MACRODASH_CONFIG_SET('rootdir', '/tmp/e2e-scores'));
    await H.press(p, 'Enter');
    for (let i = 0; i < 40; i++) {
      if (await p.evaluate(() => window.MACRODASH_CONFIG_DONE())) break;
      await p.waitForTimeout(250);
    }
    (await p.evaluate(() => window.MACRODASH_BACKEND.isConfigured()))
      ? H.ok('mock host: configure succeeds')
      : H.bad('mock host: configure', await p.evaluate(() => window.MACRODASH_CONFIG_MSG()));

    await p.reload({ waitUntil: 'domcontentloaded' });
    await waitForHost(p);
    await p.waitForTimeout(500);
    (await p.evaluate(() => window.MACRODASH_BACKEND.isConfigured()))
      ? H.ok('mock host: configured survives a reload')
      : H.bad('mock host: configured lost on reload');

    // ---- 2. the cleared-drive case: flag planted, no settings on the drive.
    // The drive read is delayed on purpose: it decides the answer *after* the
    // app has read it, which is the window the fix exists for.  Without the
    // delay the read can land between script tags and the lockout hides.
    await p.addInitScript(() => {
      let real = null;
      Object.defineProperty(window, 'SASjsMock', {
        configurable: true,
        get() { return real; },
        set(v) {
          real = v;
          if (v && typeof v.readAll === 'function') {
            const orig = v.readAll;
            v.readAll = function (...args) {
              return new Promise((resolve, reject) => {
                setTimeout(() => orig.apply(v, args).then(resolve, reject), 1200);
              });
            };
          }
        }
      });
    });
    await p.evaluate(() => window.SASjsMock.reset());
    await p.waitForTimeout(1500);
    await p.evaluate(() => localStorage.setItem('macrodash_configured', 'true'));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(300);

    (await p.evaluate(() => window.MACRODASH_BACKEND.isConfigured()))
      ? H.ok('cleared site: the flag answers first (the race the fix covers)')
      : H.bad('cleared site: flag not consulted at boot');

    for (let i = 0; i < 40; i++) {
      if (!(await p.evaluate(() => window.MACRODASH_BACKEND.isConfigured()))) break;
      await p.waitForTimeout(250);
    }
    (await p.evaluate(() => window.MACRODASH_BACKEND.isConfigured()))
      ? H.bad('cleared site: stale flag was kept')
      : H.ok('cleared site: stale flag dropped');

    await H.press(p, 'KeyC');
    await p.waitForTimeout(400);
    (await H.state(p)) === 'config'
      ? H.ok('cleared site: C opens the configurator')
      : H.bad('cleared site: setup locked', await H.state(p));
  } finally {
    await b.close();
    try { process.kill(-server.pid); } catch (e) { try { server.kill(); } catch (e2) {} }
  }
  process.exit(H.summary('mock-host'));
})().catch(e => {
  console.log('  FAIL mock-host threw', e && e.message);
  process.exit(1);
});

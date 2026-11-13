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
 * Build first: `npm run mock:build` - and after `devsetup`, which recompiles
 * into sasjsbuild and removes this folder (the CI job builds it immediately
 * before the suite for that reason).
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const H = require('./helper');

const ROOT = path.join(__dirname, '..', '..', 'sasjsbuild', 'mock');
let URL = null; // set once the port is known

/* A fixed port hides its own failure: the child's EADDRINUSE exit is invisible
 * with stdio ignored, anything already answering satisfies the readiness poll,
 * and the suite then drives a build it did not serve.  Ask the OS for a free
 * port instead; MD_MOCK_PORT still wins if a caller needs a known one. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function answers(port) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/' }, res => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

function startServer(port) {
  if (!fs.existsSync(path.join(ROOT, 'sw.js'))) {
    console.log('  FAIL sasjsbuild/mock has no sw.js - run npm run mock:build');
    process.exit(1);
  }
  const child = spawn('python3', ['-m', 'http.server', String(port)],
    { cwd: ROOT, stdio: 'ignore', detached: true });
  child.unref();
  return child;
}

async function waitForServer(port) {
  for (let i = 0; i < 40; i++) {
    if (await answers(port)) return true;
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
  const port = process.env.MD_MOCK_PORT
    ? parseInt(process.env.MD_MOCK_PORT, 10)
    : await freePort();
  if (await answers(port)) {
    console.log('  FAIL port ' + port + ' already answers - refusing to drive a site this ' +
      'test did not serve (a server left behind by an aborted run?)');
    process.exit(1);
  }
  URL = 'http://localhost:' + port + '/';
  const server = startServer(port);
  const { b, p } = await H.launch();
  try {
    (await waitForServer(port))
      ? H.ok('mock host: static server up on ' + port)
      : H.bad('mock host: nothing answering on ' + port);
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
                setTimeout(() => orig.apply(v, args).then(resolve, reject), 3000);
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
    /* a wall clock is not the wait: on a loaded runner the evaluate below
       would throw on an undefined MACRODASH_BACKEND and the run would report
       "mock-host threw" instead of a named failure.  The injected readAll delay
       keeps the race window open across this wait. */
    (await waitForHost(p))
      ? H.ok('cleared site: backend is up after the reload')
      : H.bad('cleared site: no backend after the reload');

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

/* The streamed deployment, served by the browser host.
 *
 * A build made with `streamWeb` writes one entry page plus the assets under
 * `<appLoc>/services/`, and rewrites every link in that page to the web tier
 * the browser fetches a file from - `/StoredProgram?_FILE=` on SASjs server.
 * On a real server those files are on the drive and the tier reads them back.
 * The mock site holds the same drive, so it has to answer the same address:
 * that is what makes the artefact the Pages build publishes the artefact a
 * server would serve, rather than a second frontend that only looks like it.
 *
 * Two things are checked, and they fail for different reasons:
 *
 *   1. the drive carries the streamed tree, and the tier answers it typed
 *      (html as html, js as js) - a bytes answer renders a blank page, so the
 *      Content-Type is the assertion, not decoration;
 *   2. the entry page, loaded the way a visitor would load it, boots the game
 *      and reaches its title screen - the links resolve, the adapter loads and
 *      the canvas is drawn, all through the tier.
 *
 * Build first: `npm run mock:build`.  Without `streamWeb` on the target the
 * drive carries no entry page at all and check 1 fails by naming the missing
 * file - which is the regression this exists for.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const H = require('./helper');

const ROOT = path.join(__dirname, '..', '..', 'sasjsbuild', 'mock');

/* the appLoc is the build's, not a constant: reading it from the build means a
 * project that moves its app is not silently tested at the old one */
function appLoc() {
  const cfg = path.join(ROOT, 'host', 'mock-config.json');
  try {
    return JSON.parse(fs.readFileSync(cfg, 'utf8')).appLoc;
  } catch (e) {
    return null;
  }
}

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

/* GitHub Pages answers a path it has no file for with 404.html and a 404
 * status; `python3 -m http.server` answers with a page of its own. The cold
 * visit below is about what the published host does, so it runs against a host
 * that behaves like that one rather than against the one the other suites use. */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };

function pagesLike() {
  /* every request is counted by path: a fallback that gives up shows as one
   * request, one that retries shows as one per attempt, and that is the only
   * way to see from outside whether a counter blocked a navigation */
  const srv = http.createServer((req, res) => {
    const url = new global.URL(req.url, 'http://127.0.0.1');
    const key = decodeURIComponent(url.pathname) + url.search;
    srv.hits.set(key, (srv.hits.get(key) || 0) + 1);
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      return res.end(fs.readFileSync(file));
    }
    const fallback = path.join(ROOT, '404.html');
    if (fs.existsSync(fallback)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(fallback));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });
  srv.hits = new Map();
  return srv;
}

/* a tier read means nothing before the worker is in control: the static host
 * would answer it from the filesystem, or 404 */
async function waitForHost(p) {
  for (let i = 0; i < 40; i++) {
    const ready = await p.evaluate(() => !!navigator.serviceWorker.controller)
      .catch(() => false);
    if (ready) return true;
    await p.waitForTimeout(250);
  }
  return false;
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'sw.js')) || !appLoc()) {
    console.log('  FAIL sasjsbuild/mock is not a mock site - run npm run mock:build');
    process.exit(1);
  }

  const loc = appLoc();
  const entry = loc + '/services/MacroDash.html';
  const asset = loc + '/services/web/js/game.js';

  let server = null;
  const port = process.env.MD_MOCK_PORT
    ? parseInt(process.env.MD_MOCK_PORT, 10)
    : await freePort();
  let URL;
  if (process.env.MD_APP) {
    URL = process.env.MD_APP.replace(/\/?$/, '/');
  } else {
    if (await answers(port)) {
      console.log('  FAIL port ' + port + ' already answers - refusing to drive a site this ' +
        'test did not serve (a server left behind by an aborted run?)');
      process.exit(1);
    }
    URL = 'http://localhost:' + port + '/';
    server = startServer(port);
  }

  const { b, p } = await H.launch();
  try {
    const port_ = new global.URL(URL).port;
    if (!(await waitForServer(port_))) {
      H.bad('streamed mock: nothing answering on ' + port_);
      process.exit(H.summary('streamed mock'));
    }
    await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (!(await waitForHost(p))) {
      H.bad('streamed mock: no service worker controller');
      process.exit(H.summary('streamed mock'));
    }
    H.ok('streamed mock: service worker controls the page');

    /* ---- 1. the drive holds the streamed tree, read back through the tier */
    const page = await p.evaluate(u => fetch('/StoredProgram?_FILE=' + u)
      .then(async r => ({ status: r.status, type: r.headers.get('content-type'),
        body: await r.text() })).catch(e => ({ error: String(e) })), entry);
    /* the page's own asset links are the other half of the claim: a build that
     * keeps this copy but links it relatively loads on a static host and
     * nowhere else, which is the fault this route exists to avoid */
    (page.status === 200 && /text\/html/.test(page.type || '') &&
      /\/StoredProgram\?_FILE=/.test(page.body || ''))
      ? H.ok('streamed mock: the entry page is served as html, linked through the tier')
      : H.bad('streamed mock: entry page', JSON.stringify(page).slice(0, 300));

    const js = await p.evaluate(u => fetch('/StoredProgram?_FILE=' + u)
      .then(async r => ({ status: r.status, type: r.headers.get('content-type'),
        size: (await r.text()).length })).catch(e => ({ error: String(e) })), asset);
    (js.status === 200 && /javascript/.test(js.type || '') && js.size > 1000)
      ? H.ok('streamed mock: an asset is served as javascript')
      : H.bad('streamed mock: asset', JSON.stringify(js).slice(0, 300));

    /* the estate's answer for a file it cannot read, not a 404: a streamed app
     * whose asset is missing has to fail the same way here as on a server */
    const gone = await p.evaluate(u => fetch('/StoredProgram?_FILE=' + u)
      .then(async r => ({ status: r.status, body: await r.text() }))
      .catch(e => ({ error: String(e) })), loc + '/services/web/nope.js');
    (gone.status === 202 && /Parameter Error/.test(gone.body || ''))
      ? H.ok('streamed mock: a missing asset answers 202, as the estate does')
      : H.bad('streamed mock: missing asset', JSON.stringify(gone).slice(0, 200));

    /* ---- 2. the entry page boots, loaded the way a visitor loads it.
     * An iframe rather than a navigation: the page under test is not this page,
     * and the assertions below drive the app inside it through its own hooks. */
    const booted = await p.evaluate(async u => {
      const f = document.createElement('iframe');
      f.width = 900; f.height = 700;
      f.src = '/StoredProgram?_FILE=' + u;
      document.body.appendChild(f);
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 250));
        const w = f.contentWindow;
        if (w && typeof w.MACRODASH_STATE === 'function' && w.MACRODASH_STATE())
          return { state: w.MACRODASH_STATE(), title: w.document.title,
            canvas: !!w.document.querySelector('canvas') };
      }
      return { state: null };
    }, entry);
    (booted.state === 'title' && booted.canvas)
      ? H.ok('streamed mock: the streamed entry page boots the game')
      : H.bad('streamed mock: boot', JSON.stringify(booted).slice(0, 200));

    /* ---- 3. cold visits: the address typed into a browser that has never
     * loaded the site. No worker exists yet, so the request reaches the static
     * host, which answers 404.html - and the fallback there has to install the
     * worker and get the page asked for. A fresh browser, not a new page: a
     * registration outlives a page, and "there is no registration yet" is the
     * state under test.
     *
     * The wait is sized from the fallback's own numbers rather than guessed:
     * three attempts, up to 3s each (2s for activation, 1s for control), plus
     * the boot. A shorter budget would fail over working code on a loaded
     * runner and blame the link. */
    /* the numbers come from the script, not from a copy of it: a copy is how
     * this budget and the fallback disagreed in the first place. Reading them
     * means raising a wait in src/404.js moves this budget with it. */
    const fallbackScript = fs.readFileSync(path.join(__dirname, '..', '..', 'src', '404.js'), 'utf8');
    const scriptNumber = (name) => {
      const m = fallbackScript.match(new RegExp('var\\s+' + name + '\\s*=\\s*(\\d+)'));
      if (!m) throw new Error('src/404.js no longer states ' + name);
      return Number(m[1]);
    };
    const MAX_ATTEMPTS = scriptNumber('MAX_ATTEMPTS');
    const ATTEMPT_WAIT_MS = scriptNumber('WAIT_ACTIVATED_MS') + scriptNumber('WAIT_CONTROL_MS');
    const coldTicks = Math.ceil((MAX_ATTEMPTS * ATTEMPT_WAIT_MS + 5000) / 250);

    const coldPort = await freePort();
    const coldServer = pagesLike();
    await new Promise(r => coldServer.listen(coldPort, '127.0.0.1', r));
    const cold = await H.launch();

    const settle = async (probe) => {
      for (let i = 0; i < coldTicks; i++) {
        const value = await cold.p.evaluate(probe).catch(() => null);
        if (value) return value;
        await cold.p.waitForTimeout(250);
      }
      return null;
    };

    try {
      const coldUrl = 'http://localhost:' + coldPort + '/StoredProgram?_FILE=' + entry;
      await cold.p.goto(coldUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const state = await settle(() => (window.MACRODASH_STATE
        ? window.MACRODASH_STATE() : null));
      state === 'title'
        ? H.ok('streamed mock: a cold deep link lands on the game, not a 404')
        : H.bad('streamed mock: cold deep link never loaded the game', String(state));

      /* ---- 4. the same fallback for an address the site does not carry.
       * What settles there is the tier's answer, not the fallback's message:
       * the first pass registers the worker, and every later pass is then
       * intercepted and answered 202 "Parameter Error" - which is the estate's
       * answer for a file that is not there. The claim worth testing is that it
       * STOPS: the request count after settling must equal the count two
       * seconds later. */
      const missing = loc + '/services/does-not-exist.html';
      const missingKey = new global.URL('http://x/StoredProgram?_FILE=' + missing).pathname +
        new global.URL('http://x/StoredProgram?_FILE=' + missing).search;
      const missingUrl = 'http://localhost:' + coldPort + '/StoredProgram?_FILE=' + missing;
      const cold2 = await H.launch();
      try {
        await cold2.p.goto(missingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        /* poll for the answer itself, not for any text: the fallback's own
         * "Loading Macro Dash..." is non-empty and would end the wait on the
         * page that is still retrying */
        let settled = { text: '', game: false };
        for (let i = 0; i < coldTicks; i++) {
          settled = await cold2.p.evaluate(() => ({
            text: ((document.body && document.body.innerText) || '').trim().slice(0, 60),
            game: !!(window.MACRODASH_STATE && window.MACRODASH_STATE())
          })).catch(() => ({ text: '', game: false }));
          if (/Parameter Error|not part of the published site/.test(settled.text)) break;
          await cold2.p.waitForTimeout(250);
        }
        const hitsA = coldServer.hits.get(missingKey) || 0;
        await cold2.p.waitForTimeout(2000);
        const hitsB = coldServer.hits.get(missingKey) || 0;
        /* the tier's own refusal, not merely "not the game": a page whose
         * fallback never ran shows "Loading Macro Dash..." after one request
         * and would pass a weaker predicate, which is the fault this case is
         * meant to catch */
        (settled.game === false && /Parameter Error/.test(settled.text) &&
          hitsA === hitsB && hitsA <= MAX_ATTEMPTS + 1)
          ? H.ok('streamed mock: an address the site does not carry settles on the tier refusal, and stops')
          : H.bad('streamed mock: missing address did not settle',
            JSON.stringify({ settled, hitsA, hitsB }));

        /* ---- 5. the give-up branch itself, with the worker stubbed out of
         * the picture (a registration that never activates, so no navigation
         * is ever intercepted). This is the only state in which the cap is
         * reached, and it must end on the message rather than on a loop. */
        const ctx = await cold2.b.newContext();
        await ctx.addInitScript(() => {
          const reg = { active: null, installing: null, waiting: null, scope: '/',
            ready: Promise.resolve(), addEventListener() {}, update: () => Promise.resolve() };
          Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            get: () => ({ register: () => Promise.resolve(reg), ready: Promise.resolve(reg),
              controller: null, addEventListener() {} })
          });
        });
        const page5 = await ctx.newPage();
        await page5.goto(missingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        let gave = null;
        for (let i = 0; i < coldTicks && !gave; i++) {
          gave = await page5.evaluate(() => {
            const m = document.getElementById('msg');
            return (m && /not part of the published site/.test(m.textContent)) ? 'gave-up' : null;
          }).catch(() => null);
          if (!gave) await page5.waitForTimeout(250);
        }
        const hitsC = coldServer.hits.get(missingKey) || 0;
        await page5.waitForTimeout(1500);
        const hitsD = coldServer.hits.get(missingKey) || 0;
        const stored = await page5.evaluate(() => sessionStorage.getItem('md-404-attempts'))
          .then(v => { try { return JSON.parse(v); } catch (e) { return v; } })
          .catch(() => null);
        (gave === 'gave-up' && hitsC === hitsD)
          ? H.ok('streamed mock: the cap ends on a message, not a loop')
          : H.bad('streamed mock: give-up branch', JSON.stringify({ gave, hitsC, hitsD }));

        /* the counter names the address it was spent on, so a later link
         * starts with its own budget - a session-wide counter stores a bare
         * number here */
        (stored && stored.target === '/StoredProgram?_FILE=' + missing && stored.n === MAX_ATTEMPTS)
          ? H.ok('streamed mock: the attempt counter names the address it was spent on')
          : H.bad('streamed mock: attempt counter is not per address', JSON.stringify(stored));
        await ctx.close();

        /* and the tab is not wedged: a good address after a bad one still
         * opens the game */
        await cold2.p.goto('http://localhost:' + coldPort + '/StoredProgram?_FILE=' + entry,
          { waitUntil: 'domcontentloaded', timeout: 30000 });
        const after = await (async () => {
          for (let i = 0; i < coldTicks; i++) {
            const s = await cold2.p.evaluate(() => (window.MACRODASH_STATE
              ? window.MACRODASH_STATE() : null)).catch(() => null);
            if (s) return s;
            await cold2.p.waitForTimeout(250);
          }
          return null;
        })();
        after === 'title'
          ? H.ok('streamed mock: a good address still opens after a bad one')
          : H.bad('streamed mock: good address after a bad one', String(after));
      } finally {
        await cold2.b.close();
      }
    } finally {
      await cold.b.close();
      coldServer.close();
    }
  } catch (e) {
    H.bad('streamed mock threw', String(e && e.message || e));
  } finally {
    await b.close();
    if (server) try { process.kill(-server.pid); } catch (e) { /* already gone */ }
  }

  process.exit(H.summary('streamed mock'));
})();

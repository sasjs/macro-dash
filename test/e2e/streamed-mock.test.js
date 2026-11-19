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
  return http.createServer((req, res) => {
    const url = new global.URL(req.url, 'http://127.0.0.1');
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

    /* ---- 3. a cold visit: the address typed into a browser that has never
     * loaded the site. No worker exists yet, so the request reaches the static
     * host, which answers 404.html - and the fallback there has to install the
     * worker and get the game itself. A fresh browser, not a new page: a
     * registration outlives a page, and "there is no registration yet" is the
     * state under test. */
    const coldPort = await freePort();
    const coldServer = pagesLike();
    await new Promise(r => coldServer.listen(coldPort, '127.0.0.1', r));
    const cold = await H.launch();
    try {
      await cold.p.goto('http://localhost:' + coldPort + '/StoredProgram?_FILE=' + entry,
        { waitUntil: 'domcontentloaded', timeout: 30000 });
      /* two retries and a game boot have to fit: 2s a retry is generous on a
       * loaded runner, and a shorter budget fails over working code */
      let state = null;
      for (let i = 0; i < 80; i++) {
        state = await cold.p.evaluate(() => (window.MACRODASH_STATE
          ? window.MACRODASH_STATE() : null)).catch(() => null);
        if (state) break;
        await cold.p.waitForTimeout(250);
      }
      state === 'title'
        ? H.ok('streamed mock: a cold deep link lands on the game, not a 404')
        : H.bad('streamed mock: cold deep link never loaded the game', String(state));
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

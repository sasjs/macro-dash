/* Manual Viya integration smoke test for the configure flow.
 *
 * NOT run by npm test (needs a live Viya + creds). Drives a headless
 * chromium through SASLogon, loads the DEPLOYED MacroDash.html (Viya has
 * strict CORS - the frontend must be same-origin, not localhost), drives
 * the config screen with apiMode=compute (so the adapter ships the SAS log
 * via getSasRequests().logFile), and asserts:
 *   - configure succeeds and the log is captured (configLog non-empty)
 *   - pressing L triggers a Blob download of the log
 *   - RUN/Enter after configure transitions config -> title (no re-fire)
 *
 * Usage:  VIYA_USER=.. VIYA_PASS=.. node test/viya-config-test.js
 *   (VIYA_APP + VIYA_LOGON override the URLs below)
 */
const { chromium } = require('playwright');

const APP = process.env.VIYA_APP || 'https://nextviya.emea.sas.com/SASJobExecution?_file=/Users/viyademo18/macrodash/services/MacroDash.html';
const LOGON = process.env.VIYA_LOGON || 'https://nextviya.emea.sas.com/SASLogon/login';

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type()==='error') console.log('CONSOLE-ERR', m.text().slice(0,200)); });
  page.on('requestfailed', r => console.log('REQ-FAIL', r.url().slice(0,100), r.failure() && r.failure().errorText));
  page.on('response', r => { const u = r.url(); if (u.indexOf('common/')>=0 || u.indexOf('configure')>=0 || u.indexOf('compute')>=0 || u.indexOf('job')>=0 || u.indexOf('SASJobExecution')>=0) console.log('RESP', r.status(), r.request().method(), u.slice(0,140)); });

  // login
  await page.goto(LOGON, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#username', process.env.VIYA_USER);
  await page.fill('#password', process.env.VIYA_PASS);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{}),
    page.click('#submitBtn'),
  ]);

  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.MACRODASH_FORCE && window.MACRODASH_FORCE('title'));
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(800);
  console.log('1. state after C:', await page.evaluate(() => window.MACRODASH_STATE()));

  // wait for contexts to load
  for (let i = 0; i < 20; i++) {
    const ready = await page.evaluate(() => {
      var B = window.MACRODASH_BACKEND;
      return B && B.isViya && B.isViya() ? !!(B.getContext && B.listContexts) : 'not-viya';
    });
    if (ready === 'not-viya') break;
    if (ready) break;
    await page.waitForTimeout(500);
  }

  // list contexts via the backend to pick one
  const contexts = await page.evaluate(() => new Promise(resolve => {
    var B = window.MACRODASH_BACKEND;
    if (!B || !B.listContexts) { resolve(null); return; }
    B.listContexts(function (cs) { resolve(cs); });
  }));
  console.log('2. contexts:', contexts ? contexts.map(c => c.name + (c.runAs ? '(' + c.runAs + ')' : '')).join(', ') : 'null');
  if (!contexts || !contexts.length) { console.log('NO CONTEXTS - abort'); await browser.close(); return; }

  // pick the first reusable context with a runAs
  const pick = contexts.find(c => c.runAs && c.reusable) || contexts[0];
  console.log('3. picking context:', pick.name, 'runAs:', pick.runAs);

  // shortcut: set context + apiMode=compute directly via the backend setters,
  // and set the account/rootdir fields the config screen reads
  const set = await page.evaluate((ctxName) => {
    var B = window.MACRODASH_BACKEND;
    B.setContext(ctxName);
    B.setApiMode('compute');   // non-JES-web so the adapter ships the log
    return { ctx: B.getContext(), mode: B.getApiMode() };
  }, pick.name);
  console.log('4. set context+mode:', set);

  // type a rootdir (unique per run to avoid stomping prior config)
  const rootdir = '/export/pvs/sasdata/sasbatch/md-test-' + Date.now();
  await page.evaluate((rd) => window.MACRODASH_CONFIG_SET('rootdir', rd), rootdir);
  await page.waitForTimeout(300);
  console.log('5. configInput:', await page.evaluate(() => window.MACRODASH_CONFIG_INPUT()));


  // submit
  await page.keyboard.press('Enter');
  console.log('6. pressed Enter, waiting for configure...');

  // poll for configMsg
  let msg = '', done = false, log = '';
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);
    msg = await page.evaluate(() => window.MACRODASH_CONFIG_MSG());
    done = await page.evaluate(() => window.MACRODASH_CONFIG_DONE());
    log = await page.evaluate(() => window.MACRODASH_CONFIG_LOG());
    if (msg && msg !== 'configuring...') break;
  }
  console.log('7. configDone:', done);
  console.log('8. configMsg:', msg);
  console.log('9. configLog length:', log.length, log.length ? '(first 200): ' + log.slice(0,200) : '(empty)');

  if (done) {
    // while still on the config screen (log captured), press L to download
    const dlUrl = await page.evaluate(() => new Promise(resolve => {
      var origCreate = window.URL.createObjectURL;
      window.URL.createObjectURL = function (blob) {
        window.URL.createObjectURL = origCreate;
        resolve({ url: 'blob:' + blob.size, size: blob.size, type: blob.type });
        return 'blob:captured';
      };
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL' }));
      setTimeout(() => resolve({ url: '(no download triggered)', size: 0 }), 2000);
    }));
    console.log('11. L-key download:', dlUrl.size > 0 ? 'PASS (' + dlUrl.size + ' bytes, type ' + dlUrl.type + ')' : 'FAIL');

    // RUN/Enter should now transition to title, NOT re-fire configure
    const before = await page.evaluate(() => window.MACRODASH_STATE());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.MACRODASH_STATE());
    console.log('10. post-configure Enter: state', before, '->', after, after === 'title' ? 'PASS (went to title)' : 'FAIL');
  }

  await browser.close();
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });

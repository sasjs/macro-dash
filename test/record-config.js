/* Record: the configurator's 4-way execution-option UI, locally (forced
 * Viya). Shows each option selected + its adapter JSON. */
const { chromium } = require('playwright');
const APP = 'http://localhost:5000/AppStream/MacroDash/';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  const ctx = await b.newContext({ viewport: { width: 640, height: 480 }, recordVideo: { dir: 'test/' } });
  const p = await ctx.newPage();
  await p.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.MACRODASH_FORCE_VIYA(true));
  await p.waitForTimeout(1500); // show the full wizard on the OPTIONS step
  // cycle through each option
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < i; j++) {
      await p.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown' })));
      await p.waitForTimeout(200);
    }
    await p.waitForTimeout(1200); // linger on each option
    // reset to top
    for (let j = 0; j < i; j++) {
      await p.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' })));
      await p.waitForTimeout(80);
    }
  }
  await b.close();
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });

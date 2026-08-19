/* Record: start level 1, teleport onto portal (real portal path), show
 * the win screen, press Enter -> level 2 banner. */
const { chromium } = require('playwright');
const APP = 'http://localhost:5000/AppStream/MacroDash/';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  const ctx = await b.newContext({ viewport: { width: 640, height: 480 }, recordVideo: { dir: 'test/' } });
  const p = await ctx.newPage();
  await p.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(1200);
  // title -> play
  await p.keyboard.press('Enter');
  await p.waitForTimeout(800);
  // reach the portal (real code path)
  await p.evaluate(() => window.MACRODASH_REACH_PORTAL());
  await p.waitForTimeout(1500); // win screen
  // Enter -> level 2
  await p.keyboard.press('Enter');
  await p.waitForTimeout(2500);
  await b.close();
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });

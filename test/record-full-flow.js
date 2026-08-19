/* Verification video: the full local flow.
 *  - deep-link #scores (refreshable board)
 *  - title -> play level 1 -> win screen -> Enter -> level 2
 *  - finish all 3 levels -> winname (initials) -> complete -> board (#scores)
 *  - PLAY AGAIN -> die -> winname (initials for DNF) -> dump (#scores)
 *  - reload on #scores stays on the board
 * Output: test/full-flow.webm */
const { chromium } = require('playwright');
const APP = 'http://localhost:5000/AppStream/MacroDash/';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  const ctx = await b.newContext({ viewport: { width: 640, height: 480 }, recordVideo: { dir: 'test/' } });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') console.log('ERR', m.text().slice(0, 200)); });

  // 1. deep-link #scores
  await p.goto(APP + '#scores', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(2000);

  // 2. HOME -> title -> play level 1
  await p.mouse.click(640 / 2 + 80, 430); // HOME
  await p.waitForTimeout(1000);
  await p.keyboard.press('Enter'); // title -> play
  await p.waitForTimeout(800);

  // reach the level-1 portal -> win screen
  await p.evaluate(() => window.MACRODASH_REACH_PORTAL());
  await p.waitForTimeout(1800); // win screen
  await p.keyboard.press('Enter'); // -> level 2
  await p.waitForTimeout(1500);

  // 3. finish remaining levels (2, 3) -> winname
  await p.evaluate(() => window.MACRODASH_REACH_PORTAL());
  await p.waitForTimeout(1500);
  await p.keyboard.press('Enter'); // level 3
  await p.waitForTimeout(1200);
  await p.evaluate(() => window.MACRODASH_REACH_PORTAL());
  await p.waitForTimeout(1500); // winname (configured -> backend auto-submit skips winname)

  // configured build: final portal auto-submits -> complete -> board
  await p.waitForTimeout(2000);
  // skip the complete animation to the board
  if (await p.evaluate(() => window.MACRODASH_STATE()) === 'complete') {
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1000);
  }

  // 4. board (#scores) -> PLAY AGAIN -> die -> winname (DNF initials)
  await p.waitForTimeout(1500);
  await p.mouse.click(640 / 2 - 80, 430); // PLAY AGAIN
  await p.waitForTimeout(800);
  await p.evaluate(() => window.MACRODASH_DIE()); // die
  await p.waitForTimeout(1500); // winname (initials for DNF)
  await p.keyboard.press('KeyD'); await p.waitForTimeout(80);
  await p.keyboard.press('KeyN'); await p.waitForTimeout(80);
  await p.keyboard.press('KeyF'); await p.waitForTimeout(80);
  await p.keyboard.press('Enter'); // -> dead screen
  await p.waitForTimeout(1500);
  await p.keyboard.press('Enter'); // -> dump (#scores)
  await p.waitForTimeout(2000);

  // 5. reload on #scores -> stays on board
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);

  await b.close();
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });

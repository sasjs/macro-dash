/* Verify #scores is a refreshable page (works in both configured and
 * no-backend modes). */
const { chromium } = require('playwright');
const APP = 'http://localhost:5000/AppStream/MacroDash/';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  const ctx = await b.newContext({ viewport: { width: 640, height: 480 } });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') console.log('ERR', m.text().slice(0, 200)); });

  const configured = await p.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .then(() => p.evaluate(() => window.MACRODASH_BACKEND.isConfigured()));
  await p.waitForTimeout(1200);
  console.log('configured:', configured);

  // 1. deep-link #scores on load -> board
  await p.goto(APP + '#scores', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(1500);
  let s = await p.evaluate(() => window.MACRODASH_STATE());
  let h = await p.evaluate(() => location.hash);
  console.log('1. deep-link #scores: state=' + s + ' hash=' + h, (s === 'board' && h === '#scores') ? 'PASS' : 'FAIL');

  // 2. reload the page -> still board (the hash survives refresh)
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  s = await p.evaluate(() => window.MACRODASH_STATE());
  h = await p.evaluate(() => location.hash);
  console.log('2. after reload: state=' + s + ' hash=' + h, (s === 'board' && h === '#scores') ? 'PASS' : 'FAIL');

  // 3. click HOME -> title + hash cleared
  await p.mouse.click(640 / 2 + 80, 430);
  await p.waitForTimeout(500);
  s = await p.evaluate(() => window.MACRODASH_STATE());
  h = await p.evaluate(() => location.hash);
  console.log('3. after HOME: state=' + s + ' hash="' + h + '"', (s === 'title' && h === '') ? 'PASS' : 'FAIL');

  // 4. play through all 3 levels -> board with #scores (auto-set)
  await p.evaluate(() => window.MACRODASH_FORCE('title'));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  for (let lvl = 0; lvl < 3; lvl++) {
    await p.evaluate(() => window.MACRODASH_REACH_PORTAL());
    await p.waitForTimeout(700);
    s = await p.evaluate(() => window.MACRODASH_STATE());
    if (s === 'win') { await p.keyboard.press('Enter'); await p.waitForTimeout(400); }
    else break;
  }
  // now on final level's end: configured -> board auto (via complete anim),
  // no-backend -> winname (type initials + Enter) -> complete -> board
  s = await p.evaluate(() => window.MACRODASH_STATE());
  if (s === 'winname') {
    await p.keyboard.press('KeyA'); await p.waitForTimeout(50);
    await p.keyboard.press('Enter'); // skip to finale
    await p.waitForTimeout(300);
  }
  // let the complete animation begin, then press Enter to reach the board
  // (the real complete->board transition sets the #scores hash)
  await p.waitForTimeout(300);
  s = await p.evaluate(() => window.MACRODASH_STATE());
  if (s === 'complete') { await p.keyboard.press('Enter'); await p.waitForTimeout(500); }
  s = await p.evaluate(() => window.MACRODASH_STATE());
  h = await p.evaluate(() => location.hash);
  console.log('4. after finish -> board: state=' + s + ' hash=' + h, (s === 'board' && h === '#scores') ? 'PASS' : 'FAIL');

  // 5. PLAY AGAIN from board -> play + hash cleared
  await p.mouse.click(640 / 2 - 80, 430);
  await p.waitForTimeout(500);
  s = await p.evaluate(() => window.MACRODASH_STATE());
  h = await p.evaluate(() => location.hash);
  console.log('5. after PLAY AGAIN: state=' + s + ' hash="' + h + '"', (s === 'play' && h === '') ? 'PASS' : 'FAIL');

  await b.close();
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });

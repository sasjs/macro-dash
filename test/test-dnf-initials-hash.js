/* No-backend: death -> winname (initials) -> dead -> dump (#scores hash).
 * Verifies the DNF entry gets the typed initials and the dump screen is a
 * refreshable #scores page. */
const { chromium } = require('playwright');
const APP = 'http://localhost:8123/index.html'; // unconfigured (no-backend)
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  const p = await (await b.newContext({ viewport: { width: 640, height: 480 } })).newPage();
  await p.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(800);
  await p.evaluate(() => localStorage.removeItem('macrodash_best'));

  await p.evaluate(() => window.MACRODASH_FORCE('title'));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);

  // die (triggers endRun -> winname in local mode)
  const died = await p.evaluate(() => window.MACRODASH_DIE());
  await p.waitForTimeout(200);
  let s = await p.evaluate(() => window.MACRODASH_STATE());
  console.log('1. after death: state=' + s, s === 'winname' ? 'PASS (initials prompt)' : 'FAIL');

  // type initials + Enter -> dead screen
  await p.keyboard.press('KeyD'); await p.waitForTimeout(50);
  await p.keyboard.press('KeyN'); await p.waitForTimeout(50);
  await p.keyboard.press('KeyF'); await p.waitForTimeout(50);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  s = await p.evaluate(() => window.MACRODASH_STATE());
  console.log('2. after winname Enter: state=' + s, s === 'dead' ? 'PASS' : 'FAIL');

  // the DNF entry should carry the initials
  let bests = await p.evaluate(() => JSON.parse(localStorage.getItem('macrodash_best') || '[]'));
  console.log('   stored:', JSON.stringify(bests.map(b => ({ name: b.name, done: b.done }))));
  const hasName = bests.some(b => b.done === false && b.name === 'DNF');
  console.log('3. DNF has initials', hasName ? 'PASS' : 'FAIL');

  // Enter -> dump screen, hash should become #scores
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  s = await p.evaluate(() => window.MACRODASH_STATE());
  let h = await p.evaluate(() => location.hash);
  console.log('4. after dead Enter: state=' + s + ' hash=' + h, (s === 'dump' && h === '#scores') ? 'PASS' : 'FAIL');

  // reload while on #scores -> should land back on the board (dump shows
  // leaderboard; applyHash routes #scores -> 'board' state, not dump, but
  // both render the leaderboard via drawBestHistory)
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  s = await p.evaluate(() => window.MACRODASH_STATE());
  h = await p.evaluate(() => location.hash);
  console.log('5. after reload: state=' + s + ' hash=' + h, (s === 'board' && h === '#scores') ? 'PASS' : 'FAIL');

  await b.close();
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });

/* #scores hash routing: deep-link, reload, HOME, finish->board, PLAY AGAIN. */
const H = require('./helper');

(async () => {
  const { b, p } = await H.launch();
  try {
    // 1. deep-link #scores -> board
    await p.goto(H.APP + '#scores', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(1500);
    let s = await H.state(p), h = await p.evaluate(() => location.hash);
    (s === 'board' && h === '#scores') ? H.ok('deep-link #scores') : H.bad('deep-link', s + ' ' + h);

    // 2. reload -> still board
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);
    s = await H.state(p); h = await p.evaluate(() => location.hash);
    (s === 'board' && h === '#scores') ? H.ok('reload keeps #scores') : H.bad('reload', s + ' ' + h);

    // 3. HOME -> title + hash cleared
    await p.mouse.click(640 / 2 + 80, 430);
    await p.waitForTimeout(500);
    s = await H.state(p); h = await p.evaluate(() => location.hash);
    (s === 'title' && h === '') ? H.ok('HOME clears hash') : H.bad('HOME', s + ' "' + h + '"');

    // 4. finish -> board with #scores
    await p.evaluate(() => window.MACRODASH_FORCE('title'));
    await H.press(p, 'Enter');
    await p.waitForTimeout(400);
    for (let lvl = 0; lvl < 3; lvl++) {
      await H.reachPortal(p);
      s = await H.state(p);
      if (s === 'win') { await H.press(p, 'Enter'); await p.waitForTimeout(400); }
      else break;
    }
    // winname (no-backend SRC) or complete (configured) -> board
    s = await H.state(p);
    if (s === 'winname') { await H.press(p, 'KeyA'); await H.press(p, 'Enter'); await p.waitForTimeout(300); }
    await p.waitForTimeout(300);
    if (await H.state(p) === 'complete') { await H.press(p, 'Enter'); await p.waitForTimeout(500); }
    s = await H.state(p); h = await p.evaluate(() => location.hash);
    (s === 'board' && h === '#scores') ? H.ok('finish -> board #scores') : H.bad('finish', s + ' ' + h);

    // 5. PLAY AGAIN -> play + hash cleared
    await p.mouse.click(640 / 2 - 80, 430);
    await p.waitForTimeout(500);
    s = await H.state(p); h = await p.evaluate(() => location.hash);
    (s === 'play' && h === '') ? H.ok('PLAY AGAIN clears hash') : H.bad('PLAY AGAIN', s + ' "' + h + '"');
  } finally { await b.close(); }
  process.exit(H.summary('scores-route') ? 1 : 0);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });

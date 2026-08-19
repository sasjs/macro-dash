/* Level transition: finishing level 1 (the real portal code path) goes to
 * the win screen, and Enter advances to level 2 (not back to level 1). */
const H = require('./helper');

(async () => {
  const { b, p } = await H.launch();
  try {
    await p.goto(H.APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(1500);
    await p.evaluate(() => window.MACRODASH_FORCE('title'));
    await H.press(p, 'Enter');
    await p.waitForTimeout(400);
    (await H.levelIdx(p)) === 0 ? H.ok('start at level 0') : H.bad('start level', await H.levelIdx(p));

    // reach the level-1 portal (real code path)
    await H.reachPortal(p);
    const s = await H.state(p);
    s === 'win' ? H.ok('portal -> win screen') : H.bad('portal', s);

    // Enter -> level 2
    await H.press(p, 'Enter');
    await p.waitForTimeout(400);
    const after = await p.evaluate(() => ({ s: window.MACRODASH_STATE(), l: window.MACRODASH_LEVELIDX() }));
    (after.s === 'play' && after.l === 1) ? H.ok('win -> Enter -> level 2') : H.bad('advance', JSON.stringify(after));
  } finally { await b.close(); }
  process.exit(H.summary('level-transition') ? 1 : 0);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });

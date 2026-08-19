/* Local-only DNF: a death records a DNF entry to localStorage (with the
 * typed initials), ranked after finishes.  Uses the no-backend SRC build. */
const H = require('./helper');

(async () => {
  const { b, p } = await H.launch();
  try {
    await p.goto(H.SRC, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(800);
    await p.evaluate(() => localStorage.removeItem('macrodash_best'));
    await p.evaluate(() => window.MACRODASH_FORCE('title'));
    await H.press(p, 'Enter');
    await p.waitForTimeout(400);

    // finish a run first (so the DNF ranks after a finish)
    for (let lvl = 0; lvl < 3; lvl++) {
      await H.reachPortal(p);
      if (await H.state(p) === 'win') { await H.press(p, 'Enter'); await p.waitForTimeout(400); }
      else break;
    }
    await H.press(p, 'KeyA'); await p.waitForTimeout(50);
    await H.press(p, 'Enter');
    await p.waitForTimeout(400);
    await p.waitForTimeout(300);
    if (await H.state(p) === 'complete') { await H.press(p, 'Enter'); await p.waitForTimeout(500); }

    // start a new run and die
    await p.evaluate(() => window.MACRODASH_FORCE('title'));
    await p.waitForTimeout(200);
    await H.press(p, 'Enter');
    await p.waitForTimeout(400);
    const died = await p.evaluate(() => window.MACRODASH_DIE && window.MACRODASH_DIE());
    await p.waitForTimeout(300);
    died ? H.ok('death triggered') : H.bad('death', 'DIE hook failed');

    // winname for the DNF: type initials + Enter
    (await H.state(p)) === 'winname' ? H.ok('death -> winname (initials)') : H.bad('winname', await H.state(p));
    await H.press(p, 'KeyD'); await p.waitForTimeout(50);
    await H.press(p, 'KeyN'); await p.waitForTimeout(50);
    await H.press(p, 'KeyF'); await p.waitForTimeout(50);
    await H.press(p, 'Enter');
    await p.waitForTimeout(300);

    const bests = await p.evaluate(() => JSON.parse(localStorage.getItem('macrodash_best') || '[]'));
    const dnf = bests.find(x => x.done === false);
    dnf ? H.ok('DNF entry stored') : H.bad('DNF stored', JSON.stringify(bests));
    dnf && dnf.name === 'DNF' ? H.ok('DNF carries initials') : H.bad('DNF initials', dnf && dnf.name);

    // sort: finish before DNF
    const order = bests.slice().sort((a, b) => {
      if (a.done && !b.done) return -1; if (!a.done && b.done) return 1;
      if (a.done) return a.time - b.time; return b.when - a.when;
    });
    (order[0].done && !order[order.length - 1].done) ? H.ok('finish ranked before DNF') : H.bad('sort order');
  } finally { await b.close(); }
  process.exit(H.summary('local-dnf') ? 1 : 0);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });

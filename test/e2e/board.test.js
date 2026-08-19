/* Board: PLAY AGAIN / HOME buttons fire; DNF rows render; initials show on
 * the local best-scores board.  Runs against the local SASjs Server. */
const H = require('./helper');

(async () => {
  // ---- phase 1: backend board (configured app) ----
  {
    const { b, p } = await H.launch();
    try {
      await p.goto(H.APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForTimeout(1500);

      // seed 2 finishes + 1 DNF via the backend (mock savescore)
      await p.evaluate(() => new Promise(res => {
        var B = window.MACRODASH_BACKEND;
        B.saveScore({ name: '', time: 18.4, score: 0, amps: 0, done: 1 }, () =>
          B.saveScore({ name: '', time: 22.1, score: 0, amps: 0, done: 1 }, () =>
            B.saveScore({ name: '', time: '', score: 0, amps: 0, done: 0 }, () => res())));
      }));
      await p.waitForTimeout(500);

      const scores = await p.evaluate(() => new Promise(r => window.MACRODASH_BACKEND.getScores(r)));
      scores.some(s => s.DONE === 0) ? H.ok('leaderboard has a DNF entry') : H.bad('DNF missing');

      // PLAY AGAIN button
      await p.evaluate(() => window.MACRODASH_FORCE('board'));
      await p.waitForTimeout(800);
      await p.mouse.click(640 / 2 - 80, 430);
      await p.waitForTimeout(500);
      (await H.state(p)) === 'play' ? H.ok('PLAY AGAIN -> play') : H.bad('PLAY AGAIN', await H.state(p));

      // HOME button
      await p.evaluate(() => window.MACRODASH_FORCE('board'));
      await p.waitForTimeout(400);
      await p.mouse.click(640 / 2 + 80, 430);
      await p.waitForTimeout(500);
      (await H.state(p)) === 'title' ? H.ok('HOME -> title') : H.bad('HOME', await H.state(p));
    } finally { await b.close(); }
  }

  // ---- phase 2: local-only initials (no-backend SRC build) ----
  {
    const { b, p } = await H.launch();
    try {
      await p.goto(H.SRC, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForTimeout(800);
      await p.evaluate(() => localStorage.removeItem('macrodash_best'));
      await p.evaluate(() => window.MACRODASH_FORCE('title'));
      await H.press(p, 'Enter');
      await p.waitForTimeout(400);
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
      const bests = await p.evaluate(() => JSON.parse(localStorage.getItem('macrodash_best') || '[]'));
      bests.some(x => x.name === 'A' && x.done) ? H.ok('local initials stored on finish') : H.bad('initials', JSON.stringify(bests));
    } finally { await b.close(); }
  }

  process.exit(H.summary('board') ? 1 : 0);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });

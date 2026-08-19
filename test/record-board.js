/* Records a video of the new board flow (locally, with the mock backend):
 * seeds a finish + a DNF, jumps to the high-score board, and clicks the
 * PLAY AGAIN and HOME buttons.  Output: test/board-flow.webm */
const { chromium } = require('playwright');
const APP = process.env.MD_APP || 'http://localhost:5000/AppStream/MacroDash/';

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  const ctx = await b.newContext({ viewport: { width: 640, height: 480 }, recordVideo: { dir: 'test/' } });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') console.log('ERR', m.text().slice(0,200)); });

  await p.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(1500);

  // seed a finished run (done:1) + a DNF (done:0) via the backend directly
  await p.evaluate(() => new Promise(res => {
    var B = window.MACRODASH_BACKEND;
    B.saveScore({ name: '', time: 18.4, score: 0, amps: 0, done: 1 }, () => {
      B.saveScore({ name: '', time: 22.1, score: 0, amps: 0, done: 1 }, () => {
        B.saveScore({ name: '', time: '', score: 0, amps: 0, done: 0 }, () => res());
      });
    });
  }));
  await p.waitForTimeout(500);

  // jump to the board
  await p.evaluate(() => window.MACRODASH_FORCE && window.MACRODASH_FORCE('board'));
  await p.waitForTimeout(4000);

  // click PLAY AGAIN
  await p.mouse.click(320 - 80, 430);
  await p.waitForTimeout(1500);

  // back to title -> board, click HOME
  await p.evaluate(() => window.MACRODASH_FORCE && window.MACRODASH_FORCE('board'));
  await p.waitForTimeout(1500);
  await p.mouse.click(320 + 80, 430);
  await p.waitForTimeout(1500);

  await b.close();
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });

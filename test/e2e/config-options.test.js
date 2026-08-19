/* Configurator: the 4-way execution-option UI (JES Web / JES API /
 * Compute API / Run As Task) selects the right adapter config, and the
 * configurator locks once configured.  Uses MACRODASH_FORCE_VIYA to render
 * the Viya wizard locally (no SAS calls). */
const H = require('./helper');

const OPTS = [
  { name: 'JES Web',      mode: 'web',     task: false },
  { name: 'JES API',      mode: 'jes',     task: false },
  { name: 'Compute API', mode: 'compute', task: false },
  { name: 'Run As Task', mode: 'web',     task: true  }
];

(async () => {
  const { b, p } = await H.launch();
  try {
    await p.goto(H.APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(1500);
    await p.evaluate(() => window.MACRODASH_FORCE_VIYA(true));
    await p.waitForTimeout(400);

    (await H.state(p)) === 'config' ? H.ok('Viya wizard renders') : H.bad('wizard state', await H.state(p));
    (await p.evaluate(() => window.MACRODASH_CONFIG_FIELD())) === 'options' ? H.ok('on OPTIONS step') : H.bad('field', await p.evaluate(() => window.MACRODASH_CONFIG_FIELD()));

    for (const opt of OPTS) {
      const cur = await p.evaluate(() => {
        var B = window.MACRODASH_BACKEND; var m = B.getApiMode(), t = B.isRunAsTask();
        return (m === 'web' && t) ? 3 : m === 'compute' ? 2 : m === 'jes' ? 1 : 0;
      });
      let diff = (OPTS.indexOf(opt) - cur + 4) % 4;
      for (let i = 0; i < diff; i++) { await H.press(p, 'ArrowDown'); await p.waitForTimeout(60); }
      const got = await p.evaluate(() => { var B = window.MACRODASH_BACKEND; return { mode: B.getApiMode(), task: B.isRunAsTask() }; });
      (got.mode === opt.mode && got.task === opt.task)
        ? H.ok(opt.name + ' -> {useComputeApi:' + opt.mode + ', runAsTask:' + opt.task + '}')
        : H.bad(opt.name, JSON.stringify(got) + ' expected ' + opt.mode + '/' + opt.task);
    }

    // lock: once configured, KeyC must not re-enter the configurator
    await p.evaluate(() => { window.MACRODASH_BACKEND.setConfigured(); window.MACRODASH_FORCE_VIYA(false); });
    await p.evaluate(() => window.MACRODASH_FORCE('title'));
    await p.waitForTimeout(200);
    await H.press(p, 'KeyC');
    await p.waitForTimeout(400);
    (await H.state(p)) === 'title' ? H.ok('configurator locked after configure') : H.bad('lock', await H.state(p));
  } finally { await b.close(); }
  process.exit(H.summary('config-options') ? 1 : 0);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });

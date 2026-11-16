/* Drives the emitted mock site the way a visitor does: a static server on
 * localhost, Chromium, the app's own boot. Reports what rendered, what the
 * service worker answered, and every console error. */
const { chromium } = require('playwright')

const URL = process.env.MD_URL || 'http://localhost:8123/'
const EXE = '/opt/hermes/.playwright/chromium-1243/chrome-linux64/chrome'

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE })
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } })
  const page = await ctx.newPage()

  const errors = []
  const apiCalls = []

  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200))
  })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)))
  page.on('response', (r) => {
    const u = r.url()
    if (u.includes('/SASjsApi/') || u.includes('/SASLogon/'))
      apiCalls.push({
        url: u.replace(URL.replace(/\/$/, ''), ''),
        status: r.status(),
        fromWorker: r.fromServiceWorker()
      })
  })

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 })

  const controlled = await page.evaluate(() =>
    Boolean(navigator.serviceWorker && navigator.serviceWorker.controller)
  )

  await page
    .waitForFunction(() => typeof window.MACRODASH_STATE === 'function', {
      timeout: 30000
    })
    .catch(() => {})

  const state = await page
    .evaluate(() =>
      typeof window.MACRODASH_STATE === 'function'
        ? window.MACRODASH_STATE()
        : null
    )
    .catch(() => null)

  const text = (await page.evaluate(() => document.body.innerText)).slice(0, 600)

  // Start the game: this is what makes the app talk to its backend - the
  // configure and getscores services - so the worker's answers are observable.
  await page.getByText('RUN', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(4000)

  const afterStart = await page
    .evaluate(() =>
      typeof window.MACRODASH_STATE === 'function'
        ? window.MACRODASH_STATE()
        : null
    )
    .catch(() => null)

  // The contract, from inside the page: every one of these is answered by the
  // service worker, so `fromServiceWorker` is the proof the host is in play.
  const probe = await page.evaluate(async () => {
    const ask = async (path, init) => {
      const res = await fetch(path, init)
      const body = await res.text()
      return { path, status: res.status, body: body.slice(0, 160) }
    }
    return [
      await ask('/SASjsApi/info'),
      await ask('/SASjsApi/session'),
      // the server's own front end asks for `fileTree`, a capital T the
      // document spells `filetree` - both must resolve
      await ask('/SASjsApi/drive/fileTree?_folderPath=/Public/app/macrodash'),
      await ask('/SASjsApi/drive/filetree?_folderPath=/Public/app/macrodash'),
      // a real service run through the adapter's own envelope: multipart, the
      // program named on the query string - the path the game's saves use
      await ask(
        '/SASjsApi/stp/execute?_program=/Public/app/macrodash/services/common/getscores&_output_type=json',
        { method: 'POST', body: new FormData() }
      ),
      // the browser cannot run SAS, so a .sas program must be refused in the
      // drive's words rather than executed
      await ask(
        '/SASjsApi/stp/execute?_program=/Public/app/macrodash/services/common/configure',
        { method: 'POST', body: new FormData() }
      ),
      // a route the package implements but this host does not own
      await ask('/SASjsApi/admin/logs')
    ]
  })

  await page.screenshot({ path: '/tmp/macro-dash-mock.png' })

  console.log(
    JSON.stringify({ controlled, state, afterStart, probe, apiCalls, errors, text }, null, 2)
  )
  await browser.close()
})().catch((e) => {
  console.error('FAILED', e)
  process.exit(1)
})

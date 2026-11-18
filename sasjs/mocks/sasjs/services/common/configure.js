/* Macro Dash mock: services/common/configure
 * Mirrors configure.sas.  Input table `config` arrives as CSV (inline or
 * uploaded file): one row, column rootdir.  Like the real service, the
 * folder is validated by actually creating it - the server is local, so
 * rootdir is a real path on this machine.  The choice persists in
 * <apploc>/settings.json on the drive (no /tmp), so getscores.js reports
 * CONFIGURED=1 afterwards.
 *
 * Like the real service it also flips configured="false" -> "true" in the
 * streamed index.html on SASjs Drive (GET + PATCH /SASjsApi/drive/file),
 * so the page knows immediately on next load.  The request headers (incl.
 * the auth token) are available via _SASJS_TOKENFILE; the server calls its
 * own API on PORT (default 5000).
 */

/* standard SASjs response fields */
const now = new Date()
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const SYSDATE = ('0' + now.getDate()).slice(-2) + MONTHS[now.getMonth()] +
  String(now.getFullYear()).slice(-2)
const SYSTIME = ('0' + now.getHours()).slice(-2) + ':' +
  ('0' + now.getMinutes()).slice(-2)

/* The host-injected shared FETCH reads inline and staged input tables.
 * SAS column names are case-insensitive; normalise the returned keys. */
const rows = (webout('FETCH').config || []).map((row) =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toUpperCase(), value]))
)
const rootdir = rows.length ? rows[0].ROOTDIR : ''

const path = require('path')
/* Settings live under the apploc, as they do on SAS: configure.sas writes
 * <apploc>/settings.sas with %mx_createfile and md_init.sas fetches it from
 * there.  The JS equivalent is <apploc>/settings.json, held on the drive
 * (<drive>/files<apploc>/), so it is a file like any other - visible to the
 * Drive API, deployed with the app, and gone when the drive is cleared.
 *
 * Which drive root this session runs against: the browser host keeps it at
 * /sasjs/drive, a @sasjs/server beside its build tree, so it is resolved
 * rather than assumed. */
function driveRoot() {
  const computed = path.resolve(weboutPath, '..', '..', '..', 'drive')
  const candidates = ['/sasjs/drive', computed]
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, 'files'))) return c } catch (e) {}
  }
  return computed
}
const APP_LOC = '/' + String(_program).replace(/^\/+/, '').replace(/\/services\/.*$/, '')
const SETTINGS_FILE = path.join(driveRoot(), 'files', APP_LOC.replace(/^\//, ''), 'settings.json')

let result
if (rootdir) {
  try {
    fs.mkdirSync(rootdir, { recursive: true }) // like %mf_mkdir
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }) // the apploc
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ rootdir: rootdir }))
    result = [{ STATUS: 'configured', ROOTDIR: rootdir }]
    stampIndexHtml()
  } catch (e) {
    result = [{ STATUS: 'error: ' + e.message, ROOTDIR: '' }]
  }
} else {
  result = [{ STATUS: 'error: no rootdir provided', ROOTDIR: '' }]
}

_webout = JSON.stringify({
  _PROGRAM: _program,
  SYSDATE: SYSDATE,
  SYSTIME: SYSTIME,
  _METAUSER: _METAUSER,
  SASJSPROCESSMODE: SASJSPROCESSMODE,
  result: result
})

/* flip the configured flag in the streamed index.html via the Drive API */
function stampIndexHtml() {
  const api = 'http://127.0.0.1:' + (process.env.PORT || 5000) +
    '/SASjsApi/drive/file?_filePath=' +
    encodeURIComponent('/Public/app/macrodash/services/web/index.html')

  let auth = ''
  try {
    /* _SASJS_TOKENFILE holds the captured request headers, one per line
     * in "name: value" form.  Pull the authorization header line. */
    auth = fs.readFileSync(_SASJS_TOKENFILE, 'utf8').split('\n')
      .find((h) => h.trim().toLowerCase().startsWith('authorization:')) || ''
  } catch (e) {
    /* no headers captured: server must be running without auth */
  }
  const headers = {}
  const i = auth.indexOf(':')
  if (i > 0) headers[auth.slice(0, i).trim()] = auth.slice(i + 1).trim()

  fetch(api, { headers: headers })
    .then((res) => {
      if (!res.ok) throw new Error('GET failed: ' + res.status)
      return res.text()
    })
    .then((html) => {
      const stamped = html.replace('configured="false"', 'configured="true"')
      if (stamped === html) return // already stamped (or attribute missing)
      const form = new FormData()
      form.append('file', new Blob([stamped], { type: 'text/html' }), 'index.html')
      return fetch(api, { method: 'PATCH', headers: headers, body: form })
    })
    .catch(() => {
      /* drive unreachable / auth on: harmless - the page just won't know
         until the next configure (there is no getconfig service) */
    })
}

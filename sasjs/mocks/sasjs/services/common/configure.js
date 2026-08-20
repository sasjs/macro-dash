/* Macro Dash mock: services/common/configure
 * Mirrors configure.sas.  Input table `config` arrives as CSV (inline or
 * uploaded file): one row, column rootdir.  Like the real service, the
 * folder is validated by actually creating it - the server is local, so
 * rootdir is a real path on this machine.  The choice persists in
 * <drive>/macrodash.settings.json (no /tmp), so getscores.js reports
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

/* Parse a sasjs_tables CSV string.  The adapter sends:
 *   - header row as SPACE-separated `name:format.` entries (e.g.
 *     "rootdir:$char256.") - the format must be stripped
 *   - CRLF line endings
 *   - values containing special chars wrapped in double quotes ("" escaped)
 */
/* the adapter may deliver an input table either as an inline CSV string
 * (const <name> = `...`) OR as an uploaded file - in that case the runtime
 * provides const _WEBIN_FILEREF<n> (file CONTENTS, a Buffer),
 * _WEBIN_NAME<n> (table name), _WEBIN_FILENAME<n> and _WEBIN_FILE_COUNT.
 * NOTE: these are module-scope consts, NOT on globalThis - hence the
 * (direct) eval lookups below.  Server-side JS only; no CSP here. */
function getTable(name) {
  try {
    const v = eval('typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined')
    if (v !== undefined) return String(v)
  } catch (e) { /* fall through to file lookup */ }
  try {
    if (typeof _WEBIN_FILE_COUNT !== 'undefined') {
      for (let i = 1; i <= _WEBIN_FILE_COUNT; i++) {
        const n = eval('typeof _WEBIN_NAME' + i + ' !== "undefined" ? _WEBIN_NAME' + i + ' : undefined')
        if (n === name) return eval('_WEBIN_FILEREF' + i + '.toString("utf8")')
      }
    }
  } catch (e) { /* no uploads */ }
  return ''
}

function parseCsv(csv) {
  const lines = String(csv || '').trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const cols = lines[0].trim().split(/[ ,]+/).map((h) =>
    h.replace(/:.*$/, '').trim().toUpperCase())
  return lines.slice(1).map((l) => {
    const vals = l.trim().split(',')
    const row = {}
    cols.forEach((c, i) => {
      let v = (vals[i] || '').trim()
      if (v.length > 1 && v[0] === '"' && v[v.length - 1] === '"') {
        v = v.slice(1, -1).replace(/""/g, '"')
      }
      row[c] = v
    })
    return row
  })
}

const rows = parseCsv(getTable('config'))
const rootdir = rows.length ? rows[0].ROOTDIR : ''

const path = require('path')
const DRIVE_ROOT = path.resolve(weboutPath, '..', '..', '..', 'drive')
const SETTINGS_FILE = path.join(DRIVE_ROOT, 'macrodash.settings.json')

let result
if (rootdir) {
  try {
    fs.mkdirSync(rootdir, { recursive: true }) // like %mf_mkdir
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

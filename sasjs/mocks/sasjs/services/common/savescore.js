/* Macro Dash mock: services/common/savescore
 * Mirrors savescore.sas.  Input table `savescore` arrives as CSV (inline
 * or uploaded file): one row with columns name,time,score,amps,done.  The
 * entry is merged into the leaderboard in the configured rootdir
 * (scores.json - the mock analogue of md_rootdir/scores.sas7bdat),
 * sorted finishers-first by time then DNFs by recency; the full table
 * plus the player's RANK are returned, along with the standard SASjs
 * automatic fields.  No /tmp.
 */

const now = new Date()
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const SYSDATE = ('0' + now.getDate()).slice(-2) + MONTHS[now.getMonth()] +
  String(now.getFullYear()).slice(-2)
const SYSTIME = ('0' + now.getHours()).slice(-2) + ':' +
  ('0' + now.getMinutes()).slice(-2)

/* sasjs_tables CSV: space-separated `name:format.` headers, CRLF endings,
 * special-char values wrapped in double quotes - see configure.js */
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

const rows = parseCsv(getTable('savescore'))

/* same contract as savescore.sas: abort when the backend is not configured
 * (a thrown error surfaces to the adapter as a failed request, like
 * %mp_abort does) */
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

let rootdir = ''
try {
  rootdir = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')).rootdir || ''
} catch (e) { /* not configured */ }

if (!rootdir) {
  throw new Error('Macro Dash is not configured - no results folder')
}

const SCORES_FILE = path.join(rootdir, 'scores.json')
let scores = []
try {
  scores = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'))
} catch (e) {
  /* start empty */
}

let rank = null
if (rows.length) {
  const r = rows[0]
  const done = parseInt(r.DONE, 10) === 1 ? 1 : 0
  /* missing/empty time => DNF */
  const tm = (r.TIME === '' || r.TIME === undefined || r.TIME === '.' ||
              isNaN(parseFloat(r.TIME))) ? null : parseFloat(r.TIME)
  /* SAS datetime(): seconds since 1960-01-01 (matches the real service's
  submitted=datetime()).  315619200000ms = 10 years, bridging the JS
  1970 epoch to the SAS 1960 epoch. */
  const MS_TEN_YEARS = 315619200000
  scores.push({
    NAME: r.NAME || 'MOCKUSER',
    TIME: tm,
    SCORE: parseInt(r.SCORE, 10) || 0,
    AMPS: parseInt(r.AMPS, 10) || 0,
    DONE: done,
    SUBMITTED: Math.floor((Date.now() + MS_TEN_YEARS) / 1000)
  })
  /* finishers first by time (then score); DNFs after, most-recent first */
  scores.sort((a, b) => {
    if ((b.DONE || 0) !== (a.DONE || 0)) return (b.DONE || 0) - (a.DONE || 0)
    if (a.DONE) {
      return (a.TIME - b.TIME) || (b.SCORE - a.SCORE)
    }
    return (b.SUBMITTED - a.SUBMITTED)
  })
  scores = scores.slice(0, 50)
  const mine = scores[scores.length - 1] === undefined ? null :
    scores.find((s) => s.NAME === (r.NAME || 'MOCKUSER') &&
      ((r.TIME === '' || r.TIME === undefined) ? s.TIME === null :
       s.TIME === parseFloat(r.TIME)) && s.DONE === done)
  rank = mine ? scores.indexOf(mine) + 1 : null
  try {
    fs.writeFileSync(SCORES_FILE, JSON.stringify(scores))
  } catch (e) {
    /* readonly fs: return the merged board anyway */
  }
}

_webout = JSON.stringify({
  _PROGRAM: _program,
  SYSDATE: SYSDATE,
  SYSTIME: SYSTIME,
  _METAUSER: _METAUSER,
  SASJSPROCESSMODE: SASJSPROCESSMODE,
  scores: scores,
  result: [{ RANK: rank }]
})

/* Macro Dash mock: services/common/savescore
 * Mirrors savescore.sas.  Input table `savescore` arrives as CSV (inline
 * or uploaded file): one row with columns name,time,score,amps.  The entry
 * is merged into the leaderboard in the configured rootdir (scores.json -
 * the mock analogue of sb_rootdir/scores.sas7bdat), sorted by time
 * (fastest first); the full table plus the player's RANK are returned,
 * along with the standard SASjs automatic fields.  No /tmp.
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
const DRIVE_ROOT = path.resolve(weboutPath, '..', '..', '..', 'drive')
const SETTINGS_FILE = path.join(DRIVE_ROOT, 'macrodash.settings.json')

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
  scores.push({
    NAME: rows[0].NAME,
    TIME: parseFloat(rows[0].TIME),
    SCORE: parseInt(rows[0].SCORE, 10),
    AMPS: parseInt(rows[0].AMPS, 10)
  })
  scores.sort((a, b) => a.TIME - b.TIME || b.SCORE - a.SCORE)
  scores = scores.slice(0, 50)
  rank = scores.findIndex((s) => s.NAME === rows[0].NAME &&
    s.TIME === parseFloat(rows[0].TIME)) + 1
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

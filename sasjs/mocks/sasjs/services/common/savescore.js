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

/* The host-injected shared FETCH reads inline and staged input tables.
 * SAS column names are case-insensitive; normalise the returned keys. */
const rows = (webout('FETCH').savescore || []).map((row) =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toUpperCase(), value]))
)

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
      s.TIME === tm && s.DONE === done)
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

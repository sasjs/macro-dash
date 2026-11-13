/* Macro Dash mock: services/common/getscores
 * Returns the leaderboard as a `scores` table (UPPERCASE columns), same as
 * getscores.sas, plus the standard SASjs automatic fields.
 *
 * Matches the real service contract: an EMPTY table until the backend has
 * been configured AND at least one score exists.  Scores live in the
 * configured rootdir as scores.json (the mock analogue of
 * md_rootdir/scores.sas7bdat) - no /tmp, no browser storage: once the
 * backend is configured, the leaderboard is a real shared board.
 */

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

function readJson(f, fallback) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch (e) {
    return fallback
  }
}

/* standard SASjs response fields */
const now = new Date()
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const SYSDATE = ('0' + now.getDate()).slice(-2) + MONTHS[now.getMonth()] +
  String(now.getFullYear()).slice(-2)
const SYSTIME = ('0' + now.getHours()).slice(-2) + ':' +
  ('0' + now.getMinutes()).slice(-2)

/* unconfigured => empty leaderboard (same as getscores.sas) */
const rootdir = readJson(SETTINGS_FILE, {}).rootdir
const scores = rootdir ? readJson(path.join(rootdir, 'scores.json'), []) : []

_webout = JSON.stringify({
  _PROGRAM: _program,
  SYSDATE: SYSDATE,
  SYSTIME: SYSTIME,
  _METAUSER: _METAUSER,
  SASJSPROCESSMODE: SASJSPROCESSMODE,
  scores: scores
})

/* Macro Dash mock: services/common/getconfig
 * Runs on a LOCAL @sasjs/server (JS runtime, RUN_TIMES=js) so the frontend
 * can be developed without SAS.  Mirrors the real getconfig.sas response:
 * a `config` table with CONFIGURED / ROOTDIR columns, plus the standard
 * SASjs automatic fields (_PROGRAM, SYSDATE, SYSTIME, ...).
 * Settings persist on the SASjs Drive (written by configure.js) - no /tmp.
 */

const path = require('path')
const DRIVE_ROOT = path.resolve(weboutPath, '..', '..', '..', 'drive')
const SETTINGS_FILE = path.join(DRIVE_ROOT, 'macrodash.settings.json')

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
  } catch (e) {
    return {}
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

const rootdir = readSettings().rootdir || ''

_webout = JSON.stringify({
  _PROGRAM: _program,
  SYSDATE: SYSDATE,
  SYSTIME: SYSTIME,
  _METAUSER: _METAUSER,
  SASJSPROCESSMODE: SASJSPROCESSMODE,
  config: [
    {
      CONFIGURED: rootdir ? 1 : 0,
      ROOTDIR: rootdir
    }
  ]
})

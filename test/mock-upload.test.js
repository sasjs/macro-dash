// Integration harness for the stored programs on the new staged-file contract.
// Server #758 and CLI #1628 supply paths rather than inline file contents.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const serviceDir = path.join(__dirname, '../sasjs/mocks/sasjs/services/common')

function run(service, uploadName, csv, failure) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-upload-'))
  try {
    const weboutPath = path.join(root, 'sessions/s1/webout.txt')
    const drive = path.join(root, 'drive/files/Public/app/macrodash')
    const scores = path.join(root, 'scores')
    fs.mkdirSync(path.dirname(weboutPath), { recursive: true })
    fs.mkdirSync(drive, { recursive: true })
    fs.mkdirSync(scores, { recursive: true })
    fs.writeFileSync(path.join(drive, 'settings.json'), JSON.stringify({ rootdir: scores }))
    const other = path.join(root, 'other.csv')
    const upload = path.join(root, 'staged.csv')
    fs.writeFileSync(other, 'x:$char1.\r\nx')
    fs.writeFileSync(upload, typeof csv === 'function' ? csv(root) : csv)
    if (failure === 'missing') fs.unlinkSync(upload)
    const serviceFs = failure === 'unreadable' ? Object.assign({}, fs, {
      readFileSync(file, ...args) {
        if (file === upload) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
        return fs.readFileSync(file, ...args)
      }
    }) : fs
    const source = fs.readFileSync(path.join(serviceDir, service + '.js'), 'utf8')
    const execute = new Function('require', 'fs', 'weboutPath', '_program', '_METAUSER',
      'SASJSPROCESSMODE', 'fetch', '_WEBIN_FILE_COUNT', '_WEBIN_NAME1',
      '_WEBIN_FILEREF1', '_WEBIN_NAME2', '_WEBIN_FILEREF2',
      'let _webout;\n' + source + '\nreturn JSON.parse(_webout)')
    return execute(require, serviceFs, weboutPath, '/Public/app/macrodash/services/common/' + service,
      'tester', 'mock', () => Promise.reject(new Error('no server')), 2,
      'unrelated', other, uploadName, upload)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('configure reads the named staged upload, not its path', () => {
  const result = run('configure', 'config', (root) => `rootdir:$char256.\r\n${root}/configured`)
  assert.equal(result.result[0].STATUS, 'configured')
  assert.match(result.result[0].ROOTDIR, /macro-upload-.*\/configured$/)
})

test('savescore reads the named staged upload, not its path', () => {
  const result = run('savescore', 'savescore',
    'name:$char40. time:best. score:best. amps:best. done:best.\r\nAlice,12.5,10,3,1')
  assert.equal(result.scores.length, 1)
  assert.equal(result.scores[0].NAME, 'Alice')
  assert.equal(result.scores[0].TIME, 12.5)
  assert.equal(result.result[0].RANK, 1)
})

for (const [service, table] of [['configure', 'config'], ['savescore', 'savescore']]) {
  for (const [failure, code] of [['missing', 'ENOENT'], ['unreadable', 'EACCES']]) {
    test(`${service} surfaces a ${failure} staged file instead of treating it as absent`, () => {
      assert.throws(() => run(service, table, 'header\r\nvalue', failure), { code })
    })
  }
}

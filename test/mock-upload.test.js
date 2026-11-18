// Integration harness for the stored programs on the new staged-file contract.
// Server #758 and CLI #1628 supply paths rather than inline file contents.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { createRequire } = require('node:module')
// Resolve the prelude from CLI's dependency tree, not an app-level utils pin.
const cliRequire = createRequire(require.resolve('@sasjs/cli/package.json'))
const { getWeboutPrelude } = cliRequire('@sasjs/utils')

const serviceDir = path.join(__dirname, '../sasjs/mocks/sasjs/services/common')

function run(service, uploadName, csv, failure, inline = false) {
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
    const prelude = getWeboutPrelude({
      weboutPath, headersPath: path.join(root, 'headers.txt'),
      program: '/Public/app/macrodash/services/common/' + service,
      username: 'tester', userId: 'tester', debug: '', apiServerUrl: 'http://localhost'
    })
    const context = inline
      ? { params: { sasjs_tables: uploadName, sasjs1data: fs.readFileSync(upload, 'utf8') } }
      : { tables: [
          { name: 'unrelated', filename: 'other.csv', get csv() { return fs.readFileSync(other, 'utf8') } },
          { name: uploadName, filename: uploadName + '.csv', get csv() { return serviceFs.readFileSync(upload, 'utf8') } }
        ] }
    const execute = new Function('require', 'fs', 'weboutPath', '_program', '_METAUSER',
      'SASJSPROCESSMODE', 'fetch', '_sasjs_fetch_context', 'globalThis',
      'let _webout;\n' + prelude + '\nconst webout = globalThis.webout;\n' + source + '\nreturn JSON.parse(_webout)')
    return execute(require, serviceFs, weboutPath, '/Public/app/macrodash/services/common/' + service,
      'tester', 'mock', () => Promise.reject(new Error('no server')), context, {})
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

test('configure accepts numeric rootdirs, including zero, as paths', () => {
  const cwd = process.cwd()
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-numeric-'))
  try {
    process.chdir(scratch)
    for (const number of ['123', '0']) {
      const result = run('configure', 'config', `rootdir:best.\r\n${number}`)
      assert.equal(result.result[0].STATUS, 'configured')
      assert.equal(result.result[0].ROOTDIR, number)
      assert.ok(fs.statSync(path.join(scratch, number)).isDirectory())
    }
  } finally {
    process.chdir(cwd)
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('configure treats numeric missing and absent rootdir as no input', () => {
  for (const csv of ['rootdir:best.\r\n.', 'other:$char4.\r\nhi']) {
    const result = run('configure', 'config', csv)
    assert.equal(result.result[0].STATUS, 'error: no rootdir provided')
    assert.equal(result.result[0].ROOTDIR, '')
  }
})

test('configure preserves a quoted comma in the staged rootdir', () => {
  const result = run('configure', 'config', (root) => `rootdir:$char256.\r\n"${root}/with,comma"`)
  assert.equal(result.result[0].STATUS, 'configured')
  assert.match(result.result[0].ROOTDIR, /\/with,comma$/)
})

test('savescore ignores blank physical rows and accepts a trailing CRLF', () => {
  const result = run('savescore', 'savescore',
    'name:$char40. time:best. score:best. amps:best. done:best.\r\n\r\nAlice,12.5,10,3,1\r\n\r\n')
  assert.equal(result.scores.length, 1)
  assert.equal(result.scores[0].NAME, 'Alice')
  assert.equal(result.scores[0].TIME, 12.5)
})

test('savescore preserves a quoted comma in the staged player name', () => {
  const result = run('savescore', 'savescore',
    'name:$char40. time:best. score:best. amps:best. done:best.\r\n"Alice,Dev",12.5,10,3,1')
  assert.equal(result.scores[0].NAME, 'Alice,Dev')
  assert.equal(result.scores[0].TIME, 12.5)
})

test('configure fetches an inline table', () => {
  const result = run('configure', 'config', (root) => `RootDir:$char256.\r\n${root}/inline`, undefined, true)
  assert.equal(result.result[0].STATUS, 'configured')
  assert.match(result.result[0].ROOTDIR, /\/inline$/)
})

test('savescore fetches an inline table', () => {
  const result = run('savescore', 'savescore',
    'Name:$char40. Time:best. Score:best. Amps:best. Done:best.\r\nAlice,12.5,10,3,1', undefined, true)
  assert.equal(result.scores[0].NAME, 'Alice')
  assert.equal(result.scores[0].TIME, 12.5)
})

test('savescore ranks a DNF with a numeric missing time', () => {
  const result = run('savescore', 'savescore',
    'name:$char40. time:best. score:best. amps:best. done:best.\r\nAlice,.,0,0,0')
  assert.equal(result.scores[0].TIME, null)
  assert.equal(result.result[0].RANK, 1)
})

for (const [service, table] of [['configure', 'config'], ['savescore', 'savescore']]) {
  for (const [failure, code] of [['missing', 'ENOENT'], ['unreadable', 'EACCES']]) {
    test(`${service} surfaces a ${failure} staged file instead of treating it as absent`, () => {
      assert.throws(() => run(service, table, 'header\r\nvalue', failure), { code })
    })
  }
}

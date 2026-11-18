// Check the prelude the CLI will actually embed, not an app-level utils pin.
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const cliRequire = createRequire(require.resolve('@sasjs/cli/package.json'))
const { getWeboutPrelude } = cliRequire('@sasjs/utils')

const prelude = getWeboutPrelude({
  weboutPath: '', headersPath: '', program: '', username: '', userId: '',
  debug: '', apiServerUrl: ''
})
const fetchTables = new Function('require', '_sasjs_fetch_context', 'globalThis',
  prelude + "\nreturn globalThis.webout('FETCH')")
const tables = fetchTables(require, {
  tables: [{ name: 'config', csv: 'rootdir:$char20. extra:best.\r\nfolder,3\r\n\r\n' }]
}, {})
assert.equal(tables.config.length, 1, 'FETCH must ignore blank physical rows and a terminal CRLF')
assert.equal(tables.config[0].rootdir, 'folder')
assert.equal(tables.config[0].extra, 3)
console.log('CLI-injected FETCH passes the mock input contract')

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const root = join(__dirname, '..')
const report = (via = [], severity = 'high') => ({
  auditReportVersion: 2,
  vulnerabilities: via.length ? { fixture: {
    name: 'fixture', severity, isDirect: false, via,
    effects: [], range: '<1.0.0', nodes: ['node_modules/fixture'], fixAvailable: false
  } } : {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, ...(via.length ? { [severity]: 1 } : {}), total: via.length ? 1 : 0 }, dependencies: {} }
})
const finding = (source, severity = 'high') => ({
  source, name: 'fixture', dependency: 'fixture', title: 'synthetic advisory',
  url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity, range: '<1.0.0'
})
const waiver = { id: 'GHSA-aaaa-bbbb-cccc', source: 101, severity: 'high', packages: ['fixture'], recheckBy: '2099-01-31', reason: 'synthetic test', devOnly: true }

function runGate(t, full, exemptions, production = report()) {
  const dir = mkdtempSync(join(tmpdir(), 'macro-dash-audit-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [name, value] of Object.entries({ 'full.json': full, 'prod.json': production, 'waivers.json': exemptions }))
    writeFileSync(join(dir, name), JSON.stringify(value))
  const run = spawnSync('npm', ['run', 'audit:gate', '--', '--audit-input', join(dir, 'full.json'), '--audit-prod-input', join(dir, 'prod.json'), '--audit-config', join(dir, 'waivers.json')], { cwd: root, encoding: 'utf8' })
  return { status: run.status, output: `${run.stdout || ''}${run.stderr || ''}` }
}

test('the gate rejects an invalid recorded report', (t) => {
  const result = runGate(t, { auditReportVersion: 2, metadata: {} }, [])
  assert.notEqual(result.status, 0, result.output)
  assert.match(result.output, /not an npm audit report/i)
})

test('the gate rejects an unwaived advisory at low and moderate severity', (t) => {
  for (const severity of ['low', 'moderate']) {
    const result = runGate(t, report([finding(101, severity)], severity), [])
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /not in the allowlist/i)
  }
})

test('the gate accepts an exact dev-only waiver', (t) => {
  const result = runGate(t, report([finding(101)]), [waiver])
  assert.equal(result.status, 0, result.output)
})

test('the gate requires severity and source on every waiver', (t) => {
  for (const field of ['source', 'severity']) {
    const entry = { ...waiver }
    delete entry[field]
    const result = runGate(t, report([finding(101)]), [entry])
    assert.notEqual(result.status, 0, result.output)
    assert.match(result.output, new RegExp(`${field} is required`, 'i'))
  }
})

test('the gate rejects an unreviewed source sharing a GHSA', (t) => {
  const result = runGate(t, report([finding(101), finding(102)]), [waiver])
  assert.notEqual(result.status, 0, result.output)
  assert.match(result.output, /source differs/i)
})

test('the gate rejects a changed severity', (t) => {
  const result = runGate(t, report([finding(101)]), [{ ...waiver, severity: 'moderate' }])
  assert.notEqual(result.status, 0, result.output)
  assert.match(result.output, /severity differs/i)
})

test('the gate never exempts a production finding', (t) => {
  const result = runGate(t, report([finding(101)]), [waiver], report([finding(101)]))
  assert.notEqual(result.status, 0, result.output)
  assert.match(result.output, /production tree/i)
})

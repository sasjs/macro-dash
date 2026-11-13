#!/usr/bin/env node
/**
 * Release macro-dash from its conventional commits, without writing to main.
 *
 * Two modes, both driven by the tags and by package.json:
 *
 *   node scripts/release.mjs            (default) cut the release this commit
 *                                       describes - tag it and publish it, if
 *                                       package.json is ahead of the last tag
 *   node scripts/release.mjs --propose  open (or refresh) the pull request that
 *                                       bumps package.json and CHANGELOG.md to
 *                                       the next version, worked out from the
 *                                       conventional commits since the last tag
 *
 * Neither mode commits to main: the default tags the commit a human merged, and
 * --propose pushes a release branch and opens a pull request. A person merges
 * that pull request; the push it makes then tags and publishes the release here.
 *
 *   --dry-run   say what it would do, change nothing
 *
 * No dependencies: node's own fs/child_process, and the `gh` CLI on the runner.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const PROPOSE = args.includes('--propose')

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const run = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8' })

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n')

function latestTag() {
  try {
    return git('describe', '--tags', '--abbrev=0')
  } catch (e) {
    return ''
  }
}

function commitsSince(from) {
  const range = from ? `${from}..HEAD` : 'HEAD'
  const raw = git('log', range, '--pretty=format:%s%x00%b%x01')
  if (!raw) return []
  return raw.split('\x01').filter(Boolean).map((entry) => {
    const [subject, body = ''] = entry.split('\x00')
    return { subject: subject.trim(), body: body.trim() }
  })
}

const TYPES = { feat: 'minor', fix: 'patch', perf: 'patch', refactor: 'patch' }

function classify({ subject, body }) {
  const m = subject.match(/^([a-z]+)(\([^)]*\))?(!)?:\s*(.+)$/i)
  if (!m) return { type: 'other', breaking: false, text: subject }
  const [, type, , bang, text] = m
  return {
    type: type.toLowerCase(),
    breaking: Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body),
    text
  }
}

function nextVersion(current, level) {
  const [major, minor, patch] = current.split('.').map(Number)
  if (level === 'major') return `${major + 1}.0.0`
  if (level === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const TITLES = {
  breaking: 'BREAKING CHANGES',
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance',
  refactor: 'Refactors'
}

function groups(commits) {
  const out = { breaking: [], feat: [], fix: [], perf: [], refactor: [] }
  for (const c of commits) {
    const parsed = classify(c)
    if (parsed.breaking) out.breaking.push(parsed)
    if (parsed.type in out) out[parsed.type].push(parsed)
  }
  return out
}

function entry(version, out, repo, previous) {
  const date = new Date().toISOString().slice(0, 10)
  const link = previous
    ? `https://github.com/${repo}/compare/${previous}...v${version}`
    : `https://github.com/${repo}/releases/tag/v${version}`
  const lines = [`## [${version}](${link}) (${date})`, '']
  for (const key of ['breaking', 'feat', 'fix', 'perf', 'refactor']) {
    if (!out[key].length) continue
    lines.push(`### ${TITLES[key]}`, '')
    for (const c of out[key]) lines.push(`* ${c.text}`)
    lines.push('')
  }
  return lines.join('\n')
}

function releaseNotes(repo, tag) {
  const dir = mkdtempSync(join(tmpdir(), 'md-release-'))
  const notes = join(dir, 'notes.md')
  const changelog = existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8') : ''
  const match = changelog.match(/^## \[[^\]]+\][^\n]*\n([\s\S]*?)(?=^## \[|$)/m)
  writeFileSync(notes, (match ? match[1] : `Release ${tag}`).trim() + '\n')
  return notes
}

/** Cut the release for the version package.json already states. */
function cut() {
  const repo = process.env.GITHUB_REPOSITORY || 'sasjs/macro-dash'
  const version = readJson('package.json').version
  const tag = `v${version}`
  const previous = latestTag()

  // the tag is what the site and the releases use; package.json only says which
  // version this commit is for, so a tag at or ahead of it means it is released
  const cmp = (a, b) => {
    const p = (s) => String(s).replace(/^v/, '').split('.').map(Number)
    const [a1, a2, a3] = p(a)
    const [b1, b2, b3] = p(b)
    return (a1 - b1) || (a2 - b2) || (a3 - b3)
  }
  if (previous && cmp(previous, tag) >= 0) {
    console.log(`already released: ${previous} (package.json ${version})`)
    return { released: false }
  }

  if (git('rev-list', '--count', `${previous || 'HEAD'}..HEAD`) === '0' && previous) {
    console.log(`nothing merged since ${previous}`)
    return { released: false }
  }

  console.log(`releasing ${tag} (package.json ${version}, last tag ${previous || 'none'})`)
  if (DRY) return { released: false, wouldRelease: tag }

  git('tag', '-a', tag, '-m', tag)
  git('push', 'origin', tag)
  run('gh', ['release', 'create', tag, '--title', tag, '--notes-file', releaseNotes(repo, tag)])
  console.log(`released ${tag}`)
  return { released: true, tag }
}

/** Open or refresh the pull request that carries the next version. */
function propose() {
  const repo = process.env.GITHUB_REPOSITORY || 'sasjs/macro-dash'
  const current = readJson('package.json').version
  const previous = latestTag()
  const commits = commitsSince(previous)
  const out = groups(commits)
  const releasable = commits
    .map(classify)
    .filter((c) => c.breaking || c.type in TYPES)

  if (!releasable.length) {
    console.log(`nothing to propose since ${previous || 'the first commit'}`)
    return { proposed: false }
  }

  const level = releasable.some((c) => c.breaking)
    ? (Number(current.split('.')[0]) === 0 ? 'minor' : 'major')
    : releasable.some((c) => c.type === 'feat') ? 'minor' : 'patch'
  const version = nextVersion(current, level)
  const tag = `v${version}`
  const branch = `release/${tag}`

  console.log(`${level} release: ${current} -> ${version} (${releasable.length} commits)`)
  if (DRY) return { proposed: false, wouldPropose: version }

  const pkg = readJson('package.json')
  pkg.version = version
  writeJson('package.json', pkg)

  if (existsSync('package-lock.json')) {
    const lock = readJson('package-lock.json')
    lock.version = version
    if (lock.packages && lock.packages['']) lock.packages[''].version = version
    writeJson('package-lock.json', lock)
  }

  const text = entry(version, out, repo, previous)
  const changelog = existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8') : ''
  writeFileSync('CHANGELOG.md', text + '\n' + changelog)

  // a release branch, never main
  git('checkout', '-B', branch)
  git('add', 'package.json', 'package-lock.json', 'CHANGELOG.md')
  git('-c', 'user.name=sasjs', '-c', 'user.email=sasjs@4gl.io', 'commit', '-m', `chore(release): ${version}`)
  git('push', '--force', 'origin', branch)

  const body = [
    `Release ${tag}.`,
    '',
    text,
    '',
    'Merging this pull request is the release: the push to main tags it and publishes it.'
  ].join('\n')
  const dir = mkdtempSync(join(tmpdir(), 'md-release-'))
  const bodyFile = join(dir, 'body.md')
  writeFileSync(bodyFile, body)

  const existing = execFileSync('gh', ['pr', 'list', '--head', branch, '--json', 'number', '--jq', '.[0].number'],
    { encoding: 'utf8' }).trim()
  if (existing) {
    run('gh', ['pr', 'edit', existing, '--title', `chore(release): ${version}`, '--body-file', bodyFile])
    console.log(`refreshed pull request #${existing}`)
    return { proposed: true, pr: existing }
  }
  const url = run('gh', ['pr', 'create', '--head', branch, '--base', 'main',
    '--title', `chore(release): ${version}`, '--body-file', bodyFile]).trim()
  console.log(`opened ${url}`)
  return { proposed: true, url }
}

const result = PROPOSE ? propose() : cut()
if (process.env.GITHUB_OUTPUT) {
  const lines = Object.entries(result)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => `${k}=${v}`)
  const released = result.released ? 'released=true' : 'released=false'
  writeFileSync(process.env.GITHUB_OUTPUT, [released, ...lines].join('\n') + '\n', { flag: 'a' })
}

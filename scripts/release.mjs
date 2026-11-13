#!/usr/bin/env node
/**
 * Release macro-dash from its conventional commits.
 *
 * Works out the next version from what has been merged since the last tag,
 * writes it into package.json and both version fields of package-lock.json,
 * prepends the changelog entry, commits, tags, pushes, and creates the GitHub
 * release. The workflow attaches the deployable artefacts afterwards.
 *
 *   node scripts/release.mjs             # release, if there is anything to release
 *   node scripts/release.mjs --dry-run   # say what it would do, change nothing
 *
 * No dependencies: node's own fs/child_process, and the `gh` CLI that the
 * runner provides for the release call.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DRY = process.argv.includes('--dry-run')

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' })

/** The commit subjects and bodies merged since `from`, newest last. */
function commitsSince(from) {
  const range = from ? `${from}..HEAD` : 'HEAD'
  const raw = git(['log', range, '--pretty=format:%s%x00%b%x01'])
  if (!raw) return []
  return raw.split('\x01').filter(Boolean).map((entry) => {
    const [subject, body = ''] = entry.split('\x00')
    return { subject: subject.trim(), body: body.trim() }
  })
}

const TYPES = {
  feat: 'minor',
  fix: 'patch',
  perf: 'patch',
  refactor: 'patch'
}

/** Conventional-commit parsing, including `!` and a BREAKING CHANGE footer. */
function classify({ subject, body }) {
  const m = subject.match(/^([a-z]+)(\([^)]*\))?(!)?:\s*(.+)$/i)
  if (!m) return { type: 'other', breaking: false, text: subject }
  const [, type, , bang, text] = m
  const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body)
  return { type: type.toLowerCase(), breaking, text }
}

function nextVersion(current, level) {
  const [major, minor, patch] = current.split('.').map(Number)
  if (level === 'major') return `${major + 1}.0.0`
  if (level === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

function group(commits) {
  const out = { breaking: [], feat: [], fix: [], perf: [], refactor: [], other: [] }
  for (const c of commits) {
    const parsed = classify(c)
    if (parsed.breaking) out.breaking.push(parsed)
    if (parsed.type in out) out[parsed.type].push(parsed)
    else out.other.push(parsed)
  }
  return out
}

const TITLES = {
  breaking: 'BREAKING CHANGES',
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance',
  refactor: 'Refactors'
}

function changelogEntry(version, groups, repo, previous) {
  const date = new Date().toISOString().slice(0, 10)
  const compare = previous
    ? `https://github.com/${repo}/compare/${previous}...v${version}`
    : `https://github.com/${repo}/releases/tag/v${version}`
  const lines = [`## [${version}](${compare}) (${date})`, '']
  for (const key of ['breaking', 'feat', 'fix', 'perf', 'refactor']) {
    if (!groups[key].length) continue
    lines.push(`### ${TITLES[key]}`, '')
    for (const c of groups[key]) lines.push(`* ${c.text}`)
    lines.push('')
  }
  return lines.join('\n')
}

function setVersions(version) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  pkg.version = version
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')

  const lockPath = 'package-lock.json'
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    lock.version = version
    if (lock.packages && lock.packages['']) lock.packages[''].version = version
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
  }
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY || 'sasjs/macro-dash'
  const current = JSON.parse(readFileSync('package.json', 'utf8')).version
  const previousTag = (() => {
    try {
      return git(['describe', '--tags', '--abbrev=0'])
    } catch (e) {
      return ''
    }
  })()

  const commits = commitsSince(previousTag)
  const groups = group(commits)

  // a release commit is not a reason to release again
  const releasable = commits
    .map(classify)
    .filter((c) => c.breaking || c.type in TYPES)

  if (!releasable.length) {
    console.log(`nothing to release since ${previousTag || 'the first commit'}`)
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, 'released=false\n', { flag: 'a' })
    return
  }

  const level = releasable.some((c) => c.breaking)
    ? (Number(current.split('.')[0]) === 0 ? 'minor' : 'major')
    : releasable.some((c) => c.type === 'feat') ? 'minor' : 'patch'

  const version = nextVersion(current, level)
  const tag = `v${version}`
  const entry = changelogEntry(version, groups, repo, previousTag)

  console.log(`${level} release: ${current} -> ${version} (${releasable.length} commits)`)
  console.log(entry)

  if (DRY) {
    console.log('\n--dry-run: nothing written')
    return
  }

  setVersions(version)
  const changelog = existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8') : ''
  writeFileSync('CHANGELOG.md', entry + '\n' + changelog)

  git(['add', 'package.json', 'package-lock.json', 'CHANGELOG.md'])
  git(['-c', 'user.name=sasjs', '-c', 'user.email=sasjs@4gl.io', 'commit', '-m', `chore(release): ${version}`])
  git(['tag', tag])
  git(['push', 'origin', 'HEAD:main'])
  git(['push', 'origin', tag])

  // the release body is the changelog entry, without the heading line
  const dir = mkdtempSync(join(tmpdir(), 'md-release-'))
  const notes = join(dir, 'notes.md')
  writeFileSync(notes, entry.split('\n').slice(2).join('\n'))
  run('gh', ['release', 'create', tag, '--title', tag, '--notes-file', notes])

  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `released=true\ntag=${tag}\n`, { flag: 'a' })
  }
  console.log(`released ${tag}`)
}

main()

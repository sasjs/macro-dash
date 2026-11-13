#!/usr/bin/env node
/**
 * Tag macro-dash for release, from its conventional commits.
 *
 * The git tag is the only record of a version: package.json states 0.0.0 and
 * nothing writes it, no commit is made by a release, and nothing is pushed to
 * any branch. What this creates is an annotated tag on the commit that was
 * merged, and a GitHub release whose notes are the commits it covers. The
 * workflows then build the assets with that version stamped into them.
 *
 *   node scripts/release.mjs             # tag and publish, if there is anything to release
 *   node scripts/release.mjs --dry-run   # say what it would tag, change nothing
 *
 * No dependencies: node's own fs/child_process, and the `gh` CLI on the runner.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DRY = process.argv.includes('--dry-run')

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const run = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8' })

function latestTag() {
  try {
    return git('describe', '--tags', '--abbrev=0')
  } catch (e) {
    return ''
  }
}

/** The commits merged since `from`, newest last, as subject and body. */
function commitsSince(from, to = 'HEAD') {
  const range = from ? `${from}..${to}` : to
  const raw = git('log', range, '--pretty=format:%s%x00%b%x01')
  if (!raw) return []
  return raw.split('\x01').filter(Boolean).map((entry) => {
    const [subject, body = ''] = entry.split('\x00')
    return { subject: subject.trim(), body: body.trim() }
  })
}

const TYPES = { feat: true, fix: true, perf: true, refactor: true }

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

/** Semver, from the version the last tag names. */
function nextVersion(base, level) {
  const [major, minor, patch] = (base || '0.0.0').split('.').map(Number)
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

function section(version, parsed, previous, date) {
  const repo = process.env.GITHUB_REPOSITORY || 'sasjs/macro-dash'
  const link = previous
    ? `https://github.com/${repo}/compare/${previous}...v${version}`
    : `https://github.com/${repo}/releases/tag/v${version}`
  const groups = { breaking: [], feat: [], fix: [], perf: [], refactor: [] }
  for (const c of parsed) {
    if (c.breaking) groups.breaking.push(c)
    if (c.type in groups) groups[c.type].push(c)
  }

  const lines = [`## [${version}](${link})${date ? ` (${date})` : ''}`, '']
  for (const key of Object.keys(TITLES)) {
    if (!groups[key].length) continue
    lines.push(`### ${TITLES[key]}`, '')
    for (const c of groups[key]) lines.push(`* ${c.text}`)
    lines.push('')
  }
  return lines.join('\n')
}

function main() {
  const previous = latestTag()
  const parsed = commitsSince(previous).map(classify)
  const releasable = parsed.filter((c) => c.breaking || c.type in TYPES)

  if (!releasable.length) {
    console.log(`nothing to release since ${previous || 'the first commit'}`)
    writeOutput({ released: false })
    return
  }

  const base = previous.replace(/^v/, '')
  const level = releasable.some((c) => c.breaking)
    ? (Number(base.split('.')[0]) === 0 ? 'minor' : 'major')
    : releasable.some((c) => c.type === 'feat') ? 'minor' : 'patch'
  const version = nextVersion(base, level)
  const tag = `v${version}`

  console.log(`${level} release: ${previous || 'none'} -> ${tag} (${releasable.length} commits)`)
  const body = section(version, parsed, previous, new Date().toISOString().slice(0, 10))
  console.log(body)

  if (DRY) {
    console.log('\n--dry-run: nothing tagged')
    writeOutput({ released: false, version })
    return
  }

  const dir = mkdtempSync(join(tmpdir(), 'md-release-'))
  const notesFile = join(dir, 'notes.md')
  writeFileSync(notesFile, body.split('\n').slice(2).join('\n') + '\n')

  // an annotated tag carries an identity, and a checkout in CI configures none
  git('-c', 'user.name=sasjs', '-c', 'user.email=sasjs@4gl.io', 'tag', '-a', tag, '-m', tag)
  git('push', 'origin', tag)
  run('gh', ['release', 'create', tag, '--title', tag, '--notes-file', notesFile])
  console.log(`released ${tag}`)
  writeOutput({ released: true, version, tag })
}

function writeOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`)
  writeFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n', { flag: 'a' })
}

main()

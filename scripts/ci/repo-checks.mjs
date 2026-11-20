#!/usr/bin/env node
// Repository checks that `claude plugin validate` does not make.
//
//   node scripts/ci/repo-checks.mjs [base-ref]
//
// 1. Every folder under mods/ is listed in .claude-plugin/marketplace.json, and every
//    listed source points at a folder that exists.
// 2. With a base ref (a branch, tag or sha), every mod whose files changed since that
//    ref has a different version in its plugin.json. `claude plugin update` only moves
//    to a new version, so a change without a bump never reaches an installed copy.
//
// Exits 1 with one line per problem.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const base = process.argv[2]
const problems = []

const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

// 1. Marketplace listing.
const market = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'))
const listed = new Map(market.plugins.map(p => [p.name, p.source]))
const folders = readdirSync(join(root, 'mods')).filter(name => statSync(join(root, 'mods', name)).isDirectory())

for (const name of folders) {
  if (!listed.has(name)) problems.push(`mods/${name} is not listed in .claude-plugin/marketplace.json`)
}
for (const [name, source] of listed) {
  const dir = join(root, source)
  if (!existsSync(join(dir, '.claude-plugin/plugin.json'))) {
    problems.push(`marketplace entry ${name} points at ${source}, which has no .claude-plugin/plugin.json`)
    continue
  }
  const manifest = JSON.parse(readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8'))
  if (manifest.name !== name) problems.push(`marketplace entry ${name} points at a plugin named ${manifest.name}`)
}

// 2. Version bumps.
if (base) {
  const changed = git('diff', '--name-only', `${base}...HEAD`, '--', 'mods/')
    .split('\n')
    .filter(Boolean)
  const mods = [...new Set(changed.map(path => path.split('/')[1]))]
  for (const name of mods) {
    const manifest = `mods/${name}/.claude-plugin/plugin.json`
    if (!existsSync(join(root, manifest))) continue // removed mod
    const now = JSON.parse(readFileSync(join(root, manifest), 'utf8')).version
    let before
    try {
      before = JSON.parse(git('show', `${base}:${manifest}`)).version
    } catch {
      continue // new mod: nothing to compare against
    }
    if (now === before) problems.push(`mods/${name} changed since ${base} but its version is still ${now}; bump it in ${manifest}`)
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`✘ ${p}`)
  process.exit(1)
}
console.log(`✔ ${folders.length} mods listed${base ? `; every mod changed since ${base} has a new version` : ''}`)

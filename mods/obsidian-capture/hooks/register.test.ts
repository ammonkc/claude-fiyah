import { test, expect } from 'claude-code/testing'

import { slugify, parseFrontmatter, inlineFields, fallbackSummary, firstHeading, entryLine, planTitle, planSlug, withStatus, mergeTags, upsertEntry, planSection, replacePlanSection, loggedInLink } from './register'

test('slugify matches the shell script: ampersand, punctuation, 80 char cap', () => {
  expect(slugify('Hooks & Mods: A Review!')).toBe('hooks-and-mods-a-review')
  expect(slugify('!!!')).toBe('unnamed-report')
  expect(slugify('a'.repeat(120)).length).toBe(80)
})

test('parseFrontmatter splits fields from body and tolerates none', () => {
  const r = parseFrontmatter('---\ntitle: T\ntags: a, b\n---\nbody')
  expect(r.fm).toEqual({ title: 'T', tags: 'a, b' })
  expect(r.body).toBe('body')
  expect(parseFrontmatter('no fm').body).toBe('no fm')
})

test('inlineFields reads bold key lines used by superpowers plans', () => {
  expect(inlineFields('**Goal:** ship it\n**Tech Stack:** TS\n**Empty:**')).toEqual({ goal: 'ship it', tech_stack: 'TS' })
})

test('firstHeading strips markdown and fallbackSummary skips code blocks', () => {
  expect(firstHeading('\n## The `Plan` *now*\ntext')).toBe('The Plan now')
  expect(fallbackSummary('# H\n```\ncode\n```\nreal text')).toBe('H real text')
})

test('entryLine starts with a newline so a tee -a append never joins the previous entry', () => {
  expect(entryLine('P/n', 'T', 'research', 'S')).toBe('\n- [[P/n|T]] (research)\n  - S\n')
})

test('planTitle skips generic section headings and a leading Plan: prefix', () => {
  expect(planTitle('## Context\n\n# Plan: Fix the `SFTP` deploy\ntext')).toBe('Fix the SFTP deploy')
  expect(planTitle('\n\n')).toBe('Unnamed Plan')
})

test('planSlug drops inner stop words only past six words and caps at 80 chars', () => {
  expect(planSlug('Fix the SFTP deploy')).toBe('fix-the-sftp-deploy')
  expect(planSlug('Fix the SFTP deploy path filter so the allowlist change deploys')).toBe('fix-sftp-deploy-path-filter-so-allowlist-change-deploys')
  expect(planSlug('word '.repeat(30)).length).toBeLessThanOrEqual(80)
})

test('withStatus changes only the frontmatter status line', () => {
  expect(withStatus('---\nstatus: planned\n---\nstatus: planned in body', 'saved-for-later')).toBe('---\nstatus: saved-for-later\n---\nstatus: planned in body')
})

test('mergeTags dedupes into existing tags, adds a block when absent, and prepends frontmatter when none', () => {
  expect(mergeTags('---\ntags:\n  - a\n  - b\n---\nbody', ['b', 'c'])).toBe('---\ntags:\n  - a\n  - b\n  - c\n---\nbody')
  expect(mergeTags('---\ncreated: x\n---\nbody', ['c'])).toBe('---\ncreated: x\ntags:\n  - c\n---\nbody')
  expect(mergeTags('body only', ['c'])).toBe('---\ntags:\n  - c\n---\nbody only')
})

test('upsertEntry appends a new plan entry, and re-labels an existing one in place without a duplicate', () => {
  const once = upsertEntry('---\ntags:\n  - a\n---\n', 'P/n', 'T', 'planned', 'S')
  expect(once.match(/\[\[P\/n\|/g)?.length).toBe(1)
  const twice = upsertEntry(once, 'P/n', 'T', 'saved for later', 'S2')
  expect(twice.match(/\[\[P\/n\|/g)?.length).toBe(1)
  expect(twice).toContain('- [[P/n|T]] (saved for later)')
  expect(twice).toContain('  - S\n')
})

test('replacePlanSection swaps only the marked plan text and keeps notes and links around it', () => {
  const note = `---\nstatus: planned\n---\n\n# T\n\n## Logged In\n[[Journal/x]]\n\n${planSection('## Context\nold')}\n## My notes\nkeep me\n`
  const out = replacePlanSection(note, '## Context\nnew')
  expect(out).toContain('new')
  expect(out).not.toContain('old')
  expect(out).toContain('## My notes\nkeep me')
  expect(out).toContain('[[Journal/x]]')
})

test('replacePlanSection on a legacy note without markers stops at the Conversation backlink', () => {
  const legacy = '---\nstatus: planned\n---\n\n# T\n\n## Plan\n\n## Context\nold\n\n## Conversation\n[[C]]\n'
  const out = replacePlanSection(legacy, 'new')
  expect(out).toContain('new')
  expect(out).not.toContain('old')
  expect(out).toContain('## Conversation\n[[C]]')
})

test('replacePlanSection appends a plan section when the note has none, and loggedInLink reads the journal link', () => {
  expect(replacePlanSection('# T\n', 'p')).toContain('## Plan')
  expect(loggedInLink('x\n## Logged In\n[[Journal/2026/10-October/10-09-2026]]\n')).toBe('Journal/2026/10-October/10-09-2026')
  expect(loggedInLink('nothing')).toBeUndefined()
})

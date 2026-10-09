import { test, expect } from 'claude-code/testing'

import { slugify, parseFrontmatter, inlineFields, fallbackSummary, firstHeading, entryLine, planTitle, planSlug, withStatus, mergeTags } from './register'

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

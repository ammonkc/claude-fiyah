import { test, expect } from 'claude-code/testing'

import { slugify, parseFrontmatter, inlineFields, fallbackSummary, firstHeading } from './register'

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

import { expect, test } from 'claude-code/testing'

import {
  buildDiffContext,
  isSecretPath,
  openSteps,
  parseGroups,
  parsePorcelain,
  reducePlan,
  splitPr,
} from './git'

test('parsePorcelain keeps renames with their origin and spaces in paths', () => {
  const out = ' M src/a b.ts\0R  new.ts\0old.ts\0?? docs/x.md\0'

  expect(parsePorcelain(out)).toEqual([
    { x: ' ', y: 'M', path: 'src/a b.ts' },
    { x: 'R', y: ' ', path: 'new.ts', orig: 'old.ts' },
    { x: '?', y: '?', path: 'docs/x.md' },
  ])
})

test('isSecretPath flags env and key files but not examples', () => {
  expect(isSecretPath('.env')).toBe(true)
  expect(isSecretPath('config/.env.local')).toBe(true)
  expect(isSecretPath('certs/server.pem')).toBe(true)
  expect(isSecretPath('.env.example')).toBe(false)
  expect(isSecretPath('src/environment.ts')).toBe(false)
})

test('parseGroups drops unknown and duplicate files and appends unassigned ones to the last group', () => {
  const raw = '```json\n[{"message":"feat(api): add route","files":["a.ts","ghost.ts"]},{"message":"test(api): cover route","files":["a.ts","b.test.ts"]}]\n```'

  expect(parseGroups(raw, ['a.ts', 'b.test.ts', 'c.ts'])).toEqual([
    { message: 'feat(api): add route', files: ['a.ts'] },
    { message: 'test(api): cover route', files: ['b.test.ts', 'c.ts'] },
  ])
})

test('parseGroups rejects a message outside the type(scope): description pattern', () => {
  expect(parseGroups('[{"message":"Added stuff","files":["a.ts"]}]', ['a.ts'])).toBeNull()
})

test('parseGroups accepts a bare commit line as one group over every file', () => {
  expect(parseGroups('"fix(auth): handle expired token"', ['a.ts', 'b.ts'])).toEqual([
    { message: 'fix(auth): handle expired token', files: ['a.ts', 'b.ts'] },
  ])
  expect(parseGroups('sorry, cannot', ['a.ts'])).toBeNull()
})

test('buildDiffContext keeps the stat whole and says when the diff was cut', () => {
  const out = buildDiffContext(' a.ts | 2 +-', 'x'.repeat(500), 100)

  expect(out.startsWith(' a.ts | 2 +-')).toBe(true)
  expect(out).toContain('[truncated')
})

test('splitPr separates the title from the body', () => {
  expect(splitPr('"feat(x): add y"\n\n## Summary\n* one')).toEqual({
    title: 'feat(x): add y',
    body: '## Summary\n* one',
  })
})

test('plan tracking opens on create, closes with next and done, ignores failed', () => {
  let state = reducePlan(
    {},
    { id: 'plan', stages: [{ title: 'A', steps: [{ title: 'one' }, { title: 'two' }] }, { title: 'B', steps: [{ title: 'three' }] }] },
  )

  expect(openSteps(state)).toBe(3)

  state = reducePlan(state, { id: 'plan', next: true })
  expect(openSteps(state)).toBe(2)

  state = reducePlan(state, { id: 'plan', done: ['two'], failed: 'three' })
  expect(openSteps(state)).toBe(0)
})

test('plan resend keeps steps already done by title', () => {
  let state = reducePlan({}, { id: 'p', kind: 'todo', steps: [{ title: 'a' }, { title: 'b' }] })

  state = reducePlan(state, { id: 'p', next: true })
  state = reducePlan(state, { id: 'p', kind: 'todo', steps: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] })

  expect(openSteps(state)).toBe(2)
})

import { expect, test } from 'claude-code/testing'

import {
  STATUS_ARGS,
  buildDiffContext,
  commitGroups,
  excludeSpec,
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

test('isSecretPath flags secrets files but not source files that mention the word', () => {
  expect(isSecretPath('config/secrets.json')).toBe(true)
  expect(isSecretPath('client_secret.json')).toBe(true)
  expect(isSecretPath('deploy/secrets.yaml')).toBe(true)
  expect(isSecretPath('.secret')).toBe(true)
  expect(isSecretPath('src/secrets.ts')).toBe(false)
  expect(isSecretPath('src/secret-manager.ts')).toBe(false)
  expect(isSecretPath('client_secret_123.apps.googleusercontent.com.json')).toBe(true)
  expect(isSecretPath('my-secret-token.txt')).toBe(true)
  expect(isSecretPath('secrets.local.json')).toBe(true)
  expect(isSecretPath('app.secret.local')).toBe(true)
})

test('a new directory is listed file by file, so a secret inside it is filtered and only a.ts is staged', async () => {
  expect(STATUS_ARGS).toContain('-uall')

  const entries = parsePorcelain('?? newdir/.env\0?? newdir/a.ts\0')
  const changed = entries.filter(e => !isSecretPath(e.path)).map(e => e.path)
  const groups = parseGroups('"feat(new): add a"', changed)!
  const calls: string[][] = []
  const run = async (args: string[]) => {
    calls.push(args)

    return { exitCode: 0, stdout: 'abc1234\n', stderr: '' }
  }

  await commitGroups(run, groups, entries)

  expect(calls.find(c => c[1] === 'add')).toEqual(['--literal-pathspecs', 'add', '--', 'newdir/a.ts'])
  expect(calls.find(c => c[1] === 'commit')?.slice(-2)).toEqual(['--', 'newdir/a.ts'])

  // Even a group that lists the secret file never stages it.
  calls.length = 0
  await commitGroups(run, [{ message: 'feat(new): add', files: ['newdir/.env', 'newdir/a.ts'] }], entries)
  expect(calls.flat()).not.toContain('newdir/.env')
})

test('a commit rejected part way names the groups already committed', async () => {
  const entries = parsePorcelain(' M a.ts\0 M b.ts\0')
  let commits = 0
  const run = async (args: string[]) => {
    if (args[1] === 'commit' && ++commits === 2) return { exitCode: 1, stdout: '', stderr: 'hook rejected' }

    return { exitCode: 0, stdout: 'abc1234\n', stderr: '' }
  }
  const groups = [
    { message: 'feat(a): one', files: ['a.ts'] },
    { message: 'feat(b): two', files: ['b.ts'] },
  ]

  await expect(commitGroups(run, groups, entries)).rejects.toThrow(/hook rejected[\s\S]*Already committed:\nabc1234 feat\(a\): one/)
})

test('excludeSpec drops secret paths from a diff and leaves it whole when there are none', () => {
  expect(excludeSpec(['src/a.ts', 'config/.env', 'k.pem'])).toEqual([
    '--',
    '.',
    ':(exclude,literal)config/.env',
    ':(exclude,literal)k.pem',
  ])
  expect(excludeSpec(['src/a.ts'])).toEqual([])
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

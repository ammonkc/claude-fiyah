import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { newestNote, noteDirOf, slugOf } from '../hooks/note'

const ROOT = '/work/Shop App'
const HOME = '/home/me'
const DIR = `${HOME}/.claude/handoffs/shop-app`
const NOW = new Date(2026, 9, 7, 13, 42).getTime()
const NOTE = [
  'Here is the note.',
  '## Goal',
  'Make checkout totals round half-cents up.',
  '## Status',
  'Fix written, tests pending.',
  '## What changed',
  '- `src/cart/total.ts`: banker rounding replaced.',
  '## Next steps',
  '1. Run `npm test -- total`.',
  '## Gotchas',
  'Currency API mocks are stale.',
  '## How to verify',
  '`npm test`',
].join('\n')
const PANE_PROPS = {
  title: 'Handoff',
  isFocused: false,
  bodyColumns: 90,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}
const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const handoff = (args = '') => ({
  command: 'handoff',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
})

type World = { forks: string[]; files: Map<string, string>; copies: string[]; fills: string[]; git: string[][] }
type Setup = { fork?: 'nothing'; repo?: boolean; existing?: Record<string, string> }

const world = (on: On, setup: Setup = {}): World => {
  const state: World = { forks: [], files: new Map(Object.entries(setup.existing ?? {})), copies: [], fills: [], git: [] }
  mock.clock(on, { now: NOW })
  on('process.run', (_$, e) => {
    state.git.push([...e.argv])
    const args = e.argv.slice(1).join(' ')
    const out = (stdout: string) => ({ value: { exitCode: setup.repo === false ? 128 : 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (args.startsWith('rev-parse')) return out('fix/rounding\n')
    if (args.startsWith('status')) return out(' M src/cart/total.ts\n?? notes.md\n')
    if (args.startsWith('diff')) return out(' src/cart/total.ts | 4 ++--\n 1 file changed\n')
    return out('a1b2c3d fix: rounding\n')
  })
  on('model.fork', (_$, e) => {
    state.forks.push(e.prompt)
    if (setup.fork === 'nothing') return { value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }
    return { value: { isAnswered: true as const, text: NOTE, usage: NO_USAGE } }
  })
  on('session.root', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'sess-123' }))
  mock.env(on, { HOME })
  on('fs.read', (_$, e) => (state.files.has(e.path) ? { value: state.files.get(e.path) ?? '' } : { deny: 'ENOENT' }))
  on('fs.exists', (_$, e) => ({ value: state.files.has(e.path) }))
  on('fs.list', (_$, e) => {
    const dir = `${e.path ?? ''}/`
    return {
      value: [...state.files.keys()]
        .filter(path => path.startsWith(dir) && !path.slice(dir.length).includes('/'))
        .map(path => ({ name: path.slice(dir.length), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
    }
  })
  on('fs.write', (_$, e) => {
    state.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.copy', (_$, e) => {
    state.copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.fill', (_$, e) => {
    state.fills.push(e.text)
    return { isFilled: true }
  })
  return state
}

test('/handoff writes the six sections to the project folder, copies and draws the note', async ($, on) => {
  const state = world(on)
  const ran = await $.command.run(handoff('stress the stale mocks'))
  expect(ran.text).toBe('Wrote ~/.claude/handoffs/shop-app/2026-10-07-1342.md and copied it to the clipboard.')

  expect(state.git.every(argv => argv[0] === 'git')).toBe(true)
  expect(state.forks[0]).toContain('Branch: fix/rounding')
  expect(state.forks[0]).toContain(' M src/cart/total.ts')
  expect(state.forks[0]).toContain('The author adds: stress the stale mocks')

  const saved = state.files.get(`${DIR}/2026-10-07-1342.md`) ?? ''
  for (const heading of ['Goal', 'Status', 'What changed', 'Next steps', 'Gotchas', 'How to verify']) expect(saved).toContain(`## ${heading}`)
  expect(saved.startsWith('# Handoff · 2026-10-07 13:42\n\nBranch `fix/rounding` · session `sess-123`\n\n## Goal')).toBe(true)
  expect(saved).not.toContain('Here is the note.')
  expect(saved).toContain('claude --resume sess-123')
  expect(state.copies).toEqual([saved])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'handoff', surface, component: 'Pane', requestId: 'handoff', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: 'Saved to ~/.claude/handoffs/shop-app/2026-10-07-1342.md' })).toBeDefined()
    await ui.press({ key: 'copy' })
    await ui.unmount()
  }
  expect(state.copies).toHaveLength(3)
})

test('a second note in the same minute gets its own file; outside git it still works', async ($, on) => {
  const state = world(on, { repo: false, existing: { [`${DIR}/2026-10-07-1342.md`]: 'old' } })
  const ran = await $.command.run(handoff())
  expect(ran.text).toContain('Wrote ~/.claude/handoffs/shop-app/2026-10-07-1342-2.md')
  expect(state.forks[0]).not.toContain('Repository facts')
  expect(state.files.get(`${DIR}/2026-10-07-1342`)).toBeUndefined()
  expect(state.files.get(`${DIR}/2026-10-07-1342-2.md`)).toContain('session `sess-123`')
})

test('when the fork cannot answer, no file is written, nothing is copied and the view reports the error', async ($, on) => {
  const state = world(on, { fork: 'nothing' })
  const ran = await $.command.run(handoff())
  expect(ran.text).toBe('Nothing to hand off yet: this conversation has no work in it.')
  expect([...state.files.keys()]).toEqual([])
  expect(state.copies).toEqual([])
  const ui = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', component: 'Pane', requestId: 'handoff', props: PANE_PROPS })
  expect(await ui.find({ type: 'Text', text: 'nothing to hand off yet: this conversation has no work in it.' })).toBeDefined()
  expect(await ui.find({ key: 'copy' })).toBeUndefined()
})

test('copy:false leaves the clipboard alone', { options: { copy: false } }, async ($, on) => {
  const state = world(on)
  const ran = await $.command.run(handoff())
  expect(ran.text).toBe('Wrote ~/.claude/handoffs/shop-app/2026-10-07-1342.md.')
  expect(state.copies).toEqual([])
})

test('/handoff resume fills the prompt with the newest note of this project only', async ($, on) => {
  const state = world(on, {
    existing: {
      [`${DIR}/2026-10-06-0900.md`]: 'older',
      [`${DIR}/2026-10-07-1342.md`]: 'same minute, first',
      [`${DIR}/2026-10-07-1342-2.md`]: 'same minute, second',
      [`${DIR}/2026-10-07-1342-10.md`]: 'same minute, tenth',
      [`${HOME}/.claude/handoffs/other/2026-12-01-0000.md`]: 'another project',
    },
  })
  const ran = await $.command.run(handoff('resume'))
  expect(ran.text).toContain('2026-10-07-1342-10.md')
  expect(state.fills).toEqual(['Continue from this handoff:\n\nsame minute, tenth\n'])
  expect(state.forks).toEqual([])
})

test('/handoff resume with no notes fills nothing', async ($, on) => {
  const state = world(on)
  const ran = await $.command.run(handoff('resume'))
  expect(ran.text).toContain('No handoff notes for this project yet')
  expect(state.fills).toEqual([])
})

test('folder setting: ~, absolute and relative bases each get the project slug', () => {
  expect(slugOf('/work/Shop App/')).toBe('shop-app')
  expect(noteDirOf({ setting: '', home: HOME, root: ROOT })).toBe(DIR)
  expect(noteDirOf({ setting: '~/notes/', home: HOME, root: ROOT })).toBe(`${HOME}/notes/shop-app`)
  expect(noteDirOf({ setting: '/srv/handoffs', home: undefined, root: ROOT })).toBe('/srv/handoffs/shop-app')
  expect(noteDirOf({ setting: 'docs/handoffs', home: HOME, root: ROOT })).toBe(`${ROOT}/docs/handoffs/shop-app`)
  expect(noteDirOf({ setting: '~/x', home: undefined, root: ROOT })).toBeUndefined()
  expect(newestNote(['a.md', '2026-01-01-0100.md', '2026-01-01-0100-3.md', '2026-01-01-0100-2.md'])).toBe('2026-01-01-0100-3.md')
})

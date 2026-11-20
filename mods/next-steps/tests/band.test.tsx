// Run with: claude plugin test mods/next-steps
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} }
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const LONG = 'I refactored the parser and updated the call sites. The tests in parser.test.ts still need a run.'

type Reply = string | 'fail' | 'hang'
type World = { forks: { prompt: string; effort?: string }[]; filled: string[]; suggested: string[] }

function world(on: On, reply: Reply, commands = [{ name: 'commit', description: 'Commit the changes', source: 'user' as const }]) {
  const clock = mock.clock(on)
  const state: World = { forks: [], filled: [], suggested: [] }
  on('ui.render', () => ({ type: 'Box', props: { key: 'engine' }, children: [] }))
  on('command.list', () => ({ value: commands }))
  on('prompt.fill', (_$, e) => (state.filled.push(e.text), { isFilled: true }))
  on('prompt.suggest', (_$, e) => (state.suggested.push(e.text), { isShown: true }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('model.fork', async (_$, e) => {
    state.forks.push({ prompt: e.prompt, effort: e.effort })
    if (reply === 'hang') return new Promise(() => {}) as never
    return reply === 'fail'
      ? { value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }
      : { value: { isAnswered: true as const, text: reply, usage: USAGE } }
  })
  return { clock, state }
}

const complete = ($: Engine, answer = LONG, agentId?: string) =>
  $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId: 'T1', reason: 'answer', ...(agentId ? { agentId } : {}) } as never)
const mount = ($: Engine) => $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

test('a long answer offers the fork suggestions as buttons, and the first one as ghost text', async ($, on) => {
  const { clock, state } = world(on, '[{"label":"Run parser tests","prompt":"Run the tests in parser.test.ts"},{"label":"Commit","prompt":"/commit the parser refactor"}]')
  await complete($)
  await clock.settle()
  const ui = await mount($)
  expect(await ui.find({ key: 'pick1' })).toBeDefined()
  expect(await ui.find({ key: 'pick2' })).toBeDefined()
  expect(state.suggested).toEqual(['Run the tests in parser.test.ts'])
  expect(state.forks[0]?.effort).toBe('low')
  expect(state.forks[0]?.prompt).toContain('/commit: Commit the changes')
})

test('pressing a suggestion fills the prompt box with its full prompt and hides the band; dismiss fills nothing', async ($, on) => {
  const { clock, state } = world(on, '[{"label":"Tests","prompt":"Run the tests in parser.test.ts"}]')
  await complete($)
  await clock.settle()
  await (await mount($)).press({ key: 'pick1' })
  await clock.settle()
  expect(state.filled).toEqual(['Run the tests in parser.test.ts'])
  expect(await (await mount($)).find({ key: 'pick1' })).toBeUndefined()

  await complete($)
  await clock.settle()
  await (await mount($)).press({ key: 'dismiss' })
  expect(state.filled).toHaveLength(1)
  expect(await (await mount($)).find({ key: 'pick1' })).toBeUndefined()
})

test('short answers and subagent turns never fork', async ($, on) => {
  const { clock, state } = world(on, '[{"label":"x","prompt":"x"}]')
  await complete($, 'Done.')
  await complete($, LONG, 'sub1')
  await clock.settle()
  expect(state.forks).toEqual([])
  expect(await (await mount($)).find({ text: 'next steps…' })).toBeUndefined()
})

test('a fork that never answers clears the loading line after the timeout', async ($, on) => {
  const { clock } = world(on, 'hang')
  await complete($)
  expect(await (await mount($)).find({ text: 'next steps…' })).toBeDefined()
  await clock.advance(30_000)
  await clock.settle()
  expect(await (await mount($)).find({ text: 'next steps…' })).toBeUndefined()
})

test('a failed fork shows nothing', async ($, on) => {
  const { clock, state } = world(on, 'fail')
  await complete($)
  await clock.settle()
  expect(await (await mount($)).find({ key: 'pick1' })).toBeUndefined()
  expect(state.suggested).toEqual([])
})

test('a new turn drops a suggestion that arrives late', async ($, on) => {
  const { clock } = world(on, '[{"label":"Tests","prompt":"Run the tests"}]')
  await complete($)
  await $.turn.start({ text: 'something else', turnId: 'T2' } as never)
  await clock.settle()
  expect(await (await mount($)).find({ key: 'pick1' })).toBeUndefined()
})

test('model output is cleaned: escapes and controls go, hidden tag text and unknown commands are refused, three at most', async ($, on) => {
  const tagged = 'Run it' + String.fromCodePoint(0xe0041, 0xe0042)
  const reply = JSON.stringify([
    { label: 'Esc', prompt: 'Run \u001b[31mthe\u001b[0m tests\u0007 now' },
    { label: 'Hidden', prompt: tagged },
    { label: 'Unknown', prompt: '/deploy-prod now' },
    { label: 'Known', prompt: '/commit the change' },
    { label: 'Three', prompt: 'Open a PR' },
    { label: 'Four', prompt: 'One too many' },
  ])
  const { clock, state } = world(on, reply)
  await complete($)
  await clock.settle()
  const ui = await mount($)
  for (const key of ['pick1', 'pick2', 'pick3']) expect(await ui.find({ key })).toBeDefined()
  expect(await ui.find({ key: 'pick4' })).toBeUndefined()
  await ui.press({ key: 'pick1' })
  expect(state.filled).toEqual(['Run the tests now'])
  await complete($)
  await clock.settle()
  await (await mount($)).press({ key: 'pick2' })
  expect(state.filled[1]).toBe('/commit the change')
})

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { focusOf, isOverThreshold } from '../hooks/focus'

const PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} }
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const HANDOFF = { name: 'handoff', description: '', source: 'user' as const }
const WINDOW = 1_000_000

const measure = (tokens: number) => ({ context: { tokens, window: WINDOW }, rateLimits: [], changed: ['context' as const] })

type World = { filled: string[]; forks: string[] }
type Setup = { commands?: (typeof HANDOFF)[]; fork?: string | 'fail'; view?: { status: 'idle' | 'writing' | 'ready' | 'error'; path: string; detail?: string } }

const world = (on: On, setup: Setup = {}): World => {
  const state: World = { filled: [], forks: [] }
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.render', () => ({ type: 'Box', props: { key: 'engine' }, children: [] }))
  on('command.list', () => ({ value: setup.commands ?? [HANDOFF] }))
  on('prompt.fill', (_$, e) => (state.filled.push(e.text), { isFilled: true }))
  on('model.fork', (_$, e) => {
    state.forks.push(e.prompt)
    return setup.fork === 'fail' || setup.fork === undefined
      ? { value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }
      : { value: { isAnswered: true as const, text: setup.fork, usage: USAGE } }
  })
  // The handoff mod's own value, as it would publish it; every other value takes the engine's own answer.
  on('state.get', (_$, e, next) =>
    e.plugin === 'handoff' && setup.view !== undefined
      ? { value: { value: { text: '', detail: '', isCopied: false, ...setup.view }, version: 1 } }
      : next(e),
  )
  return state
}

for (const surface of ['terminal', 'desktop'] as const) {
  const mount = ($: Engine) => $.ui.mount({ plugin: 'handoff-nudge', surface, component: 'AbovePrompt', props: PROPS })

  test(`${surface}: quiet below the threshold, shown past it, Hide re-arms after the context drops`, async ($, on) => {
    world(on)
    await $.session.measure(measure(590_000))
    expect(await (await mount($)).find({ key: 'handoff' })).toBeUndefined()

    await $.session.measure(measure(630_000))
    const shown = await mount($)
    expect(await shown.find({ type: 'Text', text: 'Context at 63%. Hand off? ' })).toBeDefined()
    await shown.press({ key: 'hide' })
    expect(await (await mount($)).find({ key: 'handoff' })).toBeUndefined()

    await $.session.measure(measure(100_000))
    await $.session.measure(measure(640_000))
    expect(await (await mount($)).find({ key: 'handoff' })).toBeDefined()
  })

  test(`${surface}: Handoff has the fork write a focus line and fills /handoff with it`, async ($, on) => {
    const state = world(on, { fork: '"Finish the mod install and run the tests"\nextra line' })
    await $.session.measure(measure(700_000))
    await (await mount($)).press({ key: 'handoff' })
    expect(state.forks).toHaveLength(1)
    expect(state.filled).toEqual(['/handoff Finish the mod install and run the tests'])
  })

  test(`${surface}: a fork that cannot answer still fills a plain /handoff`, async ($, on) => {
    const state = world(on, { fork: 'fail' })
    await $.session.measure(measure(700_000))
    await (await mount($)).press({ key: 'handoff' })
    expect(state.filled).toEqual(['/handoff'])
  })

  test(`${surface}: once the note is saved the band shows its path and Clear fills /clear`, async ($, on) => {
    const state = world(on, { view: { status: 'ready', path: '~/.claude/handoffs/shop/2026-10-07-1342.md' } })
    await $.session.measure(measure(700_000))
    const ui = await mount($)
    expect(await ui.find({ key: 'handoff' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Context at 70%. Saved to ~/.claude/handoffs/shop/2026-10-07-1342.md. ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Then run /handoff resume to continue from the note.' })).toBeDefined()
    await ui.press({ key: 'clear' })
    expect(state.filled).toEqual(['/clear'])
  })

  test(`${surface}: without the handoff mod the band is text only and fills nothing`, async ($, on) => {
    const state = world(on, { commands: [] })
    await $.session.measure(measure(700_000))
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /Install handoff@claude-fiyah/ })).toBeDefined()
    expect(await ui.find({ key: 'handoff' })).toBeUndefined()
    expect(await ui.find({ key: 'clear' })).toBeUndefined()
    expect(state.filled).toEqual([])
  })
}

test('an absolute token threshold replaces the percentage', { options: { thresholdTokens: 150_000 } }, async ($, on) => {
  world(on)
  await $.session.measure(measure(140_000))
  expect(await (await $.ui.mount({ plugin: 'handoff-nudge', surface: 'terminal', component: 'AbovePrompt', props: PROPS })).find({ key: 'handoff' })).toBeUndefined()
  await $.session.measure(measure(160_000))
  expect(await (await $.ui.mount({ plugin: 'handoff-nudge', surface: 'terminal', component: 'AbovePrompt', props: PROPS })).find({ key: 'handoff' })).toBeDefined()
})

test('threshold and focus helpers', () => {
  expect(isOverThreshold({ tokens: 600_000, window: WINDOW, thresholdPct: 60, thresholdTokens: 0 })).toBe(true)
  expect(isOverThreshold({ tokens: 599_999, window: WINDOW, thresholdPct: 60, thresholdTokens: 0 })).toBe(false)
  expect(isOverThreshold({ tokens: undefined, window: WINDOW, thresholdPct: 60, thresholdTokens: 0 })).toBe(false)
  expect((focusOf(Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ')) ?? '').split(' ')).toHaveLength(25)
  expect(focusOf('  \n')).toBeUndefined()
})

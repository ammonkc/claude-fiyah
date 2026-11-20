import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'effort-optimizer',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const STEP = { turnId: 't1', index: 0, model: 'sonnet', messageCount: 1 } as const

// Beneath the plugin: the judge answers `reply`, and every main or subagent request is recorded with the effort it carries.
function rig(on: On, reply: () => string | null) {
  const judged: string[] = []
  const efforts: Array<{ agentId?: string; effort: unknown }> = []
  on('model.complete', (_, e) => {
    judged.push(e.model)
    const text = reply()
    if (text === null) return { value: { isAnswered: false, reason: 'api-error', usage: {} } } as never
    return { value: { isAnswered: true, text, usage: {} } } as never
  })
  on('session.messages', () => ({ value: [] }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.step', async function* (_, e) {
    efforts.push({ agentId: e.agentId, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' } as never
  })
  return { judged, efforts }
}

async function drain(stream: AsyncGenerator<unknown, unknown>) {
  let r = await stream.next()
  while (!r.done) r = await stream.next()
  return r.value
}

const step = ($: any, effort: string, agentId?: string) => drain($.turn.step({ ...STEP, effort, ...(agentId ? { agentId } : {}) }))

async function submit($: any, text: string) {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

const pick = (level: string, confidence: number) => JSON.stringify({ level, confidence })

async function press($: any, key: string) {
  const ui = await $.ui.mount(BAND)
  await ui.press({ key })
  await ui.unmount()
}

async function heldText($: any) {
  const ui = await $.ui.mount(BAND)
  const text = (await ui.find({ type: 'Text', text: /Effort held/ }))?.text
  await ui.unmount()
  return text as string | undefined
}

async function bandText($: any) {
  const ui = await $.ui.mount(BAND)
  const text = (await ui.find({ type: 'Text', text: /Effort:/ }))?.text
  await ui.unmount()
  return text as string | undefined
}

test('the band appears only when the judge differs with enough confidence', async ($, on) => {
  let reply = pick('medium', 0.95)
  const clock = mock.clock(on)
  const { judged } = rig(on, () => reply)
  await step($, 'medium')

  // Same level as the chat: nothing.
  await submit($, 'Rewrite this paragraph so it reads friendlier')
  await clock.settle()
  expect(judged).toEqual(['haiku'])
  expect(await bandText($)).toBeUndefined()

  reply = pick('high', 0.9)
  await submit($, 'Please check every number in this contract against the three source sheets')
  await clock.settle()
  expect(judged).toHaveLength(2)
  expect(await bandText($)).toBe('● Effort: medium to high suggested (costs one cache miss)')
})

test('a low confidence pick shows nothing', async ($, on) => {
  const clock = mock.clock(on)
  rig(on, () => pick('xhigh', 0.3))
  await step($, 'medium')
  await submit($, 'Review this fifty page agreement before I sign it tonight')
  await clock.settle()
  expect(await bandText($)).toBeUndefined()
})

test('a one step decrease is suppressed, a bigger one is not', async ($, on) => {
  const clock = mock.clock(on)
  let reply = pick('medium', 0.9)
  rig(on, () => reply)
  await step($, 'high')
  await submit($, 'Summarise the meeting notes with next steps please')
  await clock.settle()
  expect(await bandText($)).toBeUndefined()

  reply = pick('low', 0.9)
  await submit($, 'Brainstorm ten names for the newsletter please')
  await clock.settle()
  expect(await bandText($)).toBe('● Effort: high to low suggested (costs one cache miss)')
})

test('Apply puts the new effort on main requests only, and a person change releases it', async ($, on) => {
  const clock = mock.clock(on)
  const { efforts } = rig(on, () => pick('high', 0.9))
  await step($, 'medium')
  await submit($, 'Why did churn go up last quarter? Dig into the numbers')
  await clock.settle()
  await press($, 'apply')
  expect(await bandText($)).toBeUndefined()

  expect(await heldText($)).toBe('Effort held at high by effort-optimizer')
  efforts.length = 0
  await step($, 'medium')
  await step($, 'medium', 'agent-1')
  expect(efforts).toEqual([{ agentId: undefined, effort: 'high' }, { agentId: 'agent-1', effort: 'medium' }])

  // The person moves the picker to low: the override goes and low is used as asked.
  efforts.length = 0
  await step($, 'low')
  await step($, 'low')
  expect(efforts).toEqual([{ agentId: undefined, effort: 'low' }, { agentId: undefined, effort: 'low' }])
  expect(await heldText($)).toBeUndefined()
})

test('Dismiss clears the band and the cooldown holds the judge back', async ($, on) => {
  const clock = mock.clock(on)
  const { judged } = rig(on, () => pick('high', 0.9))
  await step($, 'medium')
  await submit($, 'Fact check the claims in this report before it goes out')
  await clock.settle()
  await press($, 'dismiss')
  expect(await bandText($)).toBeUndefined()
  expect(judged).toHaveLength(1)

  await submit($, 'Fact check the second report before it goes out')
  await submit($, 'Fact check the third report before it goes out')
  await clock.settle()
  expect(judged).toHaveLength(1)
  expect(await bandText($)).toBeUndefined()

  await submit($, 'Fact check the fourth report before it goes out')
  await clock.settle()
  expect(judged).toHaveLength(2)
  expect(await bandText($)).toBeDefined()
})

test('a failed judge shows nothing', async ($, on) => {
  const clock = mock.clock(on)
  rig(on, () => null)
  await step($, 'medium')
  await submit($, 'Review this fifty page agreement before I sign it tonight')
  await clock.settle()
  expect(await bandText($)).toBeUndefined()
})

test('prompts that are commands or acknowledgements are never judged', async ($, on) => {
  const clock = mock.clock(on)
  const { judged } = rig(on, () => pick('high', 0.9))
  await step($, 'medium')
  for (const text of ['/compact', '!ls -la src', '# remember to use pnpm', 'ok', 'yes, go']) await submit($, text)
  await clock.settle()
  expect(judged).toEqual([])
})

test('auto mode applies the level without a band', { options: { mode: 'auto' } }, async ($, on) => {
  const clock = mock.clock(on)
  const { efforts } = rig(on, () => pick('high', 0.9))
  await step($, 'medium')
  await submit($, 'Why did churn go up last quarter? Dig into the numbers')
  await clock.settle()
  expect(await bandText($)).toBeUndefined()
  efforts.length = 0
  await step($, 'medium')
  expect(efforts).toEqual([{ agentId: undefined, effort: 'high' }])
})

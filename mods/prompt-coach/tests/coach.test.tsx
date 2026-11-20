import { expect, mock, test } from 'claude-code/testing'

const ok = (value: unknown) => ({ value }) as never

test('a reviewer that does not answer toasts once, and the prompts still go through', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, {})
  const toasts: string[] = []
  let calls = 0
  on('model.complete', async () => {
    calls++
    return ok({ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: {} })
  })
  on('session.messages', async () => ok([]))
  on('session.root', async () => ok('/repo'))
  on('command.register', async ($$, e) => ok({ command: e.name }))
  on('ui.status', async () => ok(undefined))
  on('ui.toast', async ($$, e) => {
    toasts.push(e.text)
    return ok(undefined)
  })
  on('prompt.submit', async ($$, e) => ({ text: e.text }))
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.submit({ text: 'please make the thing better somehow', origin: { kind: 'composer' }, wait: false } as never)
  await $.prompt.submit({ text: 'and also tidy up the other thing please', origin: { kind: 'composer' }, wait: false } as never)
  expect(calls).toBe(2)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('api-error')
})

test('a prompt that prompt-drafts would save is never reviewed', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, {})
  let calls = 0
  on('model.complete', async () => {
    calls++
    return ok({ isAnswered: true, text: '{"verdict":"fine"}', usage: {} })
  })
  on('session.messages', async () => ok([]))
  on('session.root', async () => ok('/repo'))
  on('command.register', async ($$, e) => ok({ command: e.name }))
  on('ui.status', async () => ok(undefined))
  on('prompt.submit', async ($$, e) => ({ text: e.text }))
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.prompt.submit({ text: 'write the release notes for this version ;;', origin: { kind: 'composer' }, wait: false } as never)
  expect(calls).toBe(0)
  await $.prompt.submit({ text: 'write the release notes for this version', origin: { kind: 'composer' }, wait: false } as never)
  expect(calls).toBe(1)
})

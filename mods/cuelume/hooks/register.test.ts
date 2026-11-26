import { expect, mock, test } from 'claude-code/testing'

import { parseChoice, readNumber, settle } from './register'

const turn = { answer: 'done', isAborted: false, turnId: 't', reason: 'answer' } as const

test('reads a theme, off, and nothing else', () => {
  expect(parseChoice(' Mech ')).toBe('mech')
  expect(parseChoice('off')).toBe('off')
  expect(parseChoice('')).toBe(undefined)
  expect(parseChoice('loud')).toBe(undefined)
})

test('rings in the chosen theme, and not at all when off', async ($, on) => {
  const played: string[] = []
  mock.store(on)
  on('audio.play', (_: unknown, e: any) => {
    played.push(`${e.clip.asset} x${e.gain}`)
    return { value: null }
  })
  on('command.register', (_, e) => ({ command: e.name }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.SessionStart', () => ({}))

  await $.turn.complete({ ...turn, durationMs: 2_000 })
  await $.turn.complete({ ...turn, durationMs: 60_000, agentId: 'sub' })
  expect(played).toEqual([])

  await $.turn.complete({ ...turn, durationMs: 60_000 })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  expect(played).toEqual(['sounds/default/ready.wav x1.4', 'sounds/default/attention.wav x1.4'])

  const switched = await $.command.run({ command: 'cuelume', args: 'bubble' })
  expect(switched.text).toBe('cuelume: bubble.')
  await $.turn.complete({ ...turn, durationMs: 60_000 })
  expect(played.slice(2)).toEqual(['sounds/bubble/ready.wav x1.4', 'sounds/bubble/ready.wav x1.4'])

  await $.command.run({ command: 'cuelume', args: 'off' })
  await $.turn.complete({ ...turn, durationMs: 60_000 })
  expect(played.length).toBe(4)
})

const harness = (on: any, played: string[]) => {
  mock.store(on)
  on('audio.play', (_: unknown, e: any) => {
    played.push(`${e.clip.asset} x${e.gain}`)
    return { value: null }
  })
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('classic.PermissionRequest', () => ({}))
}

test('each cue can be switched off on its own', { options: { readyEnabled: false } }, async ($, on) => {
  const played: string[] = []
  harness(on, played)

  await $.turn.complete({ ...turn, durationMs: 60_000 })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  expect(played).toEqual(['sounds/default/attention.wav x1.4'])
})

test('attention can be switched off while ready still rings', { options: { attentionEnabled: false } }, async ($, on) => {
  const played: string[] = []
  harness(on, played)

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  await $.turn.complete({ ...turn, durationMs: 60_000 })
  expect(played).toEqual(['sounds/default/ready.wav x1.4'])
})

test('minSeconds and gain move the threshold and the volume', { options: { minSeconds: 3, gain: 2 } }, async ($, on) => {
  const played: string[] = []
  harness(on, played)

  await $.turn.complete({ ...turn, durationMs: 2_000 })
  await $.turn.complete({ ...turn, durationMs: 4_000 })
  expect(played).toEqual(['sounds/default/ready.wav x2'])
})

test('a bad number falls back to its default', () => {
  expect(readNumber('loud', 1.4, 0.1, 3)).toBe(1.4)
  expect(readNumber(99, 1.4, 0.1, 3)).toBe(1.4)
  expect(readNumber('2', 1.4, 0.1, 3)).toBe(2)
})

test('a cue that never finishes is dropped at the timeout, a finished one is awaited', async () => {
  const never = new Promise<void>(() => {})
  await settle(() => Promise.resolve(), never)

  let done = false
  const finishing = Promise.resolve().then(() => void (done = true))
  await settle(() => never, finishing)
  expect(done).toBe(true)
})

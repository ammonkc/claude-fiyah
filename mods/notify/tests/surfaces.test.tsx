import { expect, mock, test } from 'claude-code/testing'

// The pane draws on every surface, wide and narrow, with the shared header (docs/design.md).
test('notify pane draws on every surface', async $ => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const bodyColumns of [30, 90]) {
      const ui = await $.ui.mount({
        plugin: 'notify',
        surface,
        component: 'Pane',
        requestId: 'notify',
        props: { title: 'notify', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
        viewport: { columns: bodyColumns, rows: 40 },
      })
      expect(await ui.find({ type: 'Text', text: 'notify' })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('an unanswered permission request pings once; a finished tool cancels the ping', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  mock.env(on, {})
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('process.run', async () => ({ value: { stdout: 'Darwin', stderr: '', exitCode: 0 } }) as never)
  for (const name of ['classic.PermissionRequest', 'classic.PostToolUse'] as const) on(name, async () => ({}) as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} } as never)
  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: '', tool_use_id: 't1' } as never)
  await clock.advance(60_000)
  expect(toasts).toEqual([])
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} } as never)
  await clock.advance(60_000)
  expect(toasts.filter(t => t.includes('Waiting for your approval'))).toHaveLength(1)
})

test('a parallel call of the same tool finishing does not cancel a waiting approval ping', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, {})
  mock.env(on, {})
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('process.run', async () => ({ value: { stdout: 'Darwin', stderr: '', exitCode: 0 } }) as never)
  for (const name of ['classic.PermissionRequest', 'classic.PostToolUse'] as const) on(name, async () => ({}) as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } } as never)
  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: '', tool_use_id: 't2' } as never)
  await clock.advance(60_000)
  expect(toasts.filter(t => t.includes('Waiting for your approval'))).toHaveLength(1)
})

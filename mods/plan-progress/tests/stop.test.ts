// Run with: claude plugin test mods/plan-progress
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const TOOL = 'mcp__plan-progress__plan_progress'

/** The engine beneath the mod: what its session.start asks for, answered with nothing in it. */
function beneath($: Engine, on: On) {
  mock.clock(on)
  mock.env(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: { name: 'plan_progress' } }) as never)
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.id', () => ({ value: 's1' }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('tool.list', () => ({ value: [{ name: TOOL }] }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.run', () => ({ result: 'ok' }) as never)
  on('classic.PostToolUse', () => ({}))
  on('classic.Stop', () => ({}))
}

/** One turn that edits a file, then stops: what Stop answers. */
async function turn($: Engine, turnId: string) {
  await $.turn.start({ text: 'go', turnId } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts', old_string: 'a', new_string: 'b' } as never)
  await $.classic.PostToolUse({ tool_name: 'Edit', tool_input: { file_path: '/a.ts' }, tool_response: {}, tool_use_id: `u-${turnId}` } as never)
  return () => $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.', background_tasks: [] } as never)
}

test('an open bar sends a turn back once, and the next turn again', async ($, on) => {
  beneath($, on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: TOOL, id: 'work', title: 'Work', stages: [{ name: 'A', steps: [{ title: 'One' }, { title: 'Two' }] }] } as never)

  const first = await turn($, 'a')
  expect((await first()).block).toContain('work still open')
  // a second Stop of the same turn (a wake, a hook that ran twice) lets it go
  expect((await first()).block).toBeUndefined()

  const next = await turn($, 'b')
  expect((await next()).block).toContain('work still open')
})

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { HandoffNudgeSuggestion } from '../types'
import { FOCUS_PROMPT, focusOf, isOverThreshold, percentOf } from './focus'

const IDLE: HandoffNudgeSuggestion = { status: 'idle' }
const HANDOFF_VIEW = { plugin: 'handoff', key: 'view' } as const

const percent = atom({ plugin: 'handoff-nudge', key: 'percent' } as const, null)
const isOver = atom({ plugin: 'handoff-nudge', key: 'isOver' } as const, false)
const isHidden = atom({ plugin: 'handoff-nudge', key: 'isHidden' } as const, false)
const suggestion = atom({ plugin: 'handoff-nudge', key: 'suggestion' } as const, IDLE)
const hasHandoff = atom({ plugin: 'handoff-nudge', key: 'hasHandoff' } as const, true)
// When usage last crossed up over the threshold, and when this mod first saw the handoff note it shows (by its path).
// The handoff view has no time of its own, so a note seen before the latest crossing is a note of the earlier stretch.
const crossedAt = atom({ plugin: 'handoff-nudge', key: 'crossedAt' } as const, 0)
const noteSeen = atom({ plugin: 'handoff-nudge', key: 'noteSeen' } as const, null as { path: string; at: number } | null)

const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

export const register: Register = (on, options) => {
  const thresholdPct = num(options.thresholdPct, 60)
  const thresholdTokens = num(options.thresholdTokens, 0)

  // Whether a /handoff command exists, asked once and kept: the command list does not change under a session.
  let commandChecked = false

  on('session.measure', async ($, e, next) => {
    const { tokens, window } = e.context
    const over = isOverThreshold({ tokens, window, thresholdPct, thresholdTokens })
    const wasOver = await read($, isOver)
    await update($, percent, () => percentOf(tokens, window))

    // Note the handoff note on first sight, before the crossing is stamped, so an old note is older than the crossing.
    const now = await $.clock.now()
    const { value: view } = await $.state.get(HANDOFF_VIEW)
    if (view?.status === 'ready' && (await read($, noteSeen))?.path !== view.path) await update($, noteSeen, () => ({ path: view.path, at: now }))
    if (over && !wasOver) await update($, crossedAt, () => now)
    await update($, isOver, () => over)

    if (over) {
      if (!commandChecked) {
        const found = (await $.command.list()).some(c => c.name === 'handoff' || c.name.endsWith(':handoff'))
        await update($, hasHandoff, () => found)
        commandChecked = true
      }
    } else {
      // Re-arm once the context drops back under the threshold (after /compact or /clear).
      await update($, isHidden, () => false)
      await update($, suggestion, () => IDLE)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOver)) || (await read($, isHidden))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const hide = <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
    const used = await read($, percent)
    const head = `Context at ${used ?? '?'}%.`

    // Text only: this band never fills an install command.
    if (!(await read($, hasHandoff))) {
      return (
        <Box>
          <Text color="warning">{`${head} Install handoff@claude-fiyah to hand off. `}</Text>
          {hide}
        </Box>
      )
    }

    const { value: shownView } = await $.state.get(HANDOFF_VIEW)
    // A note this mod saw before usage last crossed up is from an earlier stretch: offer a new handoff instead.
    const seen = await read($, noteSeen)
    const crossed = await read($, crossedAt)
    const isStale = shownView?.status === 'ready' && seen?.path === shownView.path && seen.at < crossed
    const view = isStale ? undefined : shownView
    if (view?.status === 'ready') {
      return (
        <Box flexDirection="column">
          <Box>
            <Text color="warning">{`${head} Saved to ${view.path}. `}</Text>
            <Button key="clear" label="Clear" onPress={() => $.prompt.fill({ text: '/clear' })} />
            {hide}
          </Box>
          <Text dimColor>Then run /handoff resume to continue from the note.</Text>
        </Box>
      )
    }
    if (view?.status === 'writing') {
      return (
        <Box>
          <Text color="warning">{`${head} Writing the handoff note… `}</Text>
          {hide}
        </Box>
      )
    }

    const s = await read($, suggestion)
    const handoff = async () => {
      await update($, suggestion, () => ({ status: 'loading' }))
      let focus: string | undefined
      let reason = 'no reply'
      try {
        const reply = await $.model.fork({ prompt: FOCUS_PROMPT })
        if (reply.isAnswered) focus = focusOf(reply.text)
        else reason = reply.reason
      } catch (error) {
        reason = error instanceof Error ? error.message : 'the fork failed'
      }
      const result: HandoffNudgeSuggestion = focus === undefined ? { status: 'failed', reason } : { status: 'ready', focus }
      await update($, suggestion, () => result)
      await $.prompt.fill({ text: focus === undefined ? '/handoff' : `/handoff ${focus}` })
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Text color="warning">{`${head} Hand off? `}</Text>
          <Button
            key="handoff"
            label={s.status === 'loading' ? 'Suggesting…' : 'Handoff'}
            onPress={() => (s.status === 'loading' ? undefined : handoff())}
          />
          {hide}
        </Box>
        {view?.status === 'error' && <Text dimColor>{`Last handoff failed: ${view.detail}`}</Text>}
        {s.status === 'ready' && <Text dimColor>{`Suggested focus: ${s.focus}`}</Text>}
        {s.status === 'failed' && <Text dimColor>{`No focus suggested (${s.reason}); filled /handoff.`}</Text>}
      </Box>
    )
  })
}

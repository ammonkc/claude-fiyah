// Keeps a Pane drawing from going blank: a Pane hook that throws leaves the engine's own (empty) drawing, so the
// hook's `.catch` draws this card with Retry instead. Trimmed from Plagemes/claude-mods shared/render-safe.ts (MIT).
import type { Elements, HookFailure, RenderElement } from 'claude-code'

type PaneTable = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export function paneFailure(
  t: PaneTable,
  input: { title: string; failure: Pick<HookFailure, 'kind' | 'message'>; onRetry: () => void },
): RenderElement {
  const { Box, Text, Button } = t
  const why = input.failure.kind === 'timeout' ? 'took too long to draw' : 'could not draw'
  const detail = (input.failure.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
  return Box({
    key: 'pane-failure',
    flexDirection: 'column',
    children: [
      Text({ bold: true, color: 'error', children: [`${input.title} ${why} this view`] }),
      ...(detail === '' ? [] : [Text({ dimColor: true, wrap: 'wrap', children: [detail] })]),
      Box({ flexDirection: 'row', children: [Button({ key: 'pane-retry', label: 'Retry', onPress: input.onRetry })] }),
    ],
  })
}

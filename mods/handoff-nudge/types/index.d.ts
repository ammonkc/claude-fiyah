/** The fork's focus suggestion: idle, running, a focus line for /handoff, or why there is none. */
export type HandoffNudgeSuggestion =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; focus: string }
  | { status: 'failed'; reason: string }

/** The handoff mod's published state (mods/handoff), read here to follow a handoff's progress. */
export type HandoffNudgeHandoffView = {
  status: 'idle' | 'writing' | 'ready' | 'error'
  path: string
  text: string
  detail: string
  isCopied: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'handoff-nudge': {
      /** Share of the context window in use, 0 to 100, or null before the first measurement. */
      percent: number | null
      /** Whether the usage is at or past the threshold. */
      isOver: boolean
      isHidden: boolean
      suggestion: HandoffNudgeSuggestion
      /** Whether a /handoff command is installed. */
      hasHandoff: boolean
      /** When usage last crossed up over the threshold (ms), 0 before the first time. */
      crossedAt: number
      /** The handoff note this mod saw first, by its path, and when; a note seen before the last crossing is stale. */
      noteSeen: { path: string; at: number } | null
    }
    handoff: { view: HandoffNudgeHandoffView }
  }
}

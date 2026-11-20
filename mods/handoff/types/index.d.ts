export type HandoffView = {
  status: 'idle' | 'writing' | 'ready' | 'error'
  /** Where the note was saved (with the home folder shown as `~`); empty until it is. */
  path: string
  /** The note as saved; empty until it is. */
  text: string
  /** Progress, the error, or a warning about missing sections. */
  detail: string
  /** Whether the note was put on the clipboard. */
  isCopied: boolean
}

declare module 'claude-code' {
  interface PluginState {
    handoff: { view: HandoffView }
  }
}

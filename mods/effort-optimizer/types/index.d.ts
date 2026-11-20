export type Level = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type Band = {
  /** Changes with every suggestion, so a stale press is ignored. */
  id: number
  /** The level the chat runs at now. */
  from: Level
  /** The level the judge picked. */
  to: Level
}

declare module 'claude-code' {
  interface PluginState {
    'effort-optimizer': {
      band: Band | null
      /** The level put on every main-chat request until the person changes effort themselves. */
      override: Level | null
    }
  }
}

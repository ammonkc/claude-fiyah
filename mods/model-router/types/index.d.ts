export type ModelRouterPick = {
  /** Milliseconds since the epoch. */
  at: number
  agentType: string
  /** The model the spawn would have run on. */
  from: string
  /** The model it was moved to, or null when it was kept. */
  to: string | null
  /** Why: the policy line, "kept (explicit)", "skipped (fork)" and so on. */
  reason: string
}

export type ModelRouterEnv = {
  /** Whether the environment has been read yet. */
  isLoaded: boolean
  /** Model id (an ARN on Bedrock) to the tier it stands for: fast, balanced or deep. */
  tiers: Record<string, 'fast' | 'balanced' | 'deep'>
  /** CLAUDE_CODE_SUBAGENT_MODEL, which the engine applies over any hook; empty when unset. */
  subagentModel: string
}

declare module 'claude-code' {
  interface PluginState {
    'model-router': {
      picks: ModelRouterPick[]
      env: ModelRouterEnv
    }
  }
}

export type Group = { message: string; files: string[] }
export type OutputKind = 'commit' | 'pr' | 'review' | 'done' | 'error' | 'info'
export type Output = { title: string; text: string; kind: OutputKind; copy?: string }

declare module 'claude-code' {
  interface PluginState {
    'git-actions': {
      visible: boolean
      busy: string | null
      output: Output | null
      groups: Group[] | null
      groupsKey: string
      prDesc: string | null
      prKey: string
      dirty: number
      ahead: number
      branch: string
      prUrl: string
    }
  }
}

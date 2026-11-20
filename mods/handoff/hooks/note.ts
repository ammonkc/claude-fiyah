// Pure parts of the handoff: the request to the fork, the note itself, and where notes live. No `$` here.
// Ported by hand from Plagemes/claude-mods (MIT), see the README.

export type GitFacts = { branch: string; status: string; diffStat: string; commits: string }

export const SECTIONS = ['Goal', 'Status', 'What changed', 'Next steps', 'Gotchas', 'How to verify'] as const

export const DEFAULT_DIR = '~/.claude/handoffs'

const pad = (n: number): string => String(n).padStart(2, '0')

/** `2026-10-07-1342`, in the session's local time. */
export const stampOf = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** `2026-10-07 13:42` */
export const readableStamp = (ms: number): string => stampOf(ms).replace(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})$/, '$1 $2:$3')

/** A folder name for the project: the last part of its root, lowercase, safe in a path. */
export const slugOf = (root: string): string => {
  const last = root.replace(/\/+$/, '').split('/').pop() ?? ''
  return last.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'project'
}

/** The folder this project's notes go in: the base setting (`~/` is home, relative is under the project root) plus the project's slug. */
export const noteDirOf = (input: { setting: string; home: string | undefined; root: string }): string | undefined => {
  const setting = input.setting.trim() === '' ? DEFAULT_DIR : input.setting.trim()
  let base: string
  if (setting === '~' || setting.startsWith('~/')) {
    if (input.home === undefined || input.home === '') return undefined
    base = `${input.home.replace(/\/+$/, '')}${setting.slice(1)}`
  } else if (setting.startsWith('/')) {
    base = setting
  } else {
    base = `${input.root.replace(/\/+$/, '')}/${setting.replace(/^\.\//, '')}`
  }
  return `${base.replace(/\/+$/, '')}/${slugOf(input.root)}`
}

/** A path with the home folder shown as `~`. */
export const shortPath = (path: string, home: string | undefined): string =>
  home !== undefined && home !== '' && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path

const NOTE_FILE = /^(\d{4}-\d{2}-\d{2}-\d{4})(?:-(\d+))?\.md$/

/** The newest note file name in a folder listing, by its stamp and then its collision suffix; undefined when there is none. */
export const newestNote = (names: readonly string[]): string | undefined => {
  const notes = names
    .map(name => ({ name, match: NOTE_FILE.exec(name) }))
    .filter((one): one is { name: string; match: RegExpExecArray } => one.match !== null)
    .map(({ name, match }) => ({ name, stamp: match[1] ?? '', n: Number(match[2] ?? 1) }))
  notes.sort((a, b) => (a.stamp === b.stamp ? a.n - b.n : a.stamp < b.stamp ? -1 : 1))
  return notes.at(-1)?.name
}

export const handoffPrompt = (facts: GitFacts | undefined, note: string): string =>
  [
    'Write a handoff note so a teammate can pick up exactly where this session leaves off.',
    'Be specific and factual: real file paths, commands, decisions and the reasons for them. No filler, no',
    'mention of "this conversation" or of the assistant. Write TODO where you do not know something.',
    ...(note === '' ? [] : ['', `The author adds: ${note}`]),
    ...(facts === undefined
      ? []
      : [
          '',
          'Repository facts from git, accurate right now:',
          `Branch: ${facts.branch}`,
          'Uncommitted changes:',
          facts.status === '' ? '(none)' : facts.status,
          ...(facts.diffStat === '' ? [] : ['Diff stat:', facts.diffStat]),
          'Recent commits:',
          facts.commits === '' ? '(none)' : facts.commits,
        ]),
    '',
    'Answer in Markdown with exactly these sections, in this order, and nothing before the first:',
    '## Goal',
    '(what we are trying to achieve, and why)',
    '## Status',
    '(done, in progress, not started)',
    '## What changed',
    '(each file touched and what changed in it)',
    '## Next steps',
    '(numbered, in the order to do them)',
    '## Gotchas',
    '(traps, open questions, things that look wrong but are intended)',
    '## How to verify',
    '(commands to run and what to check)',
  ].join('\n')

/** Keeps the reply from its first `## ` heading on, so chatter before it is dropped. */
export const sectionsOf = (reply: string): string => {
  const at = reply.search(/^##\s/m)
  return (at === -1 ? reply : reply.slice(at)).trim()
}

export const composeNote = (sections: string, meta: { when: number; branch?: string; sessionId?: string }): string =>
  [
    `# Handoff · ${readableStamp(meta.when)}`,
    '',
    [meta.branch === undefined ? undefined : `Branch \`${meta.branch}\``, meta.sessionId === undefined ? undefined : `session \`${meta.sessionId}\``]
      .filter(Boolean)
      .join(' · '),
    '',
    sections,
    '',
    ...(meta.sessionId === undefined ? [] : ['---', `Resume the original session on its machine: \`claude --resume ${meta.sessionId}\``, '']),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')

/** Which of the six sections the note lacks. */
export const missingSections = (sections: string): string[] =>
  SECTIONS.filter(name => !new RegExp(`^##\\s+${name}\\b`, 'im').test(sections))

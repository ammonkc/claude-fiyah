// Host-independent note formatting; bundled into the Codex package.
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const slugify = (title: string): string =>
  title.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s-]/g, '').replace(/\s/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'unnamed-report'

export const parseFrontmatter = (text: string): { fm: Record<string, string>; body: string } => {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)/.exec(text)
  if (!m) return { fm: {}, body: text }
  const fm: Record<string, string> = {}
  for (const line of m[1]!.split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { fm, body: m[2]! }
}

export const firstHeading = (text: string): string => {
  for (const raw of text.split('\n')) {
    const m = /^#+\s+(.+)/.exec(raw.trim())
    if (m) return m[1]!.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim()
  }
  return 'Unnamed'
}

export const inlineFields = (text: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = /^\*\*([^*]+):\*\*\s*(.*)/.exec(line.trim())
    if (m && m[2]!.trim()) out[m[1]!.trim().toLowerCase().replace(/ /g, '_')] = m[2]!.trim()
  }
  return out
}

export const fallbackSummary = (text: string, empty = 'Captured from Claude Code superpowers.'): string => {
  const t = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/^\|.*\|$/gm, ' ')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
    .trimEnd()
  return t ? (t.length === 200 ? `${t}...` : t) : empty
}

const GENERIC_HEADINGS = new Set(['context', 'background', 'overview', 'summary', 'plan', 'approach', 'implementation', 'verification', 'notes', 'steps', 'goal', 'goals', 'problem', 'solution', 'description', 'objective', 'scope'])
const STOP_WORDS = new Set(['a', 'an', 'the', 'with', 'and', 'of', 'for', 'to'])

export const planTitle = (content: string): string => {
  for (const raw of content.split('\n')) {
    let line = raw.trim()
    if (!line) continue
    line = line.replace(/^#+\s*/, '').replace(/^plan:\s*/i, '').replace(/\s+/g, ' ').trim()
    if (GENERIC_HEADINGS.has(line.toLowerCase())) continue
    if (line) return line.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim() || 'Unnamed Plan'
  }
  return 'Unnamed Plan'
}

export const planSlug = (title: string): string => {
  let slug = title.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  const words = slug.split('-').filter(Boolean)
  if (words.length > 6) {
    slug = words.filter((w, i) => !(STOP_WORDS.has(w) && i !== 0 && i !== words.length - 1)).join('-') || slug
  }
  if (slug.length > 80) {
    const kept: string[] = []
    let total = 0
    for (const part of slug.split('-')) {
      const extra = part.length + (kept.length ? 1 : 0)
      if (total + extra > 80) break
      kept.push(part)
      total += extra
    }
    slug = kept.join('-') || slug
  }
  return slug || 'unnamed-plan'
}

export const withStatus = (note: string, status: string): string => note.replace(/^status: .*$/m, `status: ${status}`)

export const mergeTags = (content: string, newTags: string[]): string => {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)/.exec(content)
  const block = (tags: string[]) => `tags:\n${tags.map(t => `  - ${t}\n`).join('')}`
  if (!m) return `---\n${block(newTags)}---\n${content}`
  const fm = m[1]!
  const tm = /^tags:\n((?:  - .+\n)*)/m.exec(`${fm}\n`)
  const existing = tm ? [...tm[1]!.matchAll(/  - (.+)/g)].map(x => x[1]!) : []
  const merged = [...new Set([...existing, ...newTags])]
  const newFm = tm ? `${fm}\n`.slice(0, tm.index) + block(merged) + `${fm}\n`.slice(tm.index + tm[0].length) : `${fm}\n${block(merged).trimEnd()}`
  return `---\n${newFm.replace(/\n+$/, '')}\n---\n${m[2]!}`
}

export const upsertEntry = (journal: string, notePath: string, title: string, label: string, summary: string): string => {
  const marker = `- [[${notePath}|`
  const lines = journal.split('\n')
  const i = lines.findIndex(l => l.startsWith(marker))
  if (i === -1) return `${journal}${entryLine(notePath, title, label, summary)}`
  lines[i] = lines[i]!.replace(/\([^()]*\)\s*$/, `(${label})`)
  return lines.join('\n')
}

const PLAN_START = '<!-- plan:start -->'
const PLAN_END = '<!-- plan:end -->'

export const planSection = (content: string): string => `## Plan\n\n${PLAN_START}\n${content}\n${PLAN_END}\n`

// Swaps only the captured plan text. Markers bound it; notes captured before markers existed end at "## Conversation" or EOF.
export const replacePlanSection = (note: string, content: string): string => {
  const a = note.indexOf(PLAN_START)
  const b = note.indexOf(PLAN_END)
  if (a !== -1 && b > a) return `${note.slice(0, a)}${PLAN_START}\n${content}\n${note.slice(b)}`
  const h = note.indexOf('\n## Plan\n')
  if (h === -1) return `${note.replace(/\n*$/, '\n')}\n${planSection(content)}`
  const c = note.indexOf('\n## Conversation', h)
  const tail = c === -1 ? '' : note.slice(c)
  return `${note.slice(0, h + 1)}${planSection(content)}${tail ? `\n${tail.replace(/^\n/, '')}` : ''}`
}

export const loggedInLink = (note: string): string | undefined => /## Logged In\n\[\[([^\]|]+)\]\]/.exec(note)?.[1]

export const implementationPromptPath = (notePath: string): string =>
  `Projects/Engineering/Prompts/implement-plan-${notePath.split('/').pop()}`

export const linkImplementationPrompt = (note: string, promptPath: string): string => {
  const link = `[[${promptPath}|Implementation prompt]]`
  if (note.includes(link)) return note
  // Keep the link outside the replaceable plan section, including on legacy notes.
  const section = `## Implementation Prompt\n${link}\n\n`
  const heading = /^## Plan\n/m.exec(note)
  return heading ? `${note.slice(0, heading.index)}${section}${note.slice(heading.index)}` : `${note.trimEnd()}\n\n${section}`
}

export const implementationPromptNote = (notePath: string, title: string, sourceFile: string, created: string, session: string): string =>
  `---\ncreated: ${created}\ntags:\n  - prompt\n  - implementation-prompt\n  - plan\n  - claude-session\nsource: Claude Code (Implementation Prompt)\nsession: ${session}\nsource_file: ${sourceFile}\nplan_note: ${JSON.stringify(`[[${notePath}]]`)}\n---\n\n# Implement Plan: ${title}\n\n## Plan\n[[${notePath}|${title}]]\n\n## Prompt\n\nImplement the plan "${title}".\n\nRead the original plan source_file at this exact path:\n${sourceFile}\n\nIf the source file is unavailable, use the captured plan in the Obsidian note "${notePath}". If neither is accessible, ask for the plan before proceeding.\n\nIdentify the repository referenced by the plan and work from its root. Read its project instructions and inspect the current code before making changes. Check which plan steps are already complete, then implement the remaining steps. Preserve unrelated changes, run the relevant tests and checks, and report what changed, validation results, and any remaining blockers.\n`

export const entryLine = (path: string, title: string, label: string, summary: string): string =>
  `\n- [[${path}|${title}]] (${label})\n  - ${summary}\n`

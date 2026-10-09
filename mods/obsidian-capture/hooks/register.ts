import type { Register } from 'claude-code'

const REPORT = /\/\.claude\/reports\/[^/]+\.md$/
const SUPER = /\/docs\/superpowers\/(plans|specs)\/(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

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

export const fallbackSummary = (text: string): string => {
  const t = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/^\|.*\|$/gm, ' ')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
    .trimEnd()
  return t ? (t.length === 200 ? `${t}...` : t) : 'Captured from Claude Code superpowers.'
}

let home: string | undefined

async function getHome($: any): Promise<string> {
  home ??= (await $.process.run(['printenv', 'HOME'])).stdout.trim()
  return home as string
}

async function captureReport($: any, path: string, content: string) {
  const h = await getHome($)
  const cfg = JSON.parse(await $.fs.read(`${h}/Library/Application Support/obsidian/obsidian.json`)) as { vaults: Record<string, { path: string; open?: boolean }> }
  const vs = Object.values(cfg.vaults)
  const vault = (vs.find(v => v.open) ?? vs[0])?.path
  if (!vault || !vault.startsWith('/')) return

  const { fm, body } = parseFrontmatter(content)
  const title = fm.title || firstHeading(body).replace(/^Unnamed$/, 'Unnamed Report')
  const summary = fm.summary || 'Research report captured from Claude Code.'
  const tags = (fm.tags ?? '').split(',').map(t => t.trim()).filter(Boolean)
  const allTags = ['research', 'claude-session', ...tags.filter(t => t !== 'research')]

  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const prefix = `${mm}-${dd}-${d.getFullYear()}`
  const noteRel = `Projects/Engineering/Research/${prefix}-${slugify(title)}`
  const journalRel = `Journal/${d.getFullYear()}/${mm}-${MONTHS[d.getMonth()]}/${prefix}`

  const note = `---\ncreated: ${mm}/${dd}/${d.getFullYear()}\ntags:\n${allTags.map(t => `  - ${t}\n`).join('')}source: Claude Code (Research)\n---\n\n# ${title}\n\n## Logged In\n[[${journalRel}]]\n\n${body.trimStart()}`
  await $.fs.write(`${vault}/${noteRel}.md`, note)

  const jf = `${vault}/${journalRel}.md`
  const existing: string = await $.fs.read(jf).catch(() => '')
  if (!existing.includes(`[[${noteRel}|`)) {
    await $.fs.write(jf, `${existing}\n- [[${noteRel}|${title}]] (research)\n  - ${summary}\n`)
  }
}

async function captureSuper($: any, path: string, content: string, m: RegExpExecArray) {
  if (content.length < 20) return
  const [, kind, yyyy, mm, dd, slug] = m as unknown as [string, string, string, string, string, string]
  const type = kind === 'plans' ? 'plan' : 'spec'
  const title = firstHeading(content)
  const fields = inlineFields(content)
  const label = type === 'plan' ? 'engineering plan' : 'engineering design spec'

  const r = await $.model.complete({
    model: 'haiku',
    maxTokens: 200,
    system: `You are a concise note-taking assistant. Given an ${label}, output exactly two lines:\nLine 1: A 1-2 sentence summary (max 200 chars). Be specific about what will be built or changed.\nLine 2: 1-2 lowercase kebab-case tags relevant to the topic (comma-separated, no # prefix).\nOutput ONLY these two lines.`,
    prompt: `Summarise and tag this ${label}:\n\n${content}`,
  })
  const lines = r.isAnswered ? r.text.trim().split('\n') : []
  const first = (lines[0] ?? '').trim()
  const summary = (first && first.length <= 300 ? first : fallbackSummary(content)).replace(/\n/g, ' ')
  const newTags = (lines.length > 1 ? lines[lines.length - 1]!.trim() : '') || `engineering-${type}`

  const datePrefix = `${mm}-${dd}-${yyyy}`
  const notePath = `Projects/Engineering/${type === 'plan' ? 'Plans' : 'Specs'}/${datePrefix}-${slug}`
  const journalPath = `Journal/${yyyy}/${mm}-${MONTHS[Number(mm) - 1]}/${datePrefix}`
  const meta = type === 'plan'
    ? `goal: "${fields.goal ?? ''}"\ntech_stack: "${fields.tech_stack ?? ''}"\nspec_ref: "${fields.design_spec ?? fields.spec ?? ''}"`
    : `ticket: "${fields.ticket ?? ''}"\nscope: "${fields.scope ?? ''}"`
  const note = `---\ncreated: ${mm}/${dd}/${yyyy}\nstatus: planned\ntags:\n  - ${type}\n  - claude-session\nsource: Claude Code (Superpowers)\nsource_type: tool_input.content\nsource_file: ${path}\n${meta}\n---\n\n# ${title}\n\n## Logged In\n[[${journalPath}]]\n\n## ${type === 'plan' ? 'Plan' : 'Spec'}\n\n${content}\n`

  const ob = async (...args: string[]) => $.process.run(['obsidian', 'vault=idl', ...args])
  const esc = (s: string) => s.replace(/\n/g, '\\n')

  const created = await ob('create', `path=${notePath}`, `content=${esc(note)}`, 'overwrite', 'silent')
  if (created.exitCode !== 0) return

  const entry = `- [[${notePath}|${title}]] (${type === 'plan' ? 'planned' : 'spec'})\\n  - ${summary}`
  const appended = await ob('append', `path=${journalPath}.md`, `content=${entry}`)
  if (appended.exitCode !== 0) await ob('daily:append', `content=${entry}`)

  // daily:path points at a YYYY-MM-DD file that does not exist in this vault; the journal note is the real daily note.
  const journalFile = `${journalPath}.md`
  const read = await ob('property:read', 'name=tags', `path=${journalFile}`)
  const existing = read.exitCode === 0
    ? read.stdout.split('\n').map((t: string) => t.trim()).filter((t: string) => t && !t.startsWith('Error:'))
    : []
  const merged = [...new Set([...existing, ...newTags.split(',').map((t: string) => t.trim()).filter(Boolean)])]
  const set = await ob('property:set', 'name=tags', `value=${merged.join(',')}`, 'type=list', `path=${journalFile}`)
  if (set.exitCode !== 0 || /^Error:/m.test(set.stdout)) $.ui.toast(`obsidian-capture: tag merge failed for ${journalFile}`)
}

export const register: Register = on => {
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const isReport = REPORT.test(e.file_path)
    const sp = SUPER.exec(e.file_path)
    if (!isReport && !sp) return ran

    const job = isReport ? captureReport($, e.file_path, e.content) : captureSuper($, e.file_path, e.content, sp!)
    job.catch(err => $.ui.toast(`obsidian-capture failed: ${String(err).slice(0, 80)}`))
    return ran
  }).catch(($, e, next) => next(e))
}

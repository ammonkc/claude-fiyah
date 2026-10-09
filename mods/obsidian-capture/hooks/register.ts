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

export const entryLine = (path: string, title: string, label: string, summary: string): string =>
  `\n- [[${path}|${title}]] (${label})\n  - ${summary}\n`

let home: string | undefined
const pending = new Set<Promise<unknown>>()
let logChain: Promise<void> = Promise.resolve()

async function getHome($: any): Promise<string> {
  home ??= (await $.process.run(['printenv', 'HOME'])).stdout.trim()
  return home as string
}

// Last 200 lines kept; writes are serialized so concurrent captures cannot clobber each other.
function log($: any, line: string): void {
  logChain = logChain.then(async () => {
    const file = `${await getHome($)}/.claude/obsidian-capture.log`
    const old: string = await $.fs.read(file).catch(() => '')
    const lines = old.split('\n').filter(Boolean)
    lines.push(`${new Date().toISOString()} ${line}`)
    await $.fs.write(file, `${lines.slice(-200).join('\n')}\n`)
  }).catch(() => undefined)
}

async function findVault($: any): Promise<{ path: string; name: string } | undefined> {
  const h = await getHome($)
  const cfg = JSON.parse(await $.fs.read(`${h}/Library/Application Support/obsidian/obsidian.json`)) as { vaults: Record<string, { path: string; open?: boolean }> }
  const vs = Object.values(cfg.vaults)
  const path = (vs.find(v => v.open) ?? vs[0])?.path
  if (!path || !path.startsWith('/')) return undefined
  return { path, name: path.replace(/\/+$/, '').split('/').pop() as string }
}

// The host's local date, not the module environment's clock.
async function localDate($: any): Promise<{ yyyy: string; mm: string; dd: string }> {
  const [yyyy, mm, dd] = (await $.process.run(['date', '+%Y %m %d'])).stdout.trim().split(' ') as [string, string, string]
  return { yyyy, mm, dd }
}

async function appendFile($: any, file: string, text: string): Promise<void> {
  await $.process.run(['mkdir', '-p', file.slice(0, file.lastIndexOf('/'))])
  const r = await $.process.run(['tee', '-a', file], { stdin: text })
  if (r.exitCode !== 0) throw new Error(`append failed: ${file}`)
}

async function captureReport($: any, session: string, content: string) {
  const vault = await findVault($)
  if (!vault) {
    log($, 'report skipped: no usable vault in obsidian.json')
    return
  }

  const { fm, body } = parseFrontmatter(content)
  const title = fm.title || firstHeading(body).replace(/^Unnamed$/, 'Unnamed Report')
  const summary = fm.summary || 'Research report captured from Claude Code.'
  const tags = (fm.tags ?? '').split(',').map(t => t.trim()).filter(Boolean)
  const allTags = ['research', 'claude-session', ...tags.filter(t => t !== 'research')]

  const { yyyy, mm, dd } = await localDate($)
  const prefix = `${mm}-${dd}-${yyyy}`
  const noteRel = `Projects/Engineering/Research/${prefix}-${slugify(title)}`
  const journalRel = `Journal/${yyyy}/${mm}-${MONTHS[Number(mm) - 1]}/${prefix}`

  const note = `---\ncreated: ${mm}/${dd}/${yyyy}\ntags:\n${allTags.map(t => `  - ${t}\n`).join('')}source: Claude Code (Research)\nsession: ${session}\n---\n\n# ${title}\n\n## Logged In\n[[${journalRel}]]\n\n${body.trimStart()}`
  await $.fs.write(`${vault.path}/${noteRel}.md`, note)

  const jf = `${vault.path}/${journalRel}.md`
  const existing: string = await $.fs.read(jf).catch(() => '')
  if (!existing.includes(`[[${noteRel}|`)) await appendFile($, jf, entryLine(noteRel, title, 'research', summary))
  log($, `report captured: ${noteRel}`)
}

async function captureSuper($: any, session: string, path: string, content: string, m: RegExpExecArray) {
  if (content.length < 20) return
  const vault = await findVault($)
  if (!vault) {
    log($, 'spec skipped: no usable vault in obsidian.json')
    return
  }
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
  const note = `---\ncreated: ${mm}/${dd}/${yyyy}\nstatus: planned\ntags:\n  - ${type}\n  - claude-session\nsource: Claude Code (Superpowers)\nsession: ${session}\nsource_type: tool_input.content\nsource_file: ${path}\n${meta}\n---\n\n# ${title}\n\n## Logged In\n[[${journalPath}]]\n\n## ${type === 'plan' ? 'Plan' : 'Spec'}\n\n${content}\n`

  const ob = async (...args: string[]) => $.process.run(['obsidian', `vault=${vault.name}`, ...args])
  const esc = (s: string) => s.replace(/\n/g, '\\n')

  const created = await ob('create', `path=${notePath}`, `content=${esc(note)}`, 'overwrite', 'silent')
  if (created.exitCode !== 0) {
    log($, `${type} note create failed (${created.exitCode}): ${notePath}`)
    return
  }

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
  if (set.exitCode !== 0 || /^Error:/m.test(set.stdout)) {
    log($, `tag merge failed for ${journalFile}`)
    $.ui.toast(`obsidian-capture: tag merge failed for ${journalFile}`)
  }
  log($, `${type} captured: ${notePath}`)
}

export const register: Register = on => {
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const isReport = REPORT.test(e.file_path)
    const sp = SUPER.exec(e.file_path)
    if (!isReport && !sp) return ran

    const session = await $.session.id()
    const job: Promise<unknown> = (isReport ? captureReport($, session, e.content) : captureSuper($, session, e.file_path, e.content, sp!))
      .catch(err => {
        log($, `capture failed for ${e.file_path}: ${String(err).slice(0, 200)}`)
        $.ui.toast(`obsidian-capture failed: ${String(err).slice(0, 80)}`)
      })
      .finally(() => pending.delete(job))
    pending.add(job)
    return ran
  }).catch(($, e, next) => next(e))

  // Let an in-flight capture finish when the session closes, within the exit bound.
  on('session.end', async ($, e, next) => {
    if (pending.size > 0) {
      const aborted = new Promise<void>(resolve => next.signal.addEventListener('abort', () => resolve()))
      await Promise.race([Promise.allSettled([...pending]), aborted])
    }
    return next(e)
  })
}

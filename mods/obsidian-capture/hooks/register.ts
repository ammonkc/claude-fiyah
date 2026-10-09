import type { Register } from 'claude-code'

const REPORT = /\/\.claude\/reports\/[^/]+\.md$/
const PLAN_FILE = /\/\.claude\/plans\/[^/]+\.md$/
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

export const entryLine = (path: string, title: string, label: string, summary: string): string =>
  `\n- [[${path}|${title}]] (${label})\n  - ${summary}\n`

let home: string | undefined
let vaultOption = ''
let lastPlanFile: string | undefined
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
  const vs = Object.values(cfg.vaults).map(v => ({ ...v, name: v.path.replace(/\/+$/, '').split('/').pop() as string }))
  const chosen = vaultOption ? vs.find(v => v.name === vaultOption) : (vs.find(v => v.open) ?? vs[0])
  if (!chosen || !chosen.path.startsWith('/')) return undefined
  return { path: chosen.path, name: chosen.name }
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
    log($, `report skipped: no usable vault${vaultOption ? ` named ${vaultOption}` : ''} in obsidian.json`)
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

async function summarize($: any, label: string, content: string, fallbackTag: string, emptySummary?: string): Promise<{ summary: string; tags: string }> {
  const r = await $.model.complete({
    model: 'haiku',
    maxTokens: 200,
    system: `You are a concise note-taking assistant. Given an ${label}, output exactly two lines:\nLine 1: A 1-2 sentence summary (max 200 chars). Be specific about what will be built or changed.\nLine 2: 1-2 lowercase kebab-case tags relevant to the topic (comma-separated, no # prefix).\nOutput ONLY these two lines.`,
    prompt: `Summarise and tag this ${label}:\n\n${content}`,
  })
  const lines = r.isAnswered ? r.text.trim().split('\n') : []
  const first = (lines[0] ?? '').trim()
  const summary = (first && first.length <= 300 ? first : fallbackSummary(content, emptySummary)).replace(/\n/g, ' ')
  const tags = (lines.length > 1 ? lines[lines.length - 1]!.trim() : '') || fallbackTag
  return { summary, tags }
}

type PlanInfo = { vaultPath: string; notePath: string; journalPath: string; title: string; summary: string; tags: string[]; isUpdate: boolean }

async function resolvePlanFile($: any): Promise<string | undefined> {
  if (lastPlanFile) return lastPlanFile
  const dir = `${await getHome($)}/.claude/plans`
  const entries: Array<{ name: string; kind: string; mtimeMs: number }> = await $.fs.list(dir).catch(() => [])
  const newest = entries.filter(x => x.kind === 'file' && x.name.endsWith('.md')).sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  return newest ? `${dir}/${newest.name}` : undefined
}

// A note is the same plan when its source_file is the same plan file, whatever its title or date prefix now are.
async function findExistingPlanNote($: any, vaultPath: string, planFile: string): Promise<string | undefined> {
  const dir = `${vaultPath}/Projects/Engineering/Plans`
  const r = await $.process.run(['grep', '-rlFx', '--include=*.md', `source_file: ${planFile}`, dir])
  const hits: string[] = r.exitCode === 0 ? r.stdout.split('\n').filter(Boolean) : []
  if (hits.length === 0) return undefined
  const stamped = await Promise.all(hits.map(async f => ({ f, t: (await $.fs.stat(f).catch(() => ({ mtimeMs: 0 }))).mtimeMs as number })))
  const file = stamped.sort((x, y) => y.t - x.t)[0]!.f
  return file.slice(vaultPath.length + 1).replace(/\.md$/, '')
}

async function capturePlan($: any, session: string): Promise<PlanInfo | undefined> {
  const vault = await findVault($)
  if (!vault) {
    log($, `plan skipped: no usable vault${vaultOption ? ` named ${vaultOption}` : ''} in obsidian.json`)
    return undefined
  }
  const planFile = await resolvePlanFile($)
  const content: string = planFile ? await $.fs.read(planFile).catch(() => '') : ''
  if (!planFile || content.length < 20) {
    log($, `plan skipped: no plan content (${planFile ?? 'no plan file found'})`)
    return undefined
  }

  const existingPath = await findExistingPlanNote($, vault.path, planFile)
  if (existingPath) {
    const noteFile = `${vault.path}/${existingPath}.md`
    const existing: string = await $.fs.read(noteFile)
    await $.fs.write(noteFile, replacePlanSection(existing, content))
    const title = /^# (.+)$/m.exec(existing)?.[1] ?? planTitle(content)
    const d = await localDate($)
    const journalPath = loggedInLink(existing) ?? `Journal/${d.yyyy}/${d.mm}-${MONTHS[Number(d.mm) - 1]}/${d.mm}-${d.dd}-${d.yyyy}`
    return { vaultPath: vault.path, notePath: existingPath, journalPath, title, summary: '', tags: [], isUpdate: true }
  }

  const title = planTitle(content)
  const { yyyy, mm, dd } = await localDate($)
  const datePrefix = `${mm}-${dd}-${yyyy}`
  const notePath = `Projects/Engineering/Plans/${datePrefix}-${planSlug(title)}`
  const journalPath = `Journal/${yyyy}/${mm}-${MONTHS[Number(mm) - 1]}/${datePrefix}`
  const { summary, tags } = await summarize($, 'engineering plan', content, 'engineering-plan', 'Captured an engineering plan from Claude Code.')

  const note = `---\ncreated: ${mm}/${dd}/${yyyy}\nstatus: planned\ntags:\n  - plan\n  - claude-session\nsource: Claude Code (Plan Mode)\nsession: ${session}\nsource_type: plan file\nsource_file: ${planFile}\n---\n\n# ${title}\n\n## Logged In\n[[${journalPath}]]\n\n${planSection(content)}`
  await $.fs.write(`${vault.path}/${notePath}.md`, note)
  return { vaultPath: vault.path, notePath, journalPath, title, summary, tags: tags.split(',').map(t => t.trim()).filter(Boolean), isUpdate: false }
}

// Runs once the approval dialog has settled: a rejected plan is one the user is keeping for later.
async function finalizePlan($: any, info: PlanInfo, isRejected: boolean): Promise<void> {
  const status = isRejected ? 'saved-for-later' : 'planned'
  const noteFile = `${info.vaultPath}/${info.notePath}.md`
  const note: string = await $.fs.read(noteFile)
  const next = withStatus(note, status)
  if (next !== note) await $.fs.write(noteFile, next)

  const journalFile = `${info.vaultPath}/${info.journalPath}.md`
  const label = isRejected ? 'saved for later' : 'planned'
  const journal: string = await $.fs.read(journalFile).catch(() => '')
  await $.process.run(['mkdir', '-p', journalFile.slice(0, journalFile.lastIndexOf('/'))])
  const updated = info.isUpdate && !journal.includes(`- [[${info.notePath}|`)
    ? journal
    : upsertEntry(journal, info.notePath, info.title, label, info.summary)
  const withTags = info.tags.length ? mergeTags(updated, info.tags) : updated
  if (withTags !== journal) await $.fs.write(journalFile, withTags)
  log($, `plan ${info.isUpdate ? 'updated' : 'captured'} (${status}): ${info.notePath}`)
}

async function captureSuper($: any, session: string, path: string, content: string, m: RegExpExecArray) {
  if (content.length < 20) return
  const vault = await findVault($)
  if (!vault) {
    log($, `spec skipped: no usable vault${vaultOption ? ` named ${vaultOption}` : ''} in obsidian.json`)
    return
  }
  const [, kind, yyyy, mm, dd, slug] = m as unknown as [string, string, string, string, string, string]
  const type = kind === 'plans' ? 'plan' : 'spec'
  const title = firstHeading(content)
  const fields = inlineFields(content)
  const label = type === 'plan' ? 'engineering plan' : 'engineering design spec'

  const { summary, tags: newTags } = await summarize($, label, content, `engineering-${type}`)

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

export const register: Register = (on, options) => {
  vaultOption = typeof options?.vault === 'string' ? options.vault.trim() : ''
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (PLAN_FILE.test(e.file_path)) lastPlanFile = e.file_path
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

  on('tool.call', { tool: 'Edit' }, ($, e, next) => {
    if (PLAN_FILE.test(e.file_path)) lastPlanFile = e.file_path
    return next(e)
  }).catch(($, e, next) => next(e))

  // Captures before the approval dialog, so a plan is saved whichever way it is answered.
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const session = await $.session.id()
    const capture: Promise<PlanInfo | undefined> = capturePlan($, session).catch(err => {
      log($, `plan capture failed: ${String(err).slice(0, 200)}`)
      $.ui.toast(`obsidian-capture failed: ${String(err).slice(0, 80)}`)
      return undefined
    })
    pending.add(capture)

    const ran = await next(e)

    const info = await capture
    pending.delete(capture)
    if (info) {
      const done: Promise<unknown> = finalizePlan($, info, ran.deny !== undefined || ran.isError === true)
        .catch(err => log($, `plan finalize failed: ${String(err).slice(0, 200)}`))
        .finally(() => pending.delete(done))
      pending.add(done)
    }
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

import type { EngineInterface, Register } from 'claude-code'

import { hash, isCoreSaved, middle, newStats, notedPath, parseJson, render, safeName, split, textOf, trimValue, wordsOf } from './trim'

const NAME = 'input-router'
const MODEL = 'haiku'
const CHUNK_CHARS = 100_000
const REQUEST_CHARS = 12_000
const ARGS_CHARS = 1_500
const CALL_MS = 90_000
const NOTES_TOKENS = 2_500
const NOTE_MAX = 12_000
const FILE_READ_MAX = 4 * 1024 * 1024
const KEEP_DAYS = 7
const PDF_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

// Tools whose exact output the next step depends on, or that are already sandboxed or small.
const SKIP_SERVER = /^mcp__(plugin_context-mode_|context-mode|plugin-authoring|plugin_plugin-authoring|Claude_Browser|claude-in-chrome|Control_Chrome|computer-use|playwright)/
const SKIP_TOOL = /__(read_page|find|screenshot|snapshot|read_me|guide)$/i

const MCP_SYSTEM = [
  'You help another AI assistant by reading a large tool result it asked for. The assistant sees only your notes, not the raw data.',
  'Keep what its task needs and drop the rest.',
  '- Copy values exactly: names, ids, keys, emails, numbers, dates, URLs. Never invent, guess or round.',
  '- When the task needs a list of records, keep every record that fits, one compact line each, with the fields the task needs plus the record id and name.',
  '- When the task is unclear, keep one compact line per record with its id, its name and its most telling fields.',
  '- Copy paging and count fields by exact name and value (for example total: 120, nextPageToken). Never reword them.',
  '- No preamble and no closing summary. The last line is "Not kept:" and then the kinds of fields you left out, in a few words.',
].join('\n')

const PDF_SYSTEM = [
  'You help another AI assistant by reading a long document it asked for. The assistant sees only your notes, not the document.',
  'Write notes for its task: the structure (sections with page numbers), the facts, figures, names, dates and decisions the task needs.',
  '- Copy numbers, names, dates and quotes exactly. Never invent or round.',
  '- Cite pages as p.N, using the "=== Page N ===" markers in the text.',
  '- No preamble and no closing summary. The last line is "Not kept:" and then what you left out, in a few words.',
].join('\n')

type Cfg = { threshold: number; pdfPages: number; maxChunks: number; isEnabled: boolean }
type Task = { user: string }

let routed = 0
let passed = 0

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

/** The home folder: the part of the plugin's own path before `/.claude/`, else $HOME. Empty when neither is known. */
async function homeOf($: EngineInterface): Promise<string> {
  const root = String($.plugin.root ?? '')
  const i = root.indexOf('/.claude/')
  if (i > 0) return root.slice(0, i)
  try {
    const h = await $.env.get('HOME')
    return h && h.startsWith('/') ? h.replace(/\/+$/, '') : ''
  } catch {
    return ''
  }
}

/** One log line per decision: names, sizes and timings only, never content, arguments or commands. */
async function log($: EngineInterface, kind: string, line: string): Promise<void> {
  try {
    const home = await homeOf($)
    if (!home) return
    const file = `${home}/.claude/mods-logs/${NAME}.log`
    const at = new Date(await $.clock.now()).toISOString()
    await $.process.run(['/bin/sh', '-c', 'mkdir -p "$(dirname "$1")" && cat >> "$1"', 'sh', file], {
      stdin: `${at} ${kind} ${line}\n`,
      timeoutMs: 5_000,
    })
  } catch {
    // Logging never breaks a call.
  }
}

const errName = (err: unknown) => (err instanceof Error ? err.name : 'error')

async function isOn($: EngineInterface, cfg: Cfg): Promise<boolean> {
  if (!cfg.isEnabled) return false
  try {
    return (await $.store.get('off')) !== true
  } catch {
    return true
  }
}

/** The last real request from the person (tool results and empty rows skipped), cut to head and tail. */
async function purpose($: EngineInterface, agentId: string | undefined): Promise<Task> {
  try {
    const rows = await $.session.messages(agentId ? { agentId } : {})
    if (Array.isArray(rows)) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]!
        if (row.role !== 'user' || (row.toolResults && row.toolResults.length > 0)) continue
        const text = middle(row.text ?? '', REQUEST_CHARS)
        if (text) return { user: text }
      }
    }
  } catch {
    // No transcript: the arguments alone say what the call was for.
  }
  return { user: '' }
}

type Opts = { signal?: AbortSignal }

/** Haiku notes for each part, in parallel. Null when any part fails: the caller then passes the original through. */
async function notesFor($: EngineInterface, system: string, head: string, parts: string[], opts: Opts): Promise<string[] | null> {
  const asked = await Promise.all(
    parts.map(async (part, i) => {
      try {
        const prompt = `${head}\n\nThis is part ${i + 1} of ${parts.length}.\n\n<data>\n${part}\n</data>`
        const r = await $.model.complete({ model: MODEL, system, prompt, maxTokens: NOTES_TOKENS, timeoutMs: CALL_MS }, opts)
        return r.isAnswered && r.text.trim() ? r.text.trim() : null
      } catch {
        return null
      }
    }),
  )
  return asked.every(x => x !== null) ? (asked as string[]) : null
}

/** The note's body: notes per part, with the unread remainder said plainly. */
function frame(title: string, parts: string[], notes: string[], unread: number, where: string): string {
  const body = notes.map((n, i) => (notes.length > 1 ? `--- part ${i + 1} of ${notes.length} ---\n${n}` : n)).join('\n\n')
  return [
    `[${NAME}] ${title} (${notes.length} chunk${notes.length === 1 ? '' : 's'}; ${fmt(unread)} chars not read).`,
    'These are notes written for your task, not the raw data. Copy values from them as given; do not re-run the call just to check them.',
    where,
    '',
    body,
  ].join('\n')
}

// ---------- MCP ----------

type Answered = { result?: unknown; deny?: unknown; isError?: unknown }

/** The core-saved file behind an oversize note, when it really is one of core's own tool-results files. */
async function coreFile($: EngineInterface, home: string, note: string): Promise<{ path: string; text: string } | null> {
  const path = notedPath(note)
  if (!path || !home || path.split('/').includes('..')) return null
  try {
    const root = (await $.fs.stat(`${home}/.claude/projects`, { resolve: true })).realPath
    const st = await $.fs.stat(path, { resolve: true })
    if (!root || !st.realPath || st.kind !== 'file' || st.size > FILE_READ_MAX) return null
    if (!isCoreSaved(st.realPath, root)) return null
    return { path: st.realPath, text: String(await $.fs.read(st.realPath)) }
  } catch {
    return null
  }
}

async function routeMcp(
  $: EngineInterface,
  e: Record<string, unknown>,
  tool: string,
  ran: Answered,
  cfg: Cfg,
  opts: Opts,
): Promise<{ result: string } | null> {
  const got = textOf(ran.result)
  if (!got) return null
  const home = await homeOf($)
  let raw = got.join('\n')
  let file = ''
  const t0 = await $.clock.now()
  if (raw.length < NOTE_MAX && raw.includes('saved to')) {
    const core = await coreFile($, home, raw)
    if (core) {
      file = core.path
      raw = core.text
    }
  }
  if (raw.length < cfg.threshold) {
    passed++
    return null
  }
  if (!home) return null

  // Keep the raw result, unless core already did.
  const data = parseJson(raw)
  if (!file) {
    file = `${home}/.claude/mods-logs/${NAME}/results/${new Date(t0).toISOString().replace(/[:.]/g, '-')}-${safeName(tool)}.${data === undefined ? 'txt' : 'json'}`
    await $.fs.write(file, raw)
  }
  const where = `Full raw result (read it with offset and limit, or grep it, when you need exact text): ${file}`

  const reserved = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent'])
  const args = JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !reserved.has(k)))).slice(0, ARGS_CHARS)
  const task = await purpose($, typeof e.agentId === 'string' ? e.agentId : undefined)
  const words = wordsOf(`${task.user} ${args}`)

  // Plain code first: drop fields nobody uses. No text is cut.
  const stats = newStats()
  let text = raw
  if (data !== undefined) text = render(trimValue(data, words, stats))
  const removed = [...stats.removed].sort().join(', ')
  if (text.length < cfg.threshold) {
    if (text.length >= raw.length) return null
    await log($, 'mcp', `trim ${tool} ${raw.length}->${text.length} chars ${Date.now() - t0}ms`)
    routed++
    return {
      result: `[${NAME}] ${tool}: dropped noise fields (${removed || 'none by name'}${stats.unpacked ? `, unpacked ${stats.unpacked} JSON text field(s)` : ''}); nothing else changed. ${where}\n\n${text}`,
    }
  }

  const all = split(text, CHUNK_CHARS)
  const parts = all.slice(0, cfg.maxChunks)
  const unread = all.slice(cfg.maxChunks).reduce((n, p) => n + p.length, 0)
  const head = [`Tool: ${tool}`, `Arguments: ${args}`, task.user ? `The person's last request:\n${task.user}` : 'The person gave no request text.'].join('\n')
  const notes = await notesFor($, MCP_SYSTEM, head, parts, opts)
  if (!notes) {
    await log($, 'mcp', `haiku failed ${tool} ${raw.length} chars, original sent`)
    return null
  }
  const reply = frame(`Notes by Haiku from ${parts.length} chunks of ${tool}`, parts, notes, unread, where)
  if (reply.length >= raw.length) return null
  routed++
  await log($, 'mcp', `haiku ${tool} ${raw.length}->${reply.length} chars ${parts.length} chunks ${unread} unread ${(await $.clock.now()) - t0}ms`)
  return { result: reply }
}

// ---------- PDF ----------

async function findBin($: EngineInterface, name: string): Promise<string | null> {
  for (const dir of PDF_DIRS) {
    try {
      if (await $.fs.exists(`${dir}/${name}`)) return `${dir}/${name}`
    } catch {
      // Next folder.
    }
  }
  return null
}

async function routePdf($: EngineInterface, path: string, cfg: Cfg, agentId: string | undefined, opts: Opts) {
  if (!path.startsWith('/')) return null
  const check = await $.tool.check({ tool: 'Read', input: { file_path: path } })
  if (check.decision !== 'allow') return null
  const home = await homeOf($)
  const info = await findBin($, 'pdfinfo')
  const totext = await findBin($, 'pdftotext')
  if (!home || !info || !totext) return null

  const t0 = await $.clock.now()
  const meta = await $.process.run([info, path], { timeoutMs: 30_000 })
  const total = Number(/^Pages:\s+(\d+)/m.exec(meta.stdout)?.[1] ?? 0)
  if (meta.exitCode !== 0 || total <= cfg.pdfPages) return null
  const ran = await $.process.run([totext, '-enc', 'UTF-8', path, '-'], { timeoutMs: 120_000 })
  if (ran.exitCode !== 0 || ran.isStdoutTruncated) return null
  const pages = ran.stdout.split('\f')
  if (pages.length > 0 && pages[pages.length - 1]!.trim() === '') pages.pop()
  // A scanned PDF has no text layer: core's page images are the only way in.
  if (pages.reduce((n, p) => n + p.trim().length, 0) < 100 * total) return null

  const text = pages.map((p, i) => `=== Page ${i + 1} ===\n${p.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()}`).join('\n\n')
  const mtime = await $.fs.stat(path).then(s => s.mtimeMs, () => 0)
  const base = safeName(path.split('/').pop() ?? 'document')
  const textFile = `${home}/.claude/mods-logs/${NAME}/text/${base}-${hash(`${path}|${mtime}`)}.txt`
  await $.fs.write(textFile, text)

  const all = split(text, CHUNK_CHARS)
  const parts = all.slice(0, cfg.maxChunks)
  const unread = all.slice(cfg.maxChunks).reduce((n, p) => n + p.length, 0)
  const task = await purpose($, agentId)
  const head = [`Document: ${path.split('/').pop()} (${total} pages)`, task.user ? `The person's last request:\n${task.user}` : 'The person gave no request text.'].join('\n')
  const notes = await notesFor($, PDF_SYSTEM, head, parts, opts)
  if (!notes) {
    await log($, 'pdf', `haiku failed ${total} pages, plain Read sent`)
    return null
  }
  const where = `Extracted text of all ${total} pages (read it with offset and limit for exact text; or Read the PDF itself with pages, ${cfg.pdfPages} pages or fewer per call pass through untouched): ${textFile}`
  const content = frame(`Notes by Haiku on ${path.split('/').pop()}, ${total} pages`, parts, notes, unread, where)
  routed++
  await log($, 'pdf', `haiku ${total} pages ${text.length}->${content.length} chars ${parts.length} chunks ${(await $.clock.now()) - t0}ms`)
  const numLines = content.split('\n').length
  return { result: { type: 'text' as const, file: { filePath: path, content, numLines, startLine: 1, totalLines: numLines } } }
}

// ---------- register ----------

export const register: Register = (on, options) => {
  const cfg: Cfg = {
    isEnabled: options.enabled !== false,
    threshold: Number(options.mcpThresholdChars ?? 16_000),
    pdfPages: Number(options.pdfPages ?? 5),
    maxChunks: Math.max(1, Number(options.maxChunks ?? 6)),
  }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: NAME, description: 'Turn the MCP and PDF input router on or off', argumentHint: '[on|off|status]' })
      const home = await homeOf($)
      if (home) {
        for (const dir of ['results', 'text']) {
          await $.process.run(['/usr/bin/find', `${home}/.claude/mods-logs/${NAME}/${dir}`, '-type', 'f', '-mtime', `+${KEEP_DAYS}`, '-delete'], { timeoutMs: 15_000 })
        }
      }
    } catch (err) {
      await log($, 'mod', `session start failed ${errName(err)}`)
    }
    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    const verb = e.args.trim().toLowerCase()
    if (verb === 'on' || verb === 'off') await $.store.set('off', verb === 'off')
    else if (verb && verb !== 'status') return { text: `Usage: /${NAME} [on|off|status]` }
    const live = await isOn($, cfg)
    return {
      text: [
        `${NAME} is ${live ? 'on' : 'off'}${cfg.isEnabled ? '' : ' (disabled in the mod settings)'}.`,
        `MCP results over ${fmt(cfg.threshold)} chars are trimmed, then read by Haiku in up to ${cfg.maxChunks} chunks. PDFs over ${cfg.pdfPages} pages are read by Haiku.`,
        `This session: ${routed} routed, ${passed} MCP results under the limit. Log: ~/.claude/mods-logs/${NAME}.log`,
      ].join('\n'),
    }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (!tool.startsWith('mcp__') || SKIP_SERVER.test(tool) || SKIP_TOOL.test(tool) || !(await isOn($, cfg))) return next(e)
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    // The tool has run: from here a failure hands back its result, never a second run.
    try {
      return (await routeMcp($, e as unknown as Record<string, unknown>, tool, ran, cfg, { signal: next.signal })) ?? ran
    } catch (err) {
      await log($, 'mcp', `failed ${tool} ${errName(err)}, original sent`)
      return ran
    }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (!/\.pdf$/i.test(e.file_path) || e.pages !== undefined || !(await isOn($, cfg))) return next(e)
    try {
      const out = await routePdf($, e.file_path, cfg, e.agentId, { signal: next.signal })
      if (out) return out
    } catch (err) {
      await log($, 'pdf', `failed ${errName(err)}, plain Read sent`)
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}

import type { EngineInterface, Register } from 'claude-code'

import { inspect, outlineNote, wantsSynthesis } from './outline'
import { hash, isCoreSaved, middle, notedPath, safeName, shapeOf, split, textOf } from './text'

const NAME = 'input-router'
const MODEL = 'haiku'
const CHUNK_CHARS = 100_000
const REQUEST_CHARS = 12_000
const CALL_MS = 90_000
const SYNTH_MS = 60_000
const NOTES_TOKENS = 2_500
const SYNTH_TOKENS = 700
const NOTE_MAX = 12_000
const FILE_READ_MAX = 4 * 1024 * 1024
const KEEP_DAYS = 7
const PDF_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

// Tools whose output is already sandboxed, or a page snapshot the next step reads exactly.
const SKIP_SERVER = /^mcp__(plugin_context-mode_|context-mode|plugin-authoring|plugin_plugin-authoring|Claude_Browser|claude-in-chrome|Control_Chrome|computer-use|playwright)/
const SKIP_TOOL = /__(read_page|find|screenshot|snapshot|read_me|guide)$/i

const SYNTH_SYSTEM = [
  'You help another AI assistant with a long document a tool returned. The assistant also has the full document; your synthesis is read first, as a head start.',
  'Answer what its task needs from this document in at most 250 words.',
  '- Copy names, ids, numbers, dates and rules exactly. Never invent, guess or round.',
  '- When the document does not answer the task, say so in one line.',
  '- No preamble. End with "Check exact values in the full result."',
].join('\n')

const PDF_SYSTEM = [
  'You help another AI assistant by reading a long document it asked for. The assistant sees only your notes, not the document.',
  'Write notes for its task: the structure (sections with page numbers), the facts, figures, names, dates and decisions the task needs.',
  '- Copy numbers, names, dates and quotes exactly. Never invent or round.',
  '- Cite pages as p.N, using the "=== Page N ===" markers in the text.',
  '- No preamble and no closing summary. The last line is "Not kept:" and then what you left out, in a few words.',
].join('\n')

type Cfg = { minChars: number; synthesize: string; pdfPages: number; maxChunks: number; isEnabled: boolean }
type Opts = { signal?: AbortSignal }

const tally = { outlined: 0, synthesized: 0, skipped: 0, pdf: 0 }

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

/** One log line per decision: names, shapes, sizes and timings only, never content or arguments. */
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
async function purpose($: EngineInterface, agentId: string | undefined): Promise<string> {
  try {
    const rows = await $.session.messages(agentId ? { agentId } : {})
    if (Array.isArray(rows)) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]!
        if (row.role !== 'user' || (row.toolResults && row.toolResults.length > 0)) continue
        const text = middle(row.text ?? '', REQUEST_CHARS)
        if (text) return text
      }
    }
  } catch {
    // No transcript: the document alone.
  }
  return ''
}

async function ask($: EngineInterface, system: string, prompt: string, maxTokens: number, timeoutMs: number, opts: Opts): Promise<string | null> {
  try {
    const r = await $.model.complete({ model: MODEL, system, prompt, maxTokens, timeoutMs }, opts)
    return r.isAnswered && r.text.trim() ? r.text.trim() : null
  } catch {
    return null
  }
}

// ---------- MCP: the result always goes on unchanged; a map (and, when asked, a synthesis) rides beside it ----------

type Ran = { result?: unknown; deny?: unknown; isError?: unknown; context?: readonly string[] }

/** The core-saved file behind an oversize note, when it really is one of core's own tool-results files. */
async function coreFile($: EngineInterface, home: string, note: string): Promise<string | null> {
  const path = notedPath(note)
  if (!path || !home || path.split('/').includes('..')) return null
  try {
    const root = (await $.fs.stat(`${home}/.claude/projects`, { resolve: true })).realPath
    const st = await $.fs.stat(path, { resolve: true })
    if (!root || !st.realPath || st.kind !== 'file' || st.size > FILE_READ_MAX) return null
    if (!isCoreSaved(st.realPath, root)) return null
    return String(await $.fs.read(st.realPath))
  } catch {
    return null
  }
}

/** What to add to the model's view of this result, or null to add nothing. Never changes the result. */
async function noteFor($: EngineInterface, e: Record<string, unknown>, tool: string, ran: Ran, cfg: Cfg, opts: Opts): Promise<string | null> {
  const shape = shapeOf(ran.result)
  let raw = textOf(ran.result)
  if (raw === undefined) {
    tally.skipped++
    await log($, 'mcp', `skip ${tool} shape=${shape} no text`)
    return null
  }
  if (raw.length < NOTE_MAX && raw.includes('saved to')) {
    const saved = await coreFile($, await homeOf($), raw)
    if (saved !== null) raw = saved
  }
  if (raw.length < cfg.minChars) {
    tally.skipped++
    await log($, 'mcp', `skip ${tool} shape=${shape} ${raw.length} chars under ${cfg.minChars}`)
    return null
  }

  const doc = inspect(raw)
  const synth = wantsSynthesis(tool, cfg.synthesize)
  if (doc.kind !== 'prose' && !synth) {
    tally.skipped++
    await log($, 'mcp', `skip ${tool} shape=${shape} ${raw.length} chars kind=${doc.kind}${doc.kind === 'records' ? ` (${doc.records})` : ''}`)
    return null
  }

  const parts: string[] = []
  if (doc.kind === 'prose') {
    parts.push(outlineNote(tool, raw.length, doc))
    tally.outlined++
  }
  if (synth) {
    const t0 = await $.clock.now()
    const task = await purpose($, typeof e.agentId === 'string' ? e.agentId : undefined)
    const source = middle(doc.kind === 'prose' && doc.body ? doc.body : raw, CHUNK_CHARS)
    const prompt = `Tool: ${tool}\n${task ? `The person's last request:\n${task}` : 'The person gave no request text.'}\n\n<document>\n${source}\n</document>`
    const text = await ask($, SYNTH_SYSTEM, prompt, SYNTH_TOKENS, SYNTH_MS, opts)
    const ms = (await $.clock.now()) - t0
    if (text) {
      parts.push(`[input-router] Synthesis by Haiku for your task (lossy; the full result is the source of truth):\n${text}`)
      tally.synthesized++
    }
    await log($, 'mcp', `synth ${tool} ${text ? 'ok' : 'failed'} ${ms}ms`)
  }
  if (parts.length === 0) return null
  await log($, 'mcp', `note ${tool} shape=${shape} ${raw.length} chars kind=${doc.kind} headings=${doc.headings.length}`)
  return parts.join('\n\n')
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
  const head = [`Document: ${path.split('/').pop()} (${total} pages)`, task ? `The person's last request:\n${task}` : 'The person gave no request text.'].join('\n')
  const notes = await Promise.all(parts.map((part, i) => ask($, PDF_SYSTEM, `${head}\n\nThis is part ${i + 1} of ${parts.length}.\n\n<data>\n${part}\n</data>`, NOTES_TOKENS, CALL_MS, opts)))
  if (notes.some(n => n === null)) {
    await log($, 'pdf', `haiku failed ${total} pages, plain Read sent`)
    return null
  }
  const body = notes.map((n, i) => (notes.length > 1 ? `--- part ${i + 1} of ${notes.length} ---\n${n}` : n)).join('\n\n')
  const content = [
    `[${NAME}] Notes by Haiku on ${path.split('/').pop()}, ${total} pages (${notes.length} chunk${notes.length === 1 ? '' : 's'}; ${fmt(unread)} chars not read).`,
    'These are notes written for your task, not the document. Copy values from them as given.',
    `Extracted text of all ${total} pages (read it with offset and limit for exact text; or Read the PDF itself with pages, ${cfg.pdfPages} pages or fewer per call pass through untouched): ${textFile}`,
    '',
    body,
  ].join('\n')
  tally.pdf++
  await log($, 'pdf', `haiku ${total} pages ${text.length}->${content.length} chars ${parts.length} chunks ${(await $.clock.now()) - t0}ms`)
  const numLines = content.split('\n').length
  return { result: { type: 'text' as const, file: { filePath: path, content, numLines, startLine: 1, totalLines: numLines } } }
}

// ---------- register ----------

export const register: Register = (on, options) => {
  const cfg: Cfg = {
    isEnabled: options.enabled !== false,
    minChars: Math.max(1, Number(options.outlineMinChars ?? 4_096)),
    synthesize: String(options.synthesizeTools ?? ''),
    pdfPages: Number(options.pdfPages ?? 5),
    maxChunks: Math.max(1, Number(options.maxChunks ?? 6)),
  }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: NAME, description: 'Turn the MCP outline and PDF reader on or off', argumentHint: '[on|off|status]' })
      const home = await homeOf($)
      if (home) {
        await $.process.run(['/usr/bin/find', `${home}/.claude/mods-logs/${NAME}/text`, '-type', 'f', '-mtime', `+${KEEP_DAYS}`, '-delete'], { timeoutMs: 15_000 })
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
        `MCP results over ${fmt(cfg.minChars)} chars that read as documents get an outline beside them; the result itself is never changed.`,
        `Haiku synthesis: ${cfg.synthesize.trim() ? cfg.synthesize : 'off (set synthesizeTools to turn it on for chosen tools)'}. PDFs over ${cfg.pdfPages} pages are read by Haiku.`,
        `This session: ${tally.outlined} outlined, ${tally.synthesized} synthesized, ${tally.skipped} skipped, ${tally.pdf} PDFs. Log: ~/.claude/mods-logs/${NAME}.log`,
      ].join('\n'),
    }
  })

  // tool.run, not tool.call: it runs inside PostToolUse, so it sees the raw result before context-mode
  // swaps it for a search pointer, and its `context` rides along to the model. The matcher keeps it off
  // every other tool, since a tool.run hook that may match a tool turns off that tool's backgrounding.
  on('tool.run', { tool: /^mcp__/ }, async ($, e, next) => {
    const tool = String(e.tool)
    if (SKIP_SERVER.test(tool) || SKIP_TOOL.test(tool) || !(await isOn($, cfg))) return next(e)
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    // The tool has run: from here a failure hands back its result as it was, never a second run.
    try {
      const note = await noteFor($, e as unknown as Record<string, unknown>, tool, ran, cfg, { signal: next.signal })
      return note ? { ...ran, context: [...(ran.context ?? []), note] } : ran
    } catch (err) {
      await log($, 'mcp', `failed ${tool} ${errName(err)}, result sent as it was`)
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

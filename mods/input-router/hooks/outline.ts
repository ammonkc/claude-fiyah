// Pure helpers: what kind of document a result is, and a map of it. No model, no engine calls.
import { parseJson } from './text'

export type Kind = 'prose' | 'records' | 'other'
export type Heading = { level: number; text: string }
export type Counts = { tables: number; listItems: number; checklist: number; codeBlocks: number; links: number }
export type Shape = { kind: Kind; title?: string; body: string; records: number; headings: Heading[]; counts: Counts }

const TITLE_KEY = /^(title|summary|subject|name)$/i
const LIST_KEY = /^(issues|results|values|items|nodes|edges|data|pages|records|hits|logs|spans|events|series|comments|children)$/i
const BODY_MIN = 200
const RECORDS_MIN = 5

/** The most objects in one list: the result itself, or a list under a well known key up to two levels down. */
function recordCount(v: unknown, depth = 0): number {
  if (Array.isArray(v)) return v.filter(x => x && typeof x === 'object').length
  if (!v || typeof v !== 'object' || depth > 2) return 0
  let most = 0
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(x) && LIST_KEY.test(k)) most = Math.max(most, recordCount(x, depth + 1))
    else if (x && typeof x === 'object' && !Array.isArray(x)) most = Math.max(most, recordCount(x, depth + 1))
  }
  return most
}

/** The shallowest short title-like string, and every long string (JSON written into a string is opened). */
function collect(v: unknown, depth: number, out: { title?: string; titleDepth: number; bodies: string[] }): void {
  if (typeof v === 'string') {
    const inner = v.length >= BODY_MIN && /^\s*[[{]/.test(v) ? parseJson(v) : undefined
    if (inner !== undefined) collect(inner, depth + 1, out)
    else if (v.length >= BODY_MIN) out.bodies.push(v)
    return
  }
  if (Array.isArray(v)) {
    for (const x of v) collect(x, depth + 1, out)
    return
  }
  if (!v || typeof v !== 'object') return
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === 'string' && TITLE_KEY.test(k) && x.length < 300 && depth < out.titleDepth) {
      out.title = x.trim()
      out.titleDepth = depth
    } else {
      collect(x, depth + 1, out)
    }
  }
}

const clean = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Markdown and HTML headings, in order, skipping fenced code. */
export function headingsOf(text: string): Heading[] {
  const out: Heading[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const md = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (md) {
      const t = clean(md[2]!)
      if (t) out.push({ level: md[1]!.length, text: t })
      continue
    }
    for (const m of line.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
      const t = clean(m[2]!)
      if (t) out.push({ level: Number(m[1]), text: t })
    }
  }
  return out
}

export function countsOf(text: string): Counts {
  const lines = text.split('\n')
  let tables = 0
  let inTable = false
  for (const line of lines) {
    const row = /^\s*\|/.test(line)
    if (row && !inTable) tables++
    inTable = row
  }
  tables += (text.match(/<table\b/gi) ?? []).length
  return {
    tables,
    listItems: lines.filter(l => /^\s*([-*+]|\d+\.)\s+\S/.test(l)).length + (text.match(/<li\b/gi) ?? []).length,
    checklist: lines.filter(l => /^\s*[-*+]\s+\[[ xX]\]/.test(l)).length,
    codeBlocks: Math.floor((text.match(/^\s*```/gm) ?? []).length / 2),
    links: (text.match(/\]\(https?:\/\//g) ?? []).length + (text.match(/<a\s[^>]*href=/gi) ?? []).length,
  }
}

/** Share of non-empty lines that read like sentences: eight or more words, not starting with a timestamp. */
function sentenceShare(text: string): number {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length === 0) return 0
  const prose = lines.filter(l => !/^\s*\[?\d{2,4}[-/:T]/.test(l) && l.trim().split(/\s+/).length >= 8)
  return prose.length / lines.length
}

/**
 * Prose is a document to read (a page, an issue, a thread). Records are many similar objects (search hits,
 * metrics, log lines), where exact retrieval beats any map. Everything else is left alone.
 */
export function inspect(raw: string): Shape {
  const data = parseJson(raw)
  if (data === undefined) {
    const headings = headingsOf(raw)
    const kind: Kind = headings.length >= 2 || sentenceShare(raw) >= 0.5 ? 'prose' : 'other'
    return { kind, body: raw, records: 0, headings, counts: countsOf(raw) }
  }
  const records = recordCount(data)
  const got: { title?: string; titleDepth: number; bodies: string[] } = { titleDepth: Infinity, bodies: [] }
  collect(data, 0, got)
  const body = got.bodies.join('\n\n')
  const headings = headingsOf(body)
  let kind: Kind = 'other'
  if (records >= RECORDS_MIN) kind = 'records'
  else if (body.length >= raw.length * 0.4 || headings.length >= 3) kind = 'prose'
  return { kind, title: got.title, body, records, headings, counts: countsOf(body) }
}

const MAX_HEADINGS = 80
const MAX_NOTE = 4_000

/** The map Claude reads beside the result: title, heading tree and what the document holds. */
export function outlineNote(tool: string, chars: number, shape: Shape): string {
  const lines = [
    `[input-router] Outline of the ${tool} result (${chars.toLocaleString('en-US')} chars). A map, not the content: use these section names to aim a search or read at the part you need.`,
  ]
  if (shape.title) lines.push(`Title: ${shape.title}`)
  if (shape.headings.length > 0) {
    const top = Math.min(...shape.headings.map(h => h.level))
    lines.push('Sections:')
    for (const h of shape.headings.slice(0, MAX_HEADINGS)) lines.push(`${'  '.repeat(h.level - top + 1)}${h.text}`)
    if (shape.headings.length > MAX_HEADINGS) lines.push(`  (${shape.headings.length - MAX_HEADINGS} more headings)`)
  } else {
    lines.push(`No headings. Opening: ${shape.body.replace(/\s+/g, ' ').trim().slice(0, 300)}`)
  }
  const c = shape.counts
  const holds = [
    c.tables && `${c.tables} table${c.tables === 1 ? '' : 's'}`,
    c.checklist && `${c.checklist} checklist items`,
    c.listItems && `${c.listItems} list items`,
    c.codeBlocks && `${c.codeBlocks} code blocks`,
    c.links && `${c.links} links`,
  ].filter(Boolean)
  if (holds.length > 0) lines.push(`Contains: ${holds.join(', ')}.`)
  const note = lines.join('\n')
  return note.length <= MAX_NOTE ? note : `${note.slice(0, MAX_NOTE)}\n(outline cut)`
}

/** Whether a tool is on the person's synthesis list: comma separated names or parts of names, or `*`. */
export function wantsSynthesis(tool: string, list: string): boolean {
  const t = tool.toLowerCase()
  return list
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .some(s => s === '*' || t.includes(s))
}

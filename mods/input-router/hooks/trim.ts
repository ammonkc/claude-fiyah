// Pure helpers: the deterministic JSON trim, chunking and path checks. No engine calls here.

/** Fields almost no task reads: pictures, styling, html or rich-text copies of a plain field, self links. */
const DROP_KEY =
  /^(avatar\w*|\w*avatar_?urls?|icon_?urls?|\w+_icon_?urls?|thumbnail\w*|\w*thumbnail_?urls?|image_?urls?|\w+_image_?urls?|logo_?urls?|banner(_?url)?|cover_?image(_?url)?|html|\w+_html|html_\w+|renderedFields|rich_?text\w*|\w+_rich_?text|tiptap_\w+|\w+_tiptap_\w+|__typename|etag|_links|self|self_?link|expand)$/i

/** The words of the task, so the trim never drops a field the task names. */
export function wordsOf(text: string): Set<string> {
  const words = new Set<string>()
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? []) {
    words.add(w)
    if (w.endsWith('s')) words.add(w.slice(0, -1))
  }
  return words
}

function isWanted(key: string, words: Set<string>): boolean {
  return key
    .toLowerCase()
    .split(/[_\-.\s]+/)
    .some(part => part.length >= 4 && words.has(part))
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  return typeof v === 'object' && Object.keys(v as object).length === 0
}

export type TrimStats = { removed: Set<string>; unpacked: number; base64: number }

export function newStats(): TrimStats {
  return { removed: new Set(), unpacked: 0, base64: 0 }
}

/** JSON text, parsed; undefined when it is not a JSON object or array. */
export function parseJson(text: string): unknown {
  const s = text.trim()
  if (!/^[[{]/.test(s)) return undefined
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

/** Drops the noise fields and empty values, removes base64 blobs, and unpacks JSON written into a text field. */
export function trimValue(v: unknown, words: Set<string>, stats: TrimStats): unknown {
  if (typeof v === 'string') {
    if (v.length >= 200 && !v.includes(' ') && /^[A-Za-z0-9+/=\r\n]+$/.test(v)) {
      stats.base64 += 1
      return '[base64 removed]'
    }
    if (/^\s*[[{]/.test(v)) {
      const inner = parseJson(v)
      if (inner !== undefined) {
        stats.unpacked += 1
        return trimValue(inner, words, stats)
      }
    }
    return v
  }
  if (Array.isArray(v)) return v.map(x => trimValue(x, words, stats)).filter(x => !isEmpty(x))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (DROP_KEY.test(k) && !isWanted(k, words)) {
        stats.removed.add(k)
        continue
      }
      const kept = trimValue(x, words, stats)
      if (!isEmpty(kept)) out[k] = kept
    }
    return out
  }
  return v
}

/** Compact text of trimmed data; a top-level array gets one record per line so chunks split between records. */
export function render(data: unknown): string {
  return Array.isArray(data) ? data.map(x => JSON.stringify(x)).join('\n') : JSON.stringify(data)
}

/** Splits text into pieces of at most `size` characters, preferring a line or a record boundary. */
export function split(text: string, size: number): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > size) {
    const head = rest.slice(0, size)
    let cut = head.lastIndexOf('\n')
    if (cut < size / 2) cut = head.lastIndexOf('},{') + 1
    if (cut < size / 2) cut = size
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest) out.push(rest)
  return out
}

/** A long text cut to head and tail, so a long request keeps both its start and its end. */
export function middle(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  const half = Math.floor(max / 2)
  return `${t.slice(0, half)}\n[...]\n${t.slice(-half)}`
}

/** The text of a result when it is a string or text blocks only; anything else (images, resources) is not ours to change. */
export function textOf(result: unknown): string[] | undefined {
  if (typeof result === 'string') return [result]
  if (!Array.isArray(result) || result.length === 0) return undefined
  const parts: string[] = []
  for (const block of result) {
    if (!block || typeof block !== 'object' || (block as { type?: unknown }).type !== 'text') return undefined
    parts.push(String((block as { text?: unknown }).text ?? ''))
  }
  return parts
}

/** The path core names in the note it leaves for an oversize MCP result. */
const CORE_NOTE = /Output has been saved to (\/[^\n]+?)\.?\s*(?:\n|$)/
const PERSISTED_NOTE = /Full output saved to: (\/\S+)/

export function notedPath(text: string): string | undefined {
  return (CORE_NOTE.exec(text) ?? PERSISTED_NOTE.exec(text))?.[1]
}

/**
 * Whether a resolved path is a file core saved: `<root>/<project>/<session>/tool-results/<file>`, under the
 * projects folder with every link followed. The path in a tool's own text is never trusted on its own.
 */
export function isCoreSaved(real: string, projectsRoot: string): boolean {
  if (!projectsRoot.startsWith('/') || !real.startsWith(`${projectsRoot}/`)) return false
  const parts = real.slice(projectsRoot.length + 1).split('/')
  return parts.length >= 4 && parts[2] === 'tool-results' && !parts.includes('..') && !parts.includes('')
}

export function safeName(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60)
}

/** A short stable hash for file names (not security). */
export function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}

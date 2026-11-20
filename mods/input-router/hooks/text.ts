// Pure helpers: result text, chunking and path checks. No engine calls here.

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

/** Splits text into pieces of at most `size` characters, preferring a line boundary. */
export function split(text: string, size: number): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > size) {
    const head = rest.slice(0, size)
    let cut = head.lastIndexOf('\n')
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

function blocksText(blocks: readonly unknown[]): string | undefined {
  const parts: string[] = []
  for (const b of blocks) {
    if (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text') parts.push(String((b as { text?: unknown }).text ?? ''))
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}

/** The name of a result's shape, for the log: MCP results are typed `unknown`, so every shape is expected. */
export function shapeOf(result: unknown): string {
  if (typeof result === 'string') return 'string'
  if (Array.isArray(result)) return 'blocks'
  if (result && typeof result === 'object') return Array.isArray((result as { content?: unknown }).content) ? 'content' : 'object'
  return typeof result
}

/**
 * The readable text of an MCP result, whatever its shape: a string, content blocks, an object holding
 * `content` blocks or `structuredContent`, or else the object as JSON. Undefined when there is none.
 * Only read, never written back: the result itself always goes on unchanged.
 */
export function textOf(result: unknown): string | undefined {
  if (typeof result === 'string') return result
  if (Array.isArray(result)) return blocksText(result)
  if (result && typeof result === 'object') {
    const r = result as { content?: unknown; structuredContent?: unknown }
    if (Array.isArray(r.content)) {
      const t = blocksText(r.content)
      if (t !== undefined) return t
    }
    try {
      return JSON.stringify(r.structuredContent ?? result)
    } catch {
      return undefined
    }
  }
  return undefined
}

/** The path core names in the note it leaves for an oversize MCP result. */
const CORE_NOTE = /Output has been saved to (\/[^\n]+?)\.?\s*(?:\n|$)/
const PERSISTED_NOTE = /Full output saved to: (\/\S+)/

export function notedPath(text: string): string | undefined {
  return (CORE_NOTE.exec(text) ?? PERSISTED_NOTE.exec(text))?.[1]
}

/**
 * Whether a resolved path is a file core saved: `<root>/<project>/<session>/tool-results/<file>`, under the
 * projects folder with every link followed, and `<session>` is the current session. The path in a tool's own
 * text is never trusted on its own.
 */
export function isCoreSaved(real: string, projectsRoot: string, sessionId: string): boolean {
  if (!sessionId || !projectsRoot.startsWith('/') || !real.startsWith(`${projectsRoot}/`)) return false
  const parts = real.slice(projectsRoot.length + 1).split('/')
  return parts.length >= 4 && parts[1] === sessionId && parts[2] === 'tool-results' && !parts.includes('..') && !parts.includes('')
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

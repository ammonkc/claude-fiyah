export type Entry = { x: string; y: string; path: string; orig?: string }
export type Group = { message: string; files: string[] }
export type PlanStep = { title: string; status: 'open' | 'done' | 'failed' }
export type PlanState = Record<string, PlanStep[]>

const CONVENTIONAL = /^[a-z]+(\([^)]+\))?!?: \S.*$/
const SECRET =
  /(^|\/)(\.env(\..+)?|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519)|credentials(\.json)?|\.npmrc|[^/]*secret[^/]*)$/i
const SECRET_OK = /\.(example|sample|template|dist)$/i

export function isSecretPath(path: string): boolean {
  return SECRET.test(path) && !SECRET_OK.test(path)
}

export function parsePorcelain(out: string): Entry[] {
  const parts = out.split('\0')
  const entries: Entry[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]

    if (part.length < 4) continue

    const x = part[0]
    const y = part[1]
    const path = part.slice(3)

    if (x === 'R' || x === 'C') {
      entries.push({ x, y, path, orig: parts[++i] })
    } else {
      entries.push({ x, y, path })
    }
  }

  return entries
}

export function statusKey(entries: readonly Entry[]): string {
  return entries.map(e => `${e.x}${e.y} ${e.path}`).join('\n')
}

export function cleanLine(text: string): string {
  const first = text
    .trim()
    .replace(/^```\w*\n?/, '')
    .split('\n')[0]
    .trim()

  return first.replace(/^["'`]+|["'`]+$/g, '').trim()
}

export function isConventional(message: string): boolean {
  return CONVENTIONAL.test(message)
}

function extractJsonArray(raw: string): unknown {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')

  if (start === -1 || end <= start) return undefined

  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return undefined
  }
}

export function parseGroups(raw: string, changed: readonly string[]): Group[] | null {
  const known = new Set(changed)
  const parsed = extractJsonArray(raw)

  if (Array.isArray(parsed)) {
    const used = new Set<string>()
    const groups: Group[] = []

    for (const item of parsed) {
      const message = typeof item?.message === 'string' ? cleanLine(item.message) : ''
      const files: unknown = item?.files

      if (!isConventional(message) || !Array.isArray(files)) return null

      const mine = files.filter(
        (f): f is string => typeof f === 'string' && known.has(f) && !used.has(f),
      )

      mine.forEach(f => used.add(f))

      if (mine.length > 0) groups.push({ message, files: mine })
    }

    if (groups.length === 0) return null

    const rest = changed.filter(f => !used.has(f))

    if (rest.length > 0) groups[groups.length - 1].files.push(...rest)

    return groups
  }

  const line = cleanLine(raw)

  return isConventional(line) && changed.length > 0
    ? [{ message: line, files: [...changed] }]
    : null
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[truncated ${text.length - max} chars]`
}

export function buildDiffContext(stat: string, diff: string, max: number): string {
  return `${stat}\n\n${clip(diff, Math.max(0, max - stat.length))}`
}

export function splitPr(text: string): { title: string; body: string } {
  const lines = text.trim().split('\n')
  const title = cleanLine(lines[0] ?? '')
  const body = lines.slice(1).join('\n').trim()

  return { title, body }
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}

function stepsOf(args: Record<string, unknown>, previous: PlanStep[]): PlanStep[] | undefined {
  const stages = Array.isArray(args.stages) ? args.stages : undefined
  const flat = Array.isArray(args.steps) ? args.steps : undefined
  const raw = stages ? stages.flatMap(s => (Array.isArray(asRecord(s).steps) ? (asRecord(s).steps as unknown[]) : [])) : flat

  if (!raw) return undefined

  const before = new Map(previous.map(s => [s.title, s.status]))

  return raw.map(item => {
    const step = asRecord(item)
    const title = String(step.title ?? '')
    const given = String(step.status ?? '')
    const status: PlanStep['status'] =
      given === 'done' || given === 'completed'
        ? 'done'
        : given === 'failed'
          ? 'failed'
          : (before.get(title) ?? 'open')

    return { title, status }
  })
}

export function reducePlan(state: PlanState, input: unknown): PlanState {
  const args = asRecord(input)
  const id = typeof args.id === 'string' ? args.id : 'plan'
  const current = state[id] ?? []
  const rebuilt = stepsOf(args, current)
  let steps = (rebuilt ?? current).map(s => ({ ...s }))

  if (args.next === true) {
    const open = steps.find(s => s.status === 'open')

    if (open) open.status = 'done'
  }

  if (Array.isArray(args.done)) {
    const titles = new Set(args.done.map(String))

    steps = steps.map(s => (titles.has(s.title) ? { ...s, status: 'done' } : s))
  }

  if (typeof args.failed === 'string') {
    steps = steps.map(s => (s.title === args.failed ? { ...s, status: 'failed' } : s))
  }

  return { ...state, [id]: steps }
}

export function openSteps(state: PlanState): number {
  return Object.values(state)
    .flat()
    .filter(s => s.status === 'open').length
}

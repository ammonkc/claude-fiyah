export type Entry = { x: string; y: string; path: string; orig?: string }
export type Group = { message: string; files: string[] }
export type PlanStep = { title: string; status: 'open' | 'done' | 'failed' }
export type PlanState = Record<string, PlanStep[]>

const CONVENTIONAL = /^[a-z]+(\([^)]+\))?!?: \S.*$/
const SECRET =
  /(^|\/)(\.env(\..+)?|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519)|credentials(\.json)?|\.npmrc)$/i
// Any name with "secret" in it, except source code about secrets (secrets.ts, secret-manager.py).
const SECRET_NAME = /(^|\/)[^/]*secret[^/]*$/i
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|php|swift|cs|c|h|cpp|vue|svelte|md)$/i
const SECRET_OK = /\.(example|sample|template|dist)$/i

// -uall lists the files inside a new directory one by one, so each can be checked against SECRET.
export const STATUS_ARGS = ['status', '--porcelain=v1', '-z', '-uall']

export function isSecretPath(path: string): boolean {
  return (SECRET.test(path) || (SECRET_NAME.test(path) && !SOURCE.test(path))) && !SECRET_OK.test(path)
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

export function excludeSpec(paths: readonly string[]): string[] {
  const secrets = paths.filter(isSecretPath).map(p => `:(exclude,literal)${p}`)

  return secrets.length > 0 ? ['--', '.', ...secrets] : []
}

export type GitRun = (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>

// Commits each group in turn. A failure part way reports the groups already committed.
export async function commitGroups(run: GitRun, groups: readonly Group[], entries: readonly Entry[]): Promise<string[]> {
  const byPath = new Map(entries.map(e => [e.path, e]))
  const done: string[] = []
  const fail = (what: string, r: { stderr: string; stdout: string }) => {
    const already = done.length > 0 ? `\n\nAlready committed:\n${done.join('\n')}` : ''

    return new Error(`${what}:\n${r.stderr || r.stdout}${already}`)
  }

  for (const group of groups) {
    const picked = group.files
      .map(f => byPath.get(f))
      .filter((e): e is Entry => e !== undefined && !isSecretPath(e.path))
    const addable = picked.filter(e => e.x !== 'D' && e.y !== 'D').map(e => e.path)
    const commitPaths = picked.flatMap(e => (e.orig ? [e.path, e.orig] : [e.path]))

    if (commitPaths.length === 0) continue

    if (addable.length > 0) {
      const added = await run(['--literal-pathspecs', 'add', '--', ...addable])

      if (added.exitCode !== 0) throw fail('git add failed', added)
    }

    const committed = await run(['--literal-pathspecs', 'commit', '-m', group.message, '--', ...commitPaths])

    if (committed.exitCode !== 0) throw fail('git commit failed', committed)

    const sha = await run(['rev-parse', '--short', 'HEAD'])

    done.push(`${sha.stdout.trim()} ${group.message}`)
  }

  return done
}

import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Group, OutputKind } from '../types'
import {
  buildDiffContext,
  clip,
  isSecretPath,
  openSteps,
  parseGroups,
  parsePorcelain,
  reducePlan,
  splitPr,
  statusKey,
} from './git'
import type { Entry, PlanState } from './git'

type Dollar = Parameters<Hook<'turn.start'>>[0]

const visible = atom({ plugin: 'git-actions', key: 'visible' } as const, false)
const busy = atom({ plugin: 'git-actions', key: 'busy' } as const, null)
const output = atom({ plugin: 'git-actions', key: 'output' } as const, null)
const groupsAtom = atom({ plugin: 'git-actions', key: 'groups' } as const, null)
const groupsKey = atom({ plugin: 'git-actions', key: 'groupsKey' } as const, '')
const prDesc = atom({ plugin: 'git-actions', key: 'prDesc' } as const, null)
const prKey = atom({ plugin: 'git-actions', key: 'prKey' } as const, '')
const dirty = atom({ plugin: 'git-actions', key: 'dirty' } as const, 0)
const ahead = atom({ plugin: 'git-actions', key: 'ahead' } as const, 0)
const branch = atom({ plugin: 'git-actions', key: 'branch' } as const, '')
const prUrl = atom({ plugin: 'git-actions', key: 'prUrl' } as const, '')

const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$|__smart_(edit|write)$/
const PLAN_TOOL = /__plan_progress$/
const DIFF_MAX = 60000

const COMMIT_RULES = `You write git commit messages.
Format: <type>(scope): description. type is a conventional commit type (feat, fix, refactor, test, chore, docs, ci, perf, style, build). scope is the area of the codebase. description is short, imperative, lowercase, no trailing period. Keep it tight.
Use exactly one group unless the changes clearly span unrelated concerns; then split into logically grouped commits.
Reply with ONLY a JSON array: [{"message": "<type>(scope): description", "files": ["path", ...]}]. Every changed file must appear in exactly one group. Use the file paths exactly as listed.`

const PR_RULES = `You write GitHub pull request descriptions.
Line 1: the PR title in the form <type>(scope): description (short, imperative, lowercase).
Then a blank line, then "## Summary" followed by 1 to 5 concise bullets on what changed and why.
Rules: no "Test plan" section. Never mention Claude, AI or code generation. Never use dashes (the characters - or an em dash) as punctuation; rephrase with periods, commas or parentheses. Bullet markers are fine. Reply with the description only.`

const REVIEW_RULES = `You review a git diff for real defects: correctness bugs, security problems, missing error handling at boundaries, broken edge cases. No praise, no style nits.
Reply in markdown as a bullet list, one finding per bullet: "- \`path\`: **severity**: problem. fix." where severity is high, medium or low. If nothing is wrong reply exactly "No issues found."`

let editedSinceReset = false
let plan: PlanState = {}
let turns = 0
let planTouchedAt = 0
let keyAtStart = ''
const PLAN_STALE_TURNS = 3

async function treeKey($: Dollar): Promise<string> {
  const st = await git($, ['status', '--porcelain=v1', '-z'])

  return st.exitCode === 0 ? statusKey(parsePorcelain(st.stdout)) : ''
}

async function git($: Dollar, args: string[], init?: { stdin?: string; timeoutMs?: number }) {
  return $.process.run(['git', ...args], init)
}

const KIND_COLOR: Record<OutputKind, string> = {
  commit: 'permission',
  pr: 'permission',
  review: 'warning',
  done: 'success',
  error: 'error',
  info: 'inactive',
}

async function setOutput($: Dollar, title: string, text: string, kind: OutputKind = 'info', copy?: string) {
  await update($, output, () => ({ title, text, kind, copy }))
}

async function findBase($: Dollar): Promise<string | null> {
  const head = await git($, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])

  if (head.exitCode === 0 && head.stdout.trim()) return head.stdout.trim()

  for (const name of ['origin/main', 'origin/master']) {
    const ok = await git($, ['rev-parse', '--verify', '--quiet', name])

    if (ok.exitCode === 0) return name
  }

  return null
}

async function refresh($: Dollar) {
  const st = await git($, ['status', '--porcelain=v1', '-z'])
  const entries = st.exitCode === 0 ? parsePorcelain(st.stdout) : []
  const base = st.exitCode === 0 ? await findBase($) : null
  let count = 0

  if (base) {
    const r = await git($, ['rev-list', '--count', `${base}..HEAD`])

    count = Number(r.stdout.trim()) || 0
  }

  const name = st.exitCode === 0 ? (await git($, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim() : ''

  await update($, dirty, () => entries.length)
  await update($, ahead, () => count)
  if ((await read($, branch)) !== name) await update($, prUrl, () => '')

  await update($, branch, () => name)

  return { entries, base, ahead: count }
}

function pathspec(entries: readonly Entry[]): string[] {
  const secrets = entries.filter(e => isSecretPath(e.path)).map(e => `:(exclude)${e.path}`)

  return secrets.length > 0 ? ['--', '.', ...secrets] : []
}

async function untrackedHeads($: Dollar, entries: readonly Entry[]): Promise<string> {
  const fresh = entries.filter(e => e.x === '?' && !isSecretPath(e.path) && !e.path.endsWith('/'))
  const parts: string[] = []

  for (const e of fresh.slice(0, 8)) {
    const r = await $.process.run(['head', '-n', '40', '--', e.path])

    if (r.exitCode === 0) parts.push(`--- new file ${e.path} ---\n${r.stdout}`)
  }

  const names = entries.filter(e => e.x === '?').map(e => e.path)

  return `${names.length > 0 ? `Untracked: ${names.join(', ')}\n` : ''}${parts.join('\n')}`
}

async function ask($: Dollar, system: string, prompt: string, maxTokens: number): Promise<string> {
  const r = await $.model.complete({ model: 'haiku', system, prompt, maxTokens })

  if (!r.isAnswered) throw new Error(`model call failed: ${r.reason}`)

  return r.text.trim()
}

async function ensureGroups($: Dollar): Promise<{ groups: Group[]; entries: Entry[] } | null> {
  const { entries } = await refresh($)

  if (entries.length === 0) {
    await setOutput($, 'Commit', 'Nothing to commit.', 'info')

    return null
  }

  const key = statusKey(entries)
  const cached = await read($, groupsAtom)

  if (cached && (await read($, groupsKey)) === key) return { groups: cached, entries }

  const spec = pathspec(entries)
  const stat = await git($, ['diff', 'HEAD', '--stat', ...spec])
  const diff = await git($, ['diff', 'HEAD', ...spec])
  const fresh = await untrackedHeads($, entries)
  const changed = entries.filter(e => !isSecretPath(e.path)).map(e => e.path)
  const prompt = `Changed files:\n${changed.join('\n')}\n\n${buildDiffContext(stat.stdout, `${diff.stdout}\n${fresh}`, DIFF_MAX)}`
  const reply = await ask($, COMMIT_RULES, prompt, 1500)
  const groups = parseGroups(reply, changed)

  if (!groups) throw new Error(`model returned an unusable commit message:\n${clip(reply, 400)}`)

  await update($, groupsAtom, () => groups)
  await update($, groupsKey, () => key)

  return { groups, entries }
}

function renderGroups(groups: readonly Group[]): string {
  return groups
    .map(g => `${g.message}\n${g.files.map(f => `  ${f}`).join('\n')}`)
    .join('\n\n')
}

async function showCommitMessage($: Dollar) {
  const made = await ensureGroups($)

  if (made) await setOutput($, 'Commit message', renderGroups(made.groups), 'commit', made.groups.map(g => g.message).join('\n'))
}

async function commitAll($: Dollar) {
  const made = await ensureGroups($)

  if (!made) return

  const byPath = new Map(made.entries.map(e => [e.path, e]))
  const done: string[] = []
  const skipped = made.entries.filter(e => isSecretPath(e.path)).map(e => e.path)

  for (const group of made.groups) {
    const picked = group.files.map(f => byPath.get(f)).filter((e): e is Entry => e !== undefined)
    const addable = picked.filter(e => e.x !== 'D' && e.y !== 'D').map(e => e.path)
    const commitPaths = picked.flatMap(e => (e.orig ? [e.path, e.orig] : [e.path]))

    if (addable.length > 0) {
      const added = await git($, ['add', '--', ...addable])

      if (added.exitCode !== 0) throw new Error(`git add failed:\n${added.stderr}`)
    }

    const committed = await git($, ['commit', '-m', group.message, '--', ...commitPaths])

    if (committed.exitCode !== 0) {
      throw new Error(`git commit failed:\n${committed.stderr || committed.stdout}`)
    }

    const sha = await git($, ['rev-parse', '--short', 'HEAD'])

    done.push(`${sha.stdout.trim()} ${group.message}`)
  }

  editedSinceReset = false
  await update($, groupsAtom, () => null)
  await update($, prDesc, () => null)
  await refresh($)

  const note = skipped.length > 0 ? `\n\nSkipped (look like secrets): ${skipped.join(', ')}` : ''

  await setOutput($, 'Committed', `${done.join('\n')}${note}`, 'done')
}

async function prContext($: Dollar): Promise<{ base: string; context: string; key: string } | null> {
  const { entries, base, ahead: count } = await refresh($)

  if (!base) {
    await setOutput($, 'PR', 'No base branch found (origin/HEAD, origin/main, origin/master).')

    return null
  }

  if (count === 0 && entries.length === 0) {
    await setOutput($, 'PR', `No changes against ${base}.`)

    return null
  }

  const log = await git($, ['log', `${base}..HEAD`, '--format=%s%n%b---'])
  const stat = await git($, ['diff', `${base}...HEAD`, '--stat'])
  const diff = await git($, ['diff', `${base}...HEAD`])
  const head = await git($, ['rev-parse', 'HEAD'])
  let context = `Commits:\n${log.stdout}\n\n${buildDiffContext(stat.stdout, diff.stdout, DIFF_MAX)}`

  if (entries.length > 0) {
    const spec = pathspec(entries)
    const extra = await git($, ['diff', 'HEAD', ...spec])

    context += `\n\nUncommitted changes:\n${clip(extra.stdout, 15000)}`
  }

  return { base, context, key: `${head.stdout.trim()}\n${statusKey(entries)}` }
}

async function ensurePrDesc($: Dollar): Promise<string | null> {
  const ctx = await prContext($)

  if (!ctx) return null

  const cached = await read($, prDesc)

  if (cached && (await read($, prKey)) === ctx.key) return cached

  const text = await ask($, PR_RULES, ctx.context, 1200)

  await update($, prDesc, () => text)
  await update($, prKey, () => ctx.key)

  return text
}

async function syncPrUrl($: Dollar) {
  const r = await $.process.run(['gh', 'pr', 'view', '--json', 'url', '--jq', '.url'], { timeoutMs: 20000 })

  await update($, prUrl, () => (r.exitCode === 0 ? r.stdout.trim() : ''))
}

async function showPr($: Dollar, text: string) {
  await syncPrUrl($)

  const { title, body } = splitPr(text)

  await setOutput($, 'PR description', `**${title}**\n\n${body}`, 'pr', text)
}

async function showPrDescription($: Dollar) {
  const text = await ensurePrDesc($)

  if (text) await showPr($, text)
}

async function createPr($: Dollar) {
  const { entries, base } = await refresh($)

  if (entries.length > 0) {
    await setOutput($, 'Create PR', 'Uncommitted changes exist. Commit first.')

    return
  }

  if (!base) {
    await setOutput($, 'Create PR', 'No base branch found.')

    return
  }

  const branch = (await git($, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
  const baseName = base.replace(/^origin\//, '')

  if (branch === baseName || branch === 'HEAD') {
    await setOutput($, 'Create PR', `On ${branch}. Switch to a feature branch first.`)

    return
  }

  const text = await ensurePrDesc($)

  if (!text) return

  const { title, body } = splitPr(text)
  const pushed = await git($, ['push', '-u', 'origin', 'HEAD'], { timeoutMs: 120000 })

  if (pushed.exitCode !== 0) throw new Error(`git push failed:\n${pushed.stderr}`)

  const created = await $.process.run(
    ['gh', 'pr', 'create', '--base', baseName, '--title', title, '--body-file', '-'],
    { stdin: body, timeoutMs: 60000 },
  )

  if (created.exitCode !== 0) throw new Error(`gh pr create failed:\n${created.stderr || created.stdout}`)

  const url = created.stdout.trim().split('\n').pop() ?? ''

  $.ui.toast(`PR created: ${url}`)
  await update($, prUrl, () => url)
  await setOutput($, 'PR created', `${url}\n\n**${title}**`, 'done')
}

async function reviewPr($: Dollar) {
  const ctx = await prContext($)

  if (!ctx) return

  const reply = await ask($, REVIEW_RULES, ctx.context, 2000)

  await setOutput($, `Review vs ${ctx.base}`, reply, 'review')
}

async function runAction($: Dollar, label: string, fn: () => Promise<void>) {
  if ((await read($, busy)) !== null) {
    $.ui.toast('Still working, wait for it to finish')

    return
  }

  await update($, busy, () => label)
  await update($, output, () => null)

  try {
    await fn()
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)

    await setOutput($, `${label} failed`, text, 'error')
    $.ui.toast(`${label} failed`)
  } finally {
    await update($, busy, () => null)
  }
}

async function hideBand($: Dollar) {
  editedSinceReset = false
  await update($, visible, () => false)
  await update($, output, () => null)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'git-actions',
      description: 'Show the git actions band (commit, PR description, create PR, review)',
    })

    return next(e)
  })

  on('command.run', { command: 'git-actions' }, async $ => {
    const { entries, ahead: count } = await refresh($)

    if (entries.length === 0 && count === 0) {
      return { text: 'Nothing to commit and no commits ahead of the base branch.' }
    }

    await update($, visible, () => true)

    return { text: 'Git actions band shown.' }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)

    if (EDIT_TOOLS.test(tool)) editedSinceReset = true
    if (PLAN_TOOL.test(tool)) {
      plan = reducePlan(plan, e)
      planTouchedAt = turns
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if ((await read($, busy)) === null) await update($, visible, () => false)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    keyAtStart = await treeKey($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const isMain = e.agentId === undefined

    if (isMain) turns += 1

    const isPlanOpen = openSteps(plan) > 0 && turns - planTouchedAt <= PLAN_STALE_TURNS

    if (isMain && e.reason === 'answer' && !isPlanOpen) {
      const { entries } = await refresh($)

      if (entries.length > 0 && statusKey(entries) !== keyAtStart) editedSinceReset = true

      if (entries.length > 0 && editedSinceReset) {
        editedSinceReset = false
        await update($, output, () => null)
        await update($, visible, () => true)
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isShown = await read($, visible)

    if (e.props.hasSurvey || !isShown) return next(e)

    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const working = await read($, busy)
    const out = await read($, output)
    const changes = await read($, dirty)
    const commits = await read($, ahead)
    const name = await read($, branch)
    const openPr = await read($, prUrl)
    const lines = out ? out.text.split('\n') : []
    const go = (label: string, fn: () => Promise<void>) => () => runAction($, label, fn)

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="promptBorder" paddingX={1}>
        <Box gap={1}>
          <Text bold color="inverseText" backgroundColor="permission">
            {' git '}
          </Text>
          <Text bold>{name || 'no branch'}</Text>
          <Text color={changes > 0 ? 'warning' : 'success'}>
            {changes > 0 ? `\u25CF ${changes} changed` : '\u2713 clean'}
          </Text>
          {commits > 0 && <Text color="success">{`\u2191 ${commits} ahead`}</Text>}
          {working && <Text color="suggestion">{`\u25CC ${working}...`}</Text>}
        </Box>
        <Box gap={1}>
          {changes > 0 && <Button key="msg" label="[c] Commit message" hotkey="c" onPress={go('Commit message', () => showCommitMessage($))} />}
          <Button key="prd" label="[p] PR description" hotkey="p" onPress={go('PR description', () => showPrDescription($))} />
          <Button key="review" label="[r] Review" hotkey="r" onPress={go('Review', () => reviewPr($))} />
          <Button key="dismiss" label="[d] Dismiss" hotkey="d" role="dismiss" dimColor onPress={() => hideBand($)} />
          <Text dimColor>{'ctrl+x tab to focus'}</Text>
        </Box>
        {out && (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={KIND_COLOR[out.kind]}
            paddingX={1}
            marginTop={1}
          >
            <Text bold color={KIND_COLOR[out.kind]}>
              {out.title}
            </Text>
            {out.kind === 'commit' &&
              lines.map(line =>
                line.startsWith('  ') ? (
                  <Text dimColor>{line}</Text>
                ) : (
                  <Text bold color="success">
                    {line}
                  </Text>
                ),
              )}
            {(out.kind === 'pr' || out.kind === 'review' || out.kind === 'done') && <Markdown text={out.text} />}
            {(out.kind === 'error' || out.kind === 'info') && lines.map(line => <Text>{line}</Text>)}
            {out.kind === 'pr' && openPr && <Text color="success">{`\u2713 PR already open: ${openPr}`}</Text>}
            <Box gap={1} marginTop={1}>
              <Button
                key="out-copy"
                label="[y] Copy"
                hotkey="y"
                onPress={async press => {
                  const r = await $.ui.copy({ text: out.copy ?? out.text, surface: press.surface })

                  $.ui.toast(r.isCopied ? 'Copied' : `copy failed: ${r.reason}`)
                }}
              />
              {out.kind === 'commit' && (
                <Button key="out-commit" label="[a] Commit" hotkey="a" variant="primary" onPress={go('Commit', () => commitAll($))} />
              )}
              {out.kind === 'pr' && !openPr && (
                <Button key="out-pr" label="[a] Create PR" hotkey="a" variant="primary" onPress={go('Create PR', () => createPr($))} />
              )}
              <Button key="out-close" label="[x] Close" hotkey="x" dimColor onPress={() => update($, output, () => null)} />
            </Box>
          </Box>
        )}
      </Box>
    )
  })
}

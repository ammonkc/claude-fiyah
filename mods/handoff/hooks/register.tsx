import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HandoffView } from '../types'
import { composeNote, handoffPrompt, missingSections, newestNote, noteDirOf, sectionsOf, shortPath, stampOf } from './note'
import type { GitFacts } from './note'
import { paneFailure } from './render-safe'

const PANE = 'handoff'
const GIT_TIMEOUT_MS = 10_000
const STATUS_LINES = 40
const STAT_LINES = 30
const MAX_SUFFIX = 20
const RESUME_PREAMBLE = 'Continue from this handoff:'

const IDLE: HandoffView = { status: 'idle', path: '', text: '', detail: '', isCopied: false }
const viewAtom = atom({ plugin: 'handoff', key: 'view' } as const, IDLE)

type Settings = { dir: string; copy: boolean }

/** A failure's detail is a lowercase clause; as a command answer it starts a sentence. */
const asSentence = (clause: string): string => clause.charAt(0).toUpperCase() + clause.slice(1)

const capLines = (text: string, max: number): string => {
  const lines = text.trimEnd().split('\n').filter(line => line.trim() !== '')
  return lines.length > max ? [...lines.slice(0, max), `… ${lines.length - max} more`].join('\n') : lines.join('\n')
}

async function git($: EngineInterface, args: readonly string[]): Promise<string | undefined> {
  try {
    const run = await $.process.run(['git', ...args], { timeoutMs: GIT_TIMEOUT_MS })
    return run.exitCode === 0 ? run.stdout : undefined
  } catch {
    return undefined
  }
}

async function gitFacts($: EngineInterface): Promise<GitFacts | undefined> {
  const branch = (await git($, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim()
  if (branch === undefined) return undefined
  return {
    branch,
    status: capLines((await git($, ['status', '--short'])) ?? '', STATUS_LINES),
    diffStat: capLines((await git($, ['diff', '--stat', 'HEAD'])) ?? '', STAT_LINES),
    commits: capLines((await git($, ['log', '-5', '--format=%h %s'])) ?? '', 5),
  }
}

/** The home folder: HOME, else the part of this plugin's own path before `/.claude/` (an installed plugin lives under it). */
async function homeOf($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get('HOME').catch(() => undefined)
  if (home !== undefined && home.trim() !== '') return home.trim()
  const root = $.plugin.root
  return root.includes('/.claude/') ? root.split('/.claude/')[0] || undefined : undefined
}

/** `2026-10-07-1342.md`, or `-2`, `-3`… when that minute already has one. */
async function freePath($: EngineInterface, dir: string, stamp: string): Promise<string> {
  for (let n = 1; n <= MAX_SUFFIX; n += 1) {
    const path = `${dir}/${stamp}${n === 1 ? '' : `-${n}`}.md`
    if (!(await $.fs.exists(path))) return path
  }
  return `${dir}/${stamp}-${await $.clock.now()}.md`
}

async function writeHandoff($: EngineInterface, settings: Settings, note: string): Promise<HandoffView> {
  const set = async (view: HandoffView): Promise<HandoffView> => {
    await update($, viewAtom, () => view)
    return view
  }
  const failed = (detail: string) => set({ ...IDLE, status: 'error', detail })
  await set({ ...IDLE, status: 'writing', detail: 'Reading the session and git…' })
  const root = await $.session.root()
  const home = await homeOf($)
  const dir = noteDirOf({ setting: settings.dir, home, root })
  if (dir === undefined) return failed('could not find your home folder: set the notes folder to an absolute path.')
  const facts = await gitFacts($)
  const reply = await $.model.fork({ prompt: handoffPrompt(facts, note) })
  if (!reply.isAnswered) {
    return failed(
      reply.reason === 'nothing-to-fork' ? 'nothing to hand off yet: this conversation has no work in it.'
        : reply.reason === 'api-error' ? `the model call failed (${reply.error}).`
          : reply.reason === 'aborted' ? 'writing the note was interrupted.'
            : 'the model wrote nothing.',
    )
  }
  const when = await $.clock.now()
  const sessionId = await $.session.id().catch(() => undefined)
  const text = composeNote(sectionsOf(reply.text), { when, branch: facts?.branch, sessionId })
  let absolute: string
  try {
    absolute = await freePath($, dir, stampOf(when))
    await $.fs.write(absolute, text)
  } catch (error) {
    return failed(`could not write the note (${error instanceof Error ? error.message : String(error)}).`)
  }
  const isCopied = settings.copy && (await $.ui.copy({ text }).catch(() => ({ isCopied: false }))).isCopied
  const missing = missingSections(text)
  return set({
    status: 'ready',
    path: shortPath(absolute, home),
    text,
    isCopied,
    detail: missing.length === 0 ? '' : `Missing sections: ${missing.join(', ')}.`,
  })
}

/** `/handoff resume`: fills the prompt with this project's newest note. */
async function resume($: EngineInterface, settings: Settings): Promise<string> {
  const root = await $.session.root()
  const home = await homeOf($)
  const dir = noteDirOf({ setting: settings.dir, home, root })
  if (dir === undefined) return 'Could not find your home folder: set the notes folder to an absolute path.'
  const entries = await $.fs.list(dir).catch(() => [])
  const name = newestNote(entries.filter(entry => entry.kind === 'file').map(entry => entry.name))
  if (name === undefined) return `No handoff notes for this project yet in ${shortPath(dir, home)}. Run /handoff first.`
  const path = `${dir}/${name}`
  const note = await $.fs.read(path).catch(() => undefined)
  if (note === undefined) return `Could not read ${shortPath(path, home)}.`
  await $.prompt.fill({ text: `${RESUME_PREAMBLE}\n\n${note.trim()}\n` })
  return `Filled the prompt with ${shortPath(path, home)}. Press Enter to continue from it.`
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    dir: String(options.dir ?? '').trim(),
    copy: options.copy !== false,
  }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'handoff',
        description: 'Write a handoff note (goal, status, changes, next steps) and copy it; /handoff resume continues from the newest one',
        argumentHint: '[what to stress | resume]',
      })
    } catch (error) {
      // A refused name (Claude Code's own, or another mod's) is reported, never thrown, so session.start still runs.
      $.ui.log(`${$.plugin.name}: /handoff was not registered (${error instanceof Error ? error.message : String(error)}).`)
    }
    return next(e)
  })

  // A /clear ends the session's conversation: the saved note is no longer "the latest handoff of this session".
  on('session.end', async ($, e, next) => {
    await update($, viewAtom, () => IDLE)
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'resume') return { text: await resume($, settings) }
    await $.ui.open({ id: PANE, title: 'Handoff', rows: 24 })
    const view = await writeHandoff($, settings, e.args.trim())
    if (view.status !== 'ready') {
      await $.ui.close({ id: PANE })
      return { text: asSentence(view.detail) }
    }
    const copied = view.isCopied ? ' and copied it to the clipboard' : settings.copy ? ' (the clipboard was not reachable; use Copy in the pane)' : ''
    return { text: `Wrote ${view.path}${copied}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const view = await read($, viewAtom)
    if (view.status === 'idle' || view.status === 'writing') {
      return <Text color="suggestion">{view.detail === '' ? 'Writing the handoff note…' : view.detail}</Text>
    }
    const copy = async (surface: typeof e.surface) => {
      const copied = await $.ui.copy({ text: view.text, surface })
      $.ui.toast(copied.isCopied ? 'Note copied' : `Could not copy (${copied.reason})`)
    }

    return (
      <Box flexDirection="column" gap={1}>
        {view.status === 'error' ? (
          <Text color="error">{view.detail}</Text>
        ) : (
          <Box flexDirection="column">
            <Text bold wrap="truncate-end">{`Saved to ${view.path}`}</Text>
            <Text dimColor>{view.isCopied ? 'Copied to the clipboard.' : 'Use Copy to put it on the clipboard.'}</Text>
            {view.detail !== '' && <Text color="warning">{view.detail}</Text>}
          </Box>
        )}
        {view.status === 'ready' && <Markdown key="note" text={view.text} />}
        <Box gap={1}>
          {view.status === 'ready' && <Button key="copy" label="Copy" hotkey="c" variant="primary" onPress={press => void copy(press.surface)} />}
          <Button key="close" label="Close" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  }).catch(($, e, next) => paneFailure($.ui.resolve(e), { title: 'handoff', failure: next.error, onRetry: () => $.ui.invalidate('ui.render') }))
}

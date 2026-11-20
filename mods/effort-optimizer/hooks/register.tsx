import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Level } from '../types'
import { asLevel, asMode, isJudgeable, isWorthSwitching, judgePrompt, type Mode, parsePick } from './policy'

const BAND = { plugin: 'effort-optimizer', key: 'band' } as const
const OVERRIDE = { plugin: 'effort-optimizer', key: 'override' } as const
const ACCENT = '#d97757'

// Module variables reset on a reload; the band and the override live in $.state.
let mode: Mode | null = null
let minConfidence = 0.6
let cooldownTurns = 3
let defaultMode: Mode = 'suggest'
// Bumped on every judged prompt, so a slow judge for an older prompt is dropped.
let gen = 0
// Judged prompts since the last suggestion (starts high: no cooldown at first).
let sinceSuggest = Number.MAX_SAFE_INTEGER
// The level the main chat's requests ask for, before this mod touches them.
let seen: Level | '' = ''
// The level the picker was at when the override took hold. null: adopt the next request's level.
let base: Level | '' | null = null

// Past this size the log moves to `effort-optimizer.log.1` at session start.
const LOG_MAX_BYTES = 256 * 1024

// The log folder's home comes from $HOME alone, never from the plugin's own path (under --plugin-dir that is the repo).
async function logFile($: EngineInterface): Promise<string> {
  const h = ((await $.env.get('HOME')) ?? '').replace(/\/+$/, '')
  return h.startsWith('/') ? `${h}/.claude/mods-logs/effort-optimizer.log` : ''
}

// Appended through /bin/sh, so two lines written at once cannot overwrite each other.
async function log($: EngineInterface, line: string) {
  try {
    const path = await logFile($)
    if (!path) return
    await $.process.run(['/bin/sh', '-c', 'mkdir -p "$(dirname "$1")" && cat >> "$1"', 'sh', path], {
      stdin: `${new Date(await $.clock.now()).toISOString()} ${line}\n`,
      timeoutMs: 5_000,
    })
  } catch {
    // Nowhere left to report it.
  }
}

async function rotateLog($: EngineInterface) {
  try {
    const path = await logFile($)
    if (!path) return
    const st = await $.fs.stat(path)
    if (st.size > LOG_MAX_BYTES) await $.process.run(['/bin/mv', '-f', path, `${path}.1`], { timeoutMs: 5_000 })
  } catch {
    // No log yet.
  }
}

async function getMode($: EngineInterface): Promise<Mode> {
  if (mode) return mode
  try {
    mode = asMode(await $.store.get('mode')) ?? defaultMode
  } catch {
    mode = defaultMode
  }
  return mode
}

// The level the chat runs at now: the override, else the last request's, else the effort setting (read only).
async function currentLevel($: EngineInterface): Promise<Level | ''> {
  const { value } = await $.state.get(OVERRIDE)
  if (value) return value
  if (seen) return seen
  try {
    const rows = await $.config.list()
    const row = rows.find(r => r.kind === 'choice' && /effort/i.test(`${r.key} ${r.label}`))
    return row ? asLevel(row.value) : ''
  } catch {
    return ''
  }
}

function lastAssistantText(messages: readonly SessionMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!
    if (m.role === 'assistant' && m.text.trim()) return m.text
  }
  return ''
}

async function setOverride($: EngineInterface, level: Level | null) {
  base = level ? seen || null : null
  await $.state.set(OVERRIDE, level)
}

// Runs after the prompt was submitted, so it never delays the turn.
async function judge($: EngineInterface, text: string, mine: number) {
  const now = await currentLevel($)
  const messages = await $.session.messages()
  const r = await $.model.complete({
    model: 'haiku',
    prompt: judgePrompt(text, lastAssistantText(messages), now),
    maxTokens: 120,
    effort: 'low',
    timeoutMs: 10_000,
  })
  if (!r.isAnswered) return log($, `judge failed: ${r.reason}`)
  const pick = parsePick(r.text)
  if (!pick) return log($, 'judge reply unreadable')
  if (mine !== gen) return log($, 'judge dropped: a newer prompt arrived')
  const cur = await currentLevel($)
  const verdict = `judge ${pick.level} (${pick.confidence}), chat at ${cur || 'unknown'}`
  if (!cur) return log($, `${verdict}: current level unknown, nothing suggested`)
  if (pick.confidence < minConfidence) return log($, `${verdict}: below minConfidence`)
  if (pick.level === cur) return log($, `${verdict}: same level`)
  if (!isWorthSwitching(cur, pick.level)) return log($, `${verdict}: one step down, not worth a cache miss`)
  sinceSuggest = 0
  if ((await getMode($)) === 'auto') {
    await setOverride($, pick.level)
    return log($, `${verdict}: applied (auto)`)
  }
  // The clock, not a counter: a counter restarts on a reload while the band in $.state survives it.
  await $.state.set(BAND, { id: await $.clock.now(), from: cur, to: pick.level })
  return log($, `${verdict}: suggested`)
}

export const register: Register = (on, options) => {
  mode = null
  gen = 0
  sinceSuggest = Number.MAX_SAFE_INTEGER
  seen = ''
  base = null
  defaultMode = asMode(options?.mode) ?? 'suggest'
  minConfidence = typeof options?.minConfidence === 'number' ? options.minConfidence : 0.6
  cooldownTurns = typeof options?.cooldownTurns === 'number' ? options.cooldownTurns : 3

  on('session.start', async ($, e, next) => {
    await rotateLog($)
    await $.command.register({
      name: 'effort-optimizer',
      description: 'Effort Optimizer. suggest: show a band, auto: apply by itself, off: do nothing',
      argumentHint: '[suggest|auto|off]',
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
    if (e.command || e.isMeta || !isJudgeable(e.text)) return next(e)
    if ((await getMode($)) === 'off') return next(e)
    gen += 1
    const mine = gen
    sinceSuggest += 1
    // An unanswered suggestion belongs to the previous prompt.
    if ((await $.state.get(BAND)).value) await $.state.set(BAND, null)
    if (sinceSuggest < cooldownTurns) return next(e)
    const text = e.text.trim()
    // Not awaited: the judge starts once this hook has answered.
    $.clock.after(0, () => {
      void judge($, text, mine).catch(err => log($, `judge error: ${err instanceof Error ? err.message : String(err)}`))
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every main-chat request: note its level and, while an override holds, put the override on it.
  on('turn.step', async function* ($, e, next) {
    const requested = e.agentId === undefined && typeof e.effort === 'string' ? asLevel(e.effort) : ''
    if (!requested) return yield* next(e)
    seen = requested
    const { value: override } = await $.state.get(OVERRIDE)
    if (!override) return yield* next(e)
    if (base === null) base = requested
    // The person moved the picker: let go.
    if (requested !== base) {
      base = null
      await $.state.set(OVERRIDE, null)
      await log($, `override released: effort changed to ${requested}`)
      return yield* next(e)
    }
    if (override === requested) return yield* next(e)
    return yield* next({ ...e, effort: override })
  })

  on('command.run', { command: 'effort-optimizer' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const next = asMode(arg)
    if (next) {
      mode = next
      await $.store.set('mode', next)
      if (next === 'off') {
        await setOverride($, null)
        await $.state.set(BAND, null)
      }
      return { text: `Effort Optimizer: ${next}.` }
    }
    const { value } = await $.state.get(OVERRIDE)
    return {
      text: [
        `Effort Optimizer mode: ${await getMode($)}.`,
        `Chat effort: ${(await currentLevel($)) || 'unknown yet'}${value ? ' (held by this mod, your saved setting is unchanged)' : ''}.`,
        'Type /effort-optimizer suggest, auto or off.',
      ].join('\n'),
    }
  })

  on('ui.press', { plugin: 'effort-optimizer', element: 'apply' }, async ($, e) => {
    const { value: band } = await $.state.get(BAND)
    if (band) {
      await setOverride($, band.to)
      await $.state.set(BAND, null)
      await log($, `applied ${band.from} to ${band.to}`)
    }
    return { element: e.element }
  })

  on('ui.press', { plugin: 'effort-optimizer', element: 'dismiss' }, async ($, e) => {
    await $.state.set(BAND, null)
    await log($, 'dismissed')
    return { element: e.element }
  })

  on('ui.press', { plugin: 'effort-optimizer', element: 'reset' }, async ($, e) => {
    await setOverride($, null)
    await log($, 'override reset')
    return { element: e.element }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { value: band } = await $.state.get(BAND)
    const { value: override } = await $.state.get(OVERRIDE)
    if (!band && !override) return next(e)
    const rest = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const noop = () => undefined
    return (
      <Box flexDirection="column">
        {rest}
        {band ? (
          <Box flexDirection="row" gap={1}>
            <Text wrap="truncate-end">
              <Text color={ACCENT}>●</Text>
              <Text>{` Effort: ${band.from} to ${band.to} suggested `}</Text>
              <Text dimColor>(costs one cache miss)</Text>
            </Text>
            <Button key="apply" label="Apply" variant="primary" onPress={noop} />
            <Button key="dismiss" label="Dismiss" role="dismiss" onPress={noop} />
          </Box>
        ) : null}
        {override ? (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>{`Effort held at ${override} by effort-optimizer`}</Text>
            <Button key="reset" label="Reset" variant="secondary" onPress={noop} />
          </Box>
        ) : null}
      </Box>
    )
  })
}

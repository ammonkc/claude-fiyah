import type { EngineInterface, Register } from 'claude-code'

const THEMES = ['default', 'mech', 'bubble', 'press'] as const
const OFF = 'off'
const DEFAULT_THEME = 'default'
const THEME_KEY = 'theme'
const DEFAULT_GAIN = 1.4
const MAX_GAIN = 3
// A short reply is still on screen when it lands; only a turn worth walking away from rings.
const DEFAULT_MIN_SECONDS = 10
// The longest cue is under 3 seconds. A cue that has not settled by now is dropped so it can never hold up a hook.
const CUE_TIMEOUT_MS = 5_000

type Cue = 'ready' | 'attention'
type Choice = (typeof THEMES)[number] | typeof OFF

export const parseChoice = (text: string): Choice | undefined => {
  const word = text.trim().toLowerCase()

  return word === OFF || THEMES.some(theme => theme === word) ? (word as Choice) : undefined
}

// A setting that is not a finite number in range falls back to its default.
export const readNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN

  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

async function chosen($: EngineInterface): Promise<Choice> {
  const stored = await $.store.get(THEME_KEY)

  return (typeof stored === 'string' && parseChoice(stored)) || DEFAULT_THEME
}

async function cue($: EngineInterface, name: Cue, gain: number) {
  const theme = await chosen($)
  if (theme === OFF) return

  await $.audio
    .play({ asset: `sounds/${theme}/${name}.wav` }, { gain })
    .catch((error: unknown) => $.ui.toast(`${$.plugin.name}: ${name} did not play: ${String(error)}`))
}

// Waits for a cue, but never longer than CUE_TIMEOUT_MS. `sleep` is the engine's clock.
export async function settle(sleep: (ms: number) => Promise<unknown>, playing: Promise<void> | undefined) {
  if (playing !== undefined) await Promise.race([playing, sleep(CUE_TIMEOUT_MS)])
}

export const register: Register = (on, options) => {
  const readyEnabled = options.readyEnabled !== false
  const attentionEnabled = options.attentionEnabled !== false
  const minTurnMs = readNumber(options.minSeconds, DEFAULT_MIN_SECONDS, 0, 3600) * 1000
  const gain = readNumber(options.gain, DEFAULT_GAIN, 0.1, MAX_GAIN)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cuelume',
      description: 'Pick the sound theme for turn-end and permission cues, or turn them off',
      argumentHint: [...THEMES, OFF].join(' | '),
    })

    return next(e)
  })

  on('command.run', { command: 'cuelume' }, async ($, e) => {
    const choice = parseChoice(e.args)
    if (choice === undefined) {
      return { text: `cuelume: ${await chosen($)}. Options: ${[...THEMES, OFF].join(', ')}.` }
    }

    await $.store.set(THEME_KEY, choice)
    await cue($, 'ready', gain)

    return { text: choice === OFF ? 'cuelume: off.' : `cuelume: ${choice}.` }
  })

  // The cue starts before next(e) and is awaited after it: a call left running once the hook returns never
  // plays, and this way the answer and the dialog do not wait on the sound. Each hook returns what next gave back.
  on('turn.complete', async ($, e, next) => {
    const isWorthRinging = readyEnabled && e.agentId === undefined && e.reason === 'answer' && e.durationMs >= minTurnMs
    const playing = isWorthRinging ? cue($, 'ready', gain) : undefined
    const answer = await next(e)
    await settle(ms => $.clock.sleep(ms), playing)

    return answer
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    const playing = attentionEnabled ? cue($, 'attention', gain) : undefined
    const decision = await next(e)
    await settle(ms => $.clock.sleep(ms), playing)

    return decision
  })
}

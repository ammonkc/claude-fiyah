/**
 * model-router: picks the model of each subagent at `agent.spawn`.
 *
 * Ported by hand from michaelzwiener/claude-mods (MIT), plugins/model-router at
 * a2bf57cc3ff8e37a2e22106733567cfbcb843808. Changed for Bedrock ARNs: the tiers
 * default to the aliases haiku/sonnet/opus, ARNs are ranked through the
 * ANTHROPIC_DEFAULT_*_MODEL variables, an unranked model needs the strict bar,
 * and a model the caller named is never overridden.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModelRouterEnv, ModelRouterPick } from '../types'
import { JUDGE_SYSTEM, buildIdTierMap, judgePrompt, readJudgement, route, shorten } from './policy'
import type { Decision, PolicyConfig } from './policy'

const NAME = 'model-router'
const MAX_PICKS = 10
const LOG_MAX_BYTES = 256 * 1024

const picks = atom({ plugin: 'model-router', key: 'picks' } as const, [] as ModelRouterPick[])
const envAtom = atom(
  { plugin: 'model-router', key: 'env' } as const,
  { isLoaded: false, tiers: {}, subagentModel: '' } as ModelRouterEnv,
)

/** The log file under $HOME, or none when HOME is unknown or not absolute. */
async function logPath($: EngineInterface): Promise<string | null> {
  const home = ((await $.env.get('HOME')) ?? '').replace(/\/+$/, '')
  return home.startsWith('/') ? `${home}/.claude/mods-logs/${NAME}.log` : null
}

/** Decisions only, never a prompt. One append per line, so parallel spawns cannot drop each other's lines. */
async function log($: EngineInterface, line: string): Promise<void> {
  try {
    const path = await logPath($)
    if (!path) return
    const stamp = new Date(await $.clock.now()).toISOString()
    await $.process.run(['/bin/sh', '-c', 'mkdir -p "$(dirname "$1")" && cat >> "$1"', 'sh', path], {
      stdin: `${stamp} ${line.replace(/\s+/g, ' ')}\n`,
      timeoutMs: 5_000,
    })
  } catch {
    // A log that cannot be written must not stop a spawn.
  }
}

/** Past LOG_MAX_BYTES the log moves to `.log.1`, replacing the one before. */
async function rotateLog($: EngineInterface): Promise<void> {
  try {
    const path = await logPath($)
    if (!path) return
    const st = await $.fs.stat(path)
    if (st.size > LOG_MAX_BYTES) await $.process.run(['/bin/mv', '-f', path, `${path}.1`], { timeoutMs: 5_000 })
  } catch {
    // No log yet.
  }
}

async function readEnv($: EngineInterface): Promise<ModelRouterEnv> {
  // `$.env.get` takes a literal name, so each variable is read where it is named.
  const values: Record<string, string | undefined> = {}
  try {
    values.ANTHROPIC_DEFAULT_HAIKU_MODEL = await $.env.get('ANTHROPIC_DEFAULT_HAIKU_MODEL')
    values.ANTHROPIC_DEFAULT_SONNET_MODEL = await $.env.get('ANTHROPIC_DEFAULT_SONNET_MODEL')
    values.ANTHROPIC_DEFAULT_OPUS_MODEL = await $.env.get('ANTHROPIC_DEFAULT_OPUS_MODEL')
    values.ANTHROPIC_SMALL_FAST_MODEL = await $.env.get('ANTHROPIC_SMALL_FAST_MODEL')
    values.CLAUDE_CODE_SUBAGENT_MODEL = await $.env.get('CLAUDE_CODE_SUBAGENT_MODEL')
  } catch {
    // Read what could be read; an unknown id is then ranked as unknown.
  }
  return { isLoaded: true, tiers: buildIdTierMap(values), subagentModel: values.CLAUDE_CODE_SUBAGENT_MODEL ?? '' }
}

const number = (value: unknown, fallback: number): number => {
  const n = Number(value)
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback
}

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback

async function loadEnv($: EngineInterface): Promise<ModelRouterEnv> {
  const held = await read($, envAtom)
  if (held.isLoaded) return held
  const fresh = await readEnv($)
  await update($, envAtom, () => fresh)
  return fresh
}

async function record($: EngineInterface, pick: Omit<ModelRouterPick, 'at'>): Promise<void> {
  const at = await $.clock.now()
  await update($, picks, list => [...list, { at, ...pick }].slice(-MAX_PICKS))
  await log($, `${pick.agentType}: ${pick.to ? `${pick.from} -> ${pick.to}` : `kept ${pick.from}`}: ${pick.reason}`)
}

/** Haiku's tier for one task, or null when it did not answer in time or in JSON. */
async function judge($: EngineInterface, task: Parameters<typeof judgePrompt>[0], timeoutMs: number): Promise<Decision | null> {
  try {
    const result = await $.model.complete({
      model: 'haiku',
      system: JUDGE_SYSTEM,
      prompt: judgePrompt(task),
      maxTokens: 200,
      effort: 'low',
      timeoutMs,
    })
    if (!result.isAnswered) {
      await log($, `judge gave no answer (${result.reason}), model kept`)
      return null
    }
    const decision = readJudgement(result.text)
    if (!decision) await log($, 'judge answer unreadable, model kept')
    return decision
  } catch (error) {
    await log($, `judge call refused, model kept: ${String(error).slice(0, 120)}`)
    return null
  }
}

export const register: Register = (on, options) => {
  const enabled = options.enabled !== false
  const timeoutMs = number(options.timeoutMs, 5000)
  const config: PolicyConfig = {
    tiers: {
      fast: text(options.fastModel, 'haiku'),
      balanced: text(options.balancedModel, 'sonnet'),
      deep: text(options.deepModel, 'opus'),
    },
    minUpgradeConfidence: number(options.minUpgradeConfidence, 0.3),
    minDowngradeConfidence: number(options.minDowngradeConfidence, 0.6),
  }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: NAME, description: 'Model Router: the last subagent model picks and the tier map' })
    } catch {
      // No /model-router command is no reason to stop the session; the router still works.
    }
    await rotateLog($)
    const env = await loadEnv($)
    const tiers = Object.entries(env.tiers).map(([id, tier]) => `${shorten(id)}=${tier}`)
    await log($, `session start: ${tiers.length} id(s) mapped${tiers.length ? ` (${tiers.join(', ')})` : ''}${env.subagentModel ? '; CLAUDE_CODE_SUBAGENT_MODEL is set' : ''}`)
    return next(e)
  })

  on('command.run', { command: NAME }, async $ => {
    const env = await loadEnv($)
    const recent = await read($, picks)
    const tierLines = Object.entries(env.tiers).map(([id, tier]) => `  ${tier.padEnd(8)} ${shorten(id, 60)}`)
    const pickLines = recent.map(p => {
      const when = new Date(p.at).toISOString().slice(11, 19)
      return `  ${when} ${p.agentType}: ${p.to ? `${shorten(p.from, 30)} -> ${shorten(p.to, 30)}` : `kept ${shorten(p.from, 30)}`} (${p.reason})`
    })
    const lines = [
      `Model Router is ${enabled ? 'on' : 'off'}. Judge: haiku, ${timeoutMs}ms limit. Upgrade bar ${config.minUpgradeConfidence}, downgrade bar ${config.minDowngradeConfidence}.`,
      `Tiers: ${config.tiers.fast} / ${config.tiers.balanced} / ${config.tiers.deep}.`,
      env.subagentModel
        ? `CLAUDE_CODE_SUBAGENT_MODEL is set (${shorten(env.subagentModel, 60)}): Claude Code applies it over any hook, so this router cannot change a subagent's model while it is set.`
        : '',
      tierLines.length ? `Model ids mapped to a tier:\n${tierLines.join('\n')}` : 'No model ids mapped from the environment (aliases and family words only).',
      pickLines.length ? `Last ${pickLines.length} picks:\n${pickLines.join('\n')}` : 'No picks yet in this session.',
    ]
    return { text: lines.filter(Boolean).join('\n') }
  })

  on('agent.spawn', async ($, e, next) => {
    if (!enabled) return next(e)

    // A fork inherits its parent's model, a resume keeps its own, a workflow script
    // and a teammate choose theirs.
    const skipped = e.fork ? 'fork' : e.resume ? 'resume' : e.workflow ? 'workflow' : e.isTeammate ? 'teammate' : ''
    if (skipped) {
      await record($, { agentType: e.subagentType, from: e.model ?? e.parentModel, to: null, reason: `skipped (${skipped})` })
      return next(e)
    }

    // A model the caller named is a decision already made.
    if (e.model && e.model.trim() !== '' && e.model !== 'inherit') {
      await record($, { agentType: e.subagentType, from: e.model, to: null, reason: 'kept (explicit)' })
      return next(e)
    }

    const env = await loadEnv($)

    // Claude Code applies CLAUDE_CODE_SUBAGENT_MODEL over any hook, so a judge call would be wasted.
    if (env.subagentModel) {
      await record($, { agentType: e.subagentType, from: e.parentModel ?? '', to: null, reason: 'skipped (forced by CLAUDE_CODE_SUBAGENT_MODEL)' })
      return next(e)
    }

    const decision = await judge($, { prompt: e.prompt, description: e.description, agentType: e.subagentType }, timeoutMs)
    // What the spawn would run on: the parent's model, which `inherit` and no model both mean.
    const current = e.parentModel ?? ''
    const { model, reason } = route(decision, current, config, env.tiers)
    await record($, { agentType: e.subagentType, from: current, to: model, reason })
    return next(model ? { ...e, model } : e)
  }).catch(($, e, next) => next(e))
}

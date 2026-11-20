import type { Level } from '../types'

export const LEVELS: readonly Level[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const NAMES: Record<Level, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }

export type Mode = 'suggest' | 'auto' | 'off'
export type Pick = { level: Level; confidence: number }

export function asMode(v: unknown): Mode | null {
  return v === 'suggest' || v === 'auto' || v === 'off' ? v : null
}

// "Extra high", "x-high" and "xhigh" all read as xhigh.
export function asLevel(v: unknown): Level | '' {
  if (typeof v !== 'string') return ''
  const t = v.toLowerCase().replace(/[^a-z]/g, '')
  const level = t === 'extrahigh' ? 'xhigh' : t
  return (LEVELS as readonly string[]).includes(level) ? (level as Level) : ''
}

const ACK_WORDS = 'y|yes|yep|yeah|n|no|nope|ok|okay|k|sure|go|on|ahead|do|it|continue|proceed|please|thanks|thank|you|thx|lgtm|looks|good|option|\\d+'
const ACK = new RegExp(`^(?:(?:${ACK_WORDS})\\b\\W*)+$`, 'i')

// Prompts that never need a new effort level: commands, shell and memory shortcuts, and short acknowledgements.
export function isJudgeable(text: string): boolean {
  const t = text.trim()
  if (t.length < 4) return false
  if (t.startsWith('/') || t.startsWith('!') || t.startsWith('#')) return false
  return t.length > 30 || !ACK.test(t)
}

// A one step decrease is not worth the cache miss it costs.
export function isWorthSwitching(cur: Level, want: Level): boolean {
  const from = LEVELS.indexOf(cur)
  const to = LEVELS.indexOf(want)
  if (from < 0 || to < 0 || from === to) return false
  return to > from || from - to > 1
}

export function parsePick(text: string): Pick | null {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as { level?: unknown; confidence?: unknown }
    const level = asLevel(j.level)
    const confidence = typeof j.confidence === 'number' ? j.confidence : Number.NaN
    if (!level || !Number.isFinite(confidence)) return null
    return { level, confidence: Math.min(1, Math.max(0, confidence)) }
  } catch {
    return null
  }
}

// Ben's framework from the effort levels video: four questions, stop at the first yes.
export function judgePrompt(text: string, lastReply: string, now: Level | ''): string {
  return `You pick the effort level an AI assistant (Claude) should use for one prompt. Effort sets how much time, reading and checking Claude spends, and how many decisions it makes alone. It is not how smart Claude is.

Ask these four questions in this order and stop at the first yes:

1. Will the person go back and forth with Claude on this, or is it a simple task? Then low.
   Examples: brainstorming options, quick rewrites (friendlier, shorter), sorting or tagging items, short summaries, rough first drafts or outlines, small tweaks to something already made, simple questions.
2. Would a hidden mistake cost money, a client, trust or a wrong decision? Then high.
   Examples: checking numbers across sources, open-ended analysis with no set path (why did churn go up), reviewing a contract for risk, fact-checking, going through long documents, verifying and testing work made at a lower level, building or fixing a skill.
3. Is the person handing off a long, hard and critical job and walking away, with no time to answer questions? All three must be true. Then xhigh.
   Examples: a full research report from a year of calls and tickets, reviewing a 50 page agreement before signing, an investor pitch deck as the best one shot. Answer max only when the prompt asks for the deepest possible work and says it is critical; otherwise xhigh.
4. Everything else is medium: everyday writing, repurposing content, meeting summaries with decisions and next steps, standard reports in a set format, quick research before a call. If you are not sure, medium.

A task being long does not make it high. Rule-following work stays low or medium.
If the prompt only approves, answers a question, or says to go on with earlier work (yes, go, ok, do it, option 2), answer the level the chat already runs at.

The chat runs at: ${now || 'unknown'}

Claude's last reply (first 600 characters, for context):
<reply>
${lastReply.slice(0, 600) || '(none, this is the first prompt)'}
</reply>

The new prompt:
<prompt>
${text.slice(0, 4000)}
</prompt>

Reply with JSON only: {"level": "low|medium|high|xhigh|max", "confidence": a number from 0 to 1 for how sure you are}`
}

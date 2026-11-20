// Pure parts of the nudge: the threshold and the focus line. No `$` here.

export const MAX_FOCUS_WORDS = 25

export const FOCUS_PROMPT = [
  'The conversation so far is about to be handed off to a fresh session via /handoff.',
  `Reply with ONE line (max ${MAX_FOCUS_WORDS} words, same language the user writes in) describing what the next session should focus on:`,
  'the unfinished task and its next concrete step. No preamble, no quotes, no markdown.',
].join(' ')

/** The share of the window in use as a whole percentage, or null when the window or the count is unknown. */
export const percentOf = (tokens: number | undefined, window: number): number | null =>
  tokens === undefined || !(window > 0) ? null : Math.round((tokens / window) * 100)

/** Whether usage is at the threshold: `thresholdTokens` when it is above 0, else `thresholdPct` of the window. */
export const isOverThreshold = (input: { tokens: number | undefined; window: number; thresholdPct: number; thresholdTokens: number }): boolean => {
  if (input.tokens === undefined) return false
  if (input.thresholdTokens > 0) return input.tokens >= input.thresholdTokens
  return input.window > 0 && input.tokens >= (input.window * input.thresholdPct) / 100
}

/** The model's reply as one focus line of at most 25 words; undefined when it holds nothing usable. */
export const focusOf = (reply: string): string | undefined => {
  const line = reply.split('\n').map(part => part.trim()).find(part => part !== '')
  if (line === undefined) return undefined
  const words = line.replace(/^["'`]+|["'`]+$/g, '').split(/\s+/).filter(Boolean)
  return words.length === 0 ? undefined : words.slice(0, MAX_FOCUS_WORDS).join(' ')
}

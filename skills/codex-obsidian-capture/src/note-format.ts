// Local note formatting for the Codex capture writer.
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const PLAN_START = '<!-- plan:start -->'
const PLAN_END = '<!-- plan:end -->'

export const planSection = (content: string): string => `## Plan\n\n${PLAN_START}\n${content}\n${PLAN_END}\n`

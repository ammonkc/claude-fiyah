// skills/codex-obsidian-capture/src/note-format.ts
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var PLAN_START = "<!-- plan:start -->";
var PLAN_END = "<!-- plan:end -->";
var planSection = (content) => `## Plan

${PLAN_START}
${content}
${PLAN_END}
`;
export {
  MONTHS,
  planSection
};

// mods/obsidian-capture/hooks/shared.ts
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var slugify = (title) => title.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s-]/g, "").replace(/\s/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "unnamed-report";
var parseFrontmatter = (text) => {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)/.exec(text);
  if (!m)
    return { fm: {}, body: text };
  const fm = {};
  for (const line of m[1].split(`
`)) {
    const i = line.indexOf(":");
    if (i > 0)
      fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { fm, body: m[2] };
};
var firstHeading = (text) => {
  for (const raw of text.split(`
`)) {
    const m = /^#+\s+(.+)/.exec(raw.trim());
    if (m)
      return m[1].replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  }
  return "Unnamed";
};
var inlineFields = (text) => {
  const out = {};
  for (const line of text.split(`
`)) {
    const m = /^\*\*([^*]+):\*\*\s*(.*)/.exec(line.trim());
    if (m && m[2].trim())
      out[m[1].trim().toLowerCase().replace(/ /g, "_")] = m[2].trim();
  }
  return out;
};
var fallbackSummary = (text, empty = "Captured from Claude Code superpowers.") => {
  const t = text.replace(/```[\s\S]*?```/g, " ").replace(/^#+\s*/gm, "").replace(/^\|.*\|$/gm, " ").replace(/^\s*[-*]\s+/gm, "").replace(/\s+/g, " ").trim().slice(0, 200).trimEnd();
  return t ? t.length === 200 ? `${t}...` : t : empty;
};
var GENERIC_HEADINGS = new Set(["context", "background", "overview", "summary", "plan", "approach", "implementation", "verification", "notes", "steps", "goal", "goals", "problem", "solution", "description", "objective", "scope"]);
var STOP_WORDS = new Set(["a", "an", "the", "with", "and", "of", "for", "to"]);
var planTitle = (content) => {
  for (const raw of content.split(`
`)) {
    let line = raw.trim();
    if (!line)
      continue;
    line = line.replace(/^#+\s*/, "").replace(/^plan:\s*/i, "").replace(/\s+/g, " ").trim();
    if (GENERIC_HEADINGS.has(line.toLowerCase()))
      continue;
    if (line)
      return line.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim() || "Unnamed Plan";
  }
  return "Unnamed Plan";
};
var planSlug = (title) => {
  let slug = title.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const words = slug.split("-").filter(Boolean);
  if (words.length > 6) {
    slug = words.filter((w, i) => !(STOP_WORDS.has(w) && i !== 0 && i !== words.length - 1)).join("-") || slug;
  }
  if (slug.length > 80) {
    const kept = [];
    let total = 0;
    for (const part of slug.split("-")) {
      const extra = part.length + (kept.length ? 1 : 0);
      if (total + extra > 80)
        break;
      kept.push(part);
      total += extra;
    }
    slug = kept.join("-") || slug;
  }
  return slug || "unnamed-plan";
};
var withStatus = (note, status) => note.replace(/^status: .*$/m, `status: ${status}`);
var mergeTags = (content, newTags) => {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)/.exec(content);
  const block = (tags) => `tags:
${tags.map((t) => `  - ${t}
`).join("")}`;
  if (!m)
    return `---
${block(newTags)}---
${content}`;
  const fm = m[1];
  const tm = /^tags:\n((?:  - .+\n)*)/m.exec(`${fm}
`);
  const existing = tm ? [...tm[1].matchAll(/  - (.+)/g)].map((x) => x[1]) : [];
  const merged = [...new Set([...existing, ...newTags])];
  const newFm = tm ? `${fm}
`.slice(0, tm.index) + block(merged) + `${fm}
`.slice(tm.index + tm[0].length) : `${fm}
${block(merged).trimEnd()}`;
  return `---
${newFm.replace(/\n+$/, "")}
---
${m[2]}`;
};
var upsertEntry = (journal, notePath, title, label, summary) => {
  const marker = `- [[${notePath}|`;
  const lines = journal.split(`
`);
  const i = lines.findIndex((l) => l.startsWith(marker));
  if (i === -1)
    return `${journal}${entryLine(notePath, title, label, summary)}`;
  lines[i] = lines[i].replace(/\([^()]*\)\s*$/, `(${label})`);
  return lines.join(`
`);
};
var PLAN_START = "<!-- plan:start -->";
var PLAN_END = "<!-- plan:end -->";
var planSection = (content) => `## Plan

${PLAN_START}
${content}
${PLAN_END}
`;
var replacePlanSection = (note, content) => {
  const a = note.indexOf(PLAN_START);
  const b = note.indexOf(PLAN_END);
  if (a !== -1 && b > a)
    return `${note.slice(0, a)}${PLAN_START}
${content}
${note.slice(b)}`;
  const h = note.indexOf(`
## Plan
`);
  if (h === -1)
    return `${note.replace(/\n*$/, `
`)}
${planSection(content)}`;
  const c = note.indexOf(`
## Conversation`, h);
  const tail = c === -1 ? "" : note.slice(c);
  return `${note.slice(0, h + 1)}${planSection(content)}${tail ? `
${tail.replace(/^\n/, "")}` : ""}`;
};
var loggedInLink = (note) => /## Logged In\n\[\[([^\]|]+)\]\]/.exec(note)?.[1];
var implementationPromptPath = (notePath) => `Projects/Engineering/Prompts/implement-plan-${notePath.split("/").pop()}`;
var linkImplementationPrompt = (note, promptPath) => {
  const link = `[[${promptPath}|Implementation prompt]]`;
  if (note.includes(link))
    return note;
  const section = `## Implementation Prompt
${link}

`;
  const heading = /^## Plan\n/m.exec(note);
  return heading ? `${note.slice(0, heading.index)}${section}${note.slice(heading.index)}` : `${note.trimEnd()}

${section}`;
};
var implementationPromptNote = (notePath, title, sourceFile, created, session) => `---
created: ${created}
tags:
  - prompt
  - implementation-prompt
  - plan
  - claude-session
source: Claude Code (Implementation Prompt)
session: ${session}
source_file: ${sourceFile}
plan_note: ${JSON.stringify(`[[${notePath}]]`)}
---

# Implement Plan: ${title}

## Plan
[[${notePath}|${title}]]

## Prompt

Implement the plan "${title}".

Read the original plan source_file at this exact path:
${sourceFile}

If the source file is unavailable, use the captured plan in the Obsidian note "${notePath}". If neither is accessible, ask for the plan before proceeding.

Identify the repository referenced by the plan and work from its root. Read its project instructions and inspect the current code before making changes. Check which plan steps are already complete, then implement the remaining steps. Preserve unrelated changes, run the relevant tests and checks, and report what changed, validation results, and any remaining blockers.
`;
var entryLine = (path, title, label, summary) => `
- [[${path}|${title}]] (${label})
  - ${summary}
`;
export {
  MONTHS,
  entryLine,
  fallbackSummary,
  firstHeading,
  implementationPromptNote,
  implementationPromptPath,
  inlineFields,
  linkImplementationPrompt,
  loggedInLink,
  mergeTags,
  parseFrontmatter,
  planSection,
  planSlug,
  planTitle,
  replacePlanSection,
  slugify,
  upsertEntry,
  withStatus
};

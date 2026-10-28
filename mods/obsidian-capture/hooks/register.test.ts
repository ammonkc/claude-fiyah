import { test, expect } from 'claude-code/testing'

import { register, slugify, parseFrontmatter, inlineFields, fallbackSummary, firstHeading, entryLine, planTitle, planSlug, withStatus, mergeTags, upsertEntry, planSection, replacePlanSection, loggedInLink, implementationPromptPath, linkImplementationPrompt, implementationPromptNote } from './register'

test('slugify matches the shell script: ampersand, punctuation, 80 char cap', () => {
  expect(slugify('Hooks & Mods: A Review!')).toBe('hooks-and-mods-a-review')
  expect(slugify('!!!')).toBe('unnamed-report')
  expect(slugify('a'.repeat(120)).length).toBe(80)
})

test('parseFrontmatter splits fields from body and tolerates none', () => {
  const r = parseFrontmatter('---\ntitle: T\ntags: a, b\n---\nbody')
  expect(r.fm).toEqual({ title: 'T', tags: 'a, b' })
  expect(r.body).toBe('body')
  expect(parseFrontmatter('no fm').body).toBe('no fm')
})

test('inlineFields reads bold key lines used by superpowers plans', () => {
  expect(inlineFields('**Goal:** ship it\n**Tech Stack:** TS\n**Empty:**')).toEqual({ goal: 'ship it', tech_stack: 'TS' })
})

test('firstHeading strips markdown and fallbackSummary skips code blocks', () => {
  expect(firstHeading('\n## The `Plan` *now*\ntext')).toBe('The Plan now')
  expect(fallbackSummary('# H\n```\ncode\n```\nreal text')).toBe('H real text')
})

test('entryLine starts with a newline so a tee -a append never joins the previous entry', () => {
  expect(entryLine('P/n', 'T', 'research', 'S')).toBe('\n- [[P/n|T]] (research)\n  - S\n')
})

test('planTitle skips generic section headings and a leading Plan: prefix', () => {
  expect(planTitle('## Context\n\n# Plan: Fix the `SFTP` deploy\ntext')).toBe('Fix the SFTP deploy')
  expect(planTitle('\n\n')).toBe('Unnamed Plan')
})

test('planSlug drops inner stop words only past six words and caps at 80 chars', () => {
  expect(planSlug('Fix the SFTP deploy')).toBe('fix-the-sftp-deploy')
  expect(planSlug('Fix the SFTP deploy path filter so the allowlist change deploys')).toBe('fix-sftp-deploy-path-filter-so-allowlist-change-deploys')
  expect(planSlug('word '.repeat(30)).length).toBeLessThanOrEqual(80)
})

test('withStatus changes only the frontmatter status line', () => {
  expect(withStatus('---\nstatus: planned\n---\nstatus: planned in body', 'saved-for-later')).toBe('---\nstatus: saved-for-later\n---\nstatus: planned in body')
})

test('mergeTags dedupes into existing tags, adds a block when absent, and prepends frontmatter when none', () => {
  expect(mergeTags('---\ntags:\n  - a\n  - b\n---\nbody', ['b', 'c'])).toBe('---\ntags:\n  - a\n  - b\n  - c\n---\nbody')
  expect(mergeTags('---\ncreated: x\n---\nbody', ['c'])).toBe('---\ncreated: x\ntags:\n  - c\n---\nbody')
  expect(mergeTags('body only', ['c'])).toBe('---\ntags:\n  - c\n---\nbody only')
})

test('upsertEntry appends a new plan entry, and re-labels an existing one in place without a duplicate', () => {
  const once = upsertEntry('---\ntags:\n  - a\n---\n', 'P/n', 'T', 'planned', 'S')
  expect(once.match(/\[\[P\/n\|/g)?.length).toBe(1)
  const twice = upsertEntry(once, 'P/n', 'T', 'saved for later', 'S2')
  expect(twice.match(/\[\[P\/n\|/g)?.length).toBe(1)
  expect(twice).toContain('- [[P/n|T]] (saved for later)')
  expect(twice).toContain('  - S\n')
})

test('replacePlanSection swaps only the marked plan text and keeps notes and links around it', () => {
  const note = `---\nstatus: planned\n---\n\n# T\n\n## Logged In\n[[Journal/x]]\n\n${planSection('## Context\nold')}\n## My notes\nkeep me\n`
  const out = replacePlanSection(note, '## Context\nnew')
  expect(out).toContain('new')
  expect(out).not.toContain('old')
  expect(out).toContain('## My notes\nkeep me')
  expect(out).toContain('[[Journal/x]]')
})

test('replacePlanSection on a legacy note without markers stops at the Conversation backlink', () => {
  const legacy = '---\nstatus: planned\n---\n\n# T\n\n## Plan\n\n## Context\nold\n\n## Conversation\n[[C]]\n'
  const out = replacePlanSection(legacy, 'new')
  expect(out).toContain('new')
  expect(out).not.toContain('old')
  expect(out).toContain('## Conversation\n[[C]]')
})

test('replacePlanSection appends a plan section when the note has none, and loggedInLink reads the journal link', () => {
  expect(replacePlanSection('# T\n', 'p')).toContain('## Plan')
  expect(loggedInLink('x\n## Logged In\n[[Journal/2026/10-October/10-09-2026]]\n')).toBe('Journal/2026/10-October/10-09-2026')
  expect(loggedInLink('nothing')).toBeUndefined()
})

test('implementation prompt is searchable, links back, and includes an exact source path with spaces', () => {
  const plan = 'Projects/Engineering/Plans/10-28-2026-fix-deploy'
  const source = '/Users/test/My Project/.claude/plans/fix deploy.md'
  const note = implementationPromptNote(plan, 'Fix deploy', source, '10/28/2026', 'session')
  expect(implementationPromptPath(plan)).toBe('Projects/Engineering/Prompts/implement-plan-10-28-2026-fix-deploy')
  expect(note).toContain('  - prompt\n  - implementation-prompt\n  - plan\n')
  expect(note).toContain(`source_file: ${source}`)
  expect(note).toContain(`this exact path:\n${source}`)
  expect(note).toContain(`[[${plan}|Fix deploy]]`)
  expect(note).toContain('run the relevant tests and checks')
})

test('prompt backlink survives plan updates and is added only once to legacy notes', () => {
  const prompt = 'Projects/Engineering/Prompts/implement-plan-test'
  const legacy = '# Test\n\n## Plan\nold plan\n\n## Conversation\n[[Chat]]\n'
  const linked = linkImplementationPrompt(legacy, prompt)
  const updated = linkImplementationPrompt(replacePlanSection(linked, 'new plan'), prompt)
  expect(updated.split(`[[${prompt}|`).length).toBe(2)
  expect(updated).toContain('new plan')
  expect(updated).toContain('[[Chat]]')
  expect(updated).not.toContain('old plan')
})

// Exercise the registered hooks with an in-memory host; no real vault or model calls.
function captureHost() {
  const files = new Map<string, string>([
    ['/test/Library/Application Support/obsidian/obsidian.json', JSON.stringify({ vaults: { test: { path: '/vault', open: true } } })],
  ])
  const handlers = new Map<string, any>()
  const on: any = (event: string, options: any, handler?: any) => {
    handlers.set(event === 'tool.call' ? options.tool : event, handler ?? options)
    return { catch() {} }
  }
  register(on, {})
  const $: any = {
    fs: {
      read: async (path: string) => { if (!files.has(path)) throw new Error('missing'); return files.get(path) },
      write: async (path: string, text: string) => { files.set(path, text) },
      stat: async () => ({ mtimeMs: 1 }),
    },
    process: { run: async (args: string[]) => {
      if (args[0] === 'printenv') return { stdout: '/test\n', exitCode: 0 }
      if (args[0] === 'date') return { stdout: '2026 10 28\n', exitCode: 0 }
      if (args[0] === 'grep') {
        const hits = [...files].filter(([path, text]) => path.startsWith(`${args[5]}/`) && text.split('\n').includes(args[4]!)).map(([path]) => path)
        return { stdout: hits.join('\n'), exitCode: hits.length ? 0 : 1 }
      }
      if (args[0] === 'obsidian' && args[2] === 'create') {
        files.set(`/vault/${args[3]!.slice('path='.length)}.md`, args[4]!.slice('content='.length).replace(/\\n/g, '\n'))
      }
      return { stdout: '', exitCode: 0 }
    } },
    session: { id: async () => 'session' },
    model: { complete: async () => ({ isAnswered: true, text: 'Fix deployment.\ndeploy' }) },
    ui: { toast: (message: string) => { throw new Error(message) } },
  }
  const next: any = async () => ({})
  next.signal = new AbortController().signal
  const drain = () => handlers.get('session.end')($, {}, next)
  return { files, handlers, $, next, drain }
}

test('Plan Mode creates linked prompt even when rejected and recapture preserves edits', async () => {
  const host = captureHost()
  const source = '/test/.claude/plans/test.md'
  host.files.set(source, '# Fix deploy\n\nRepair the deployment process.')
  await host.handlers.get('Write')(host.$, { file_path: source }, host.next)
  await host.handlers.get('ExitPlanMode')(host.$, {}, async () => ({ deny: 'later' }))
  await host.drain()
  const plan = '/vault/Projects/Engineering/Plans/10-28-2026-fix-deploy.md'
  const prompt = '/vault/Projects/Engineering/Prompts/implement-plan-10-28-2026-fix-deploy.md'
  expect(host.files.get(plan)).toContain('status: saved-for-later')
  expect(host.files.get(plan)).toContain('[[Projects/Engineering/Prompts/implement-plan-10-28-2026-fix-deploy|Implementation prompt]]')
  expect(host.files.get(prompt)).toContain(`source_file: ${source}`)
  host.files.set(prompt, `${host.files.get(prompt)}\nMy custom instruction.\n`)
  host.files.set(source, '# Fix deploy\n\nUpdated deployment instructions.')
  await host.handlers.get('ExitPlanMode')(host.$, {}, host.next)
  await host.drain()
  expect(host.files.get(prompt)).toContain('My custom instruction.')
  expect(host.files.get(plan)).toContain('Updated deployment instructions.')
  expect(host.files.get(plan)).toContain('status: planned')
  expect([...host.files.keys()].filter(path => path.includes('/Prompts/')).length).toBe(1)
})

test('Superpowers plans create linked implementation prompts while specs do not', async () => {
  const host = captureHost()
  for (const kind of ['plans', 'specs']) {
    const source = `/project/docs/superpowers/${kind}/2026-10-28-feature.md`
    await host.handlers.get('Write')(host.$, { file_path: source, content: '# Feature\n\nBuild the feature with tests.' }, host.next)
    await host.drain()
  }
  const plan = host.files.get('/vault/Projects/Engineering/Plans/10-28-2026-feature.md')
  const spec = host.files.get('/vault/Projects/Engineering/Specs/10-28-2026-feature.md')
  expect(plan).toContain('## Implementation Prompt')
  expect(spec).not.toContain('## Implementation Prompt')
  expect(host.files.get('/vault/Projects/Engineering/Prompts/implement-plan-10-28-2026-feature.md')).toContain('source_file: /project/docs/superpowers/plans/2026-10-28-feature.md')
  expect([...host.files.keys()].filter(path => path.includes('/Prompts/')).length).toBe(1)
})

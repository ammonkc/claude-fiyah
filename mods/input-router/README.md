# input-router

Big MCP connector results and long PDFs are read by Haiku first. Claude gets
short notes written for the task, plus the path of the full text if it needs
exact wording. Everything under the limits passes through untouched.

This is a reduced port of the input router in
[michaelzwiener/claude-mods](https://github.com/michaelzwiener/claude-mods/tree/a2bf57cc3ff8e37a2e22106733567cfbcb843808/plugins/input-router)
(pinned at commit `a2bf57cc3ff8e37a2e22106733567cfbcb843808`). Only the connector
path and the PDF path were ported, written again by hand rather than copied.
The upstream repository has no license file at that commit, so none is copied
here. The idea, the trim rules and the prompt shape are credited to it.

## What it routes

| Input | Trigger | What Claude gets |
| --- | --- | --- |
| MCP tool result (`mcp__*`) | text over `mcpThresholdChars` (16000) | the trimmed JSON if that is small enough, else notes by Haiku |
| `Read` of a `.pdf` | more than `pdfPages` (5) pages, no `pages` argument | notes by Haiku and the path of the extracted text |

For an MCP result the mod lets the tool run first, then:

1. Drops fields almost no task reads (avatars, icons, thumbnails, html copies of
   plain fields, rich text, `self` links, `expand`, `__typename`, `etag`) and
   empty values. A field whose name shares a word with your last request or the
   call's arguments is kept. JSON written inside a text field is unpacked first.
2. If the result is now under the limit, that trimmed text is what Claude gets,
   with a line naming the fields dropped.
3. Otherwise Haiku reads it in up to `maxChunks` (6) chunks of about 100,000
   characters, in parallel, with your last real request (up to 12,000
   characters) as the task. Claude gets the notes, labelled "Notes by Haiku from
   N chunks of <tool>; M chars not read", and the path of the raw result.

The raw result is saved under `~/.claude/mods-logs/input-router/results/`. Files
there, and the PDF text files under `.../text/`, are deleted after 7 days when a
session starts.

For a PDF the mod asks Claude Code's own permission check first and only goes on
when the Read would be allowed. It finds `pdfinfo` and `pdftotext` only in
`/opt/homebrew/bin`, `/usr/local/bin` and `/usr/bin`. A scanned PDF with no text
layer, a missing tool or any failure falls through to the normal Read. A Read
that names `pages` is never touched.

If Haiku fails for any reason, Claude gets the original result unchanged.

## Why Read and Bash are left alone

Large file reads and shell output are already handled by context-mode, which
keeps them out of the conversation and offers search over the indexed text.
Doing the same here would route one read through two layers and make Claude's
view of a file depend on which layer got it. So this mod never touches a plain
Read, Bash, or the tools of context-mode, browser automation and the plugin
authoring server (their exact output drives the next step).

## Security: saved result paths

When a result is over Claude Code's own size cap, core replaces it with a note
that says "Output has been saved to <path>". The upstream mod read that path
as given, so a hostile MCP server could name any file the user can read. This
port reads such a path only when it resolves, with every link followed, to a
file at `~/.claude/projects/<project>/<session>/tool-results/<file>` and is
under 4 MiB. Any other path is ignored and the result passes through.

## Command

`/input-router [on|off|status]`. `off` and `on` are kept across sessions
(`$.store`). Status shows the limits and how many results were routed in this
session.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `enabled` | true | Master switch from the mod settings |
| `mcpThresholdChars` | 16000 | MCP results at or over this are trimmed, then read by Haiku |
| `pdfPages` | 5 | PDFs with more pages than this are read by Haiku |
| `maxChunks` | 6 | Most Haiku chunks per input; text beyond them is reported as not read |

Haiku is called through the `haiku` model alias, so the model follows your
provider setup (for example Bedrock).

## Privacy

`~/.claude/mods-logs/input-router.log` holds one line per decision: the tool
name, sizes, chunk counts and timings. It never holds results, arguments or
commands. The text of a result and your last request do go to Haiku, the same
account that already saw them.

## Files

- `hooks/register.tsx`: hooks, Haiku calls, PDF path
- `hooks/trim.ts`: JSON trim, chunking, saved path check
- `tests/router.test.ts`: `claude plugin test mods/input-router`

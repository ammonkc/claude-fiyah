# Changelog

All notable changes to the mods in this repository are recorded here. This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries are added when a mod's version is bumped. Other mods will get entries the next time they are bumped.

## prompt-cache-control 0.3.0 (2026-11-20)

### Added

- Keep warm ping: a one word `$.model.fork` that reads the conversation's cache and renews it before it lapses. A `Keep warm` button appears in the band inside the warning window, only when a ping would pay off (cache alive, prompt of 20k tokens or more, under `compactAtTokens`, pings left). `keepWarm` (off by default) sends it automatically `keepWarmSeconds` before expiry, at most `keepWarmMax` times per idle stretch. The countdown is renewed only when the ping's own usage shows a cache read; a miss or failure stops pings until the next message.

## next-steps 1.1.1 (2026-11-19)

### Added

- Tests for the band: suggestions offered and filled, dismiss, no fork on short answers or subagent turns, the fork timeout, a late answer after a new turn, and cleaning of model output. The suggestion and dismiss buttons have stable keys so tests can press them.

## Review fixes (2026-11-19)

Fixes from a review of every Claude mod in this repo. Copies of third-party mods are now marked patched in README.md.

### git-actions 0.2.0

- Fixed: secrets inside a new untracked folder could be committed. Status now lists untracked files one by one (`-uall`), so `.env` and key files are filtered.
- Fixed: the PR and review diff now leaves out secret files that were already committed.
- Fixed: the `tool.call` hook matches only edit tools and the plan tool, and subagent turns are ignored.
- Changed: git work runs after the turn instead of inside it. Git runs from the repo toplevel, untracked symlinks are not read, an empty PR title is refused, and a failed commit says which groups were already committed.
- Added: README. Band commits skip repo git hooks, because Claude Code runs a mod's git with hooks off.

### obsidian-capture 0.7.0

- Fixed: a stale plan file could be captured on a later ExitPlanMode. Tags are sanitised before they reach YAML, and the Superpowers slug can no longer contain a path.
- Changed: same day reports get a numeric suffix instead of overwriting. Superpowers notes are written like the other captures, with a toast on failure. Summaries are clipped to 20,000 characters, and HOME comes from the environment.
- Added: README with the vault layout.

### notify 0.2.0 (patched copy)

- Fixed: the catch-all `tool.call` hook (which also ran a permission check per call) is replaced by `classic.PermissionRequest` and an exact AskUserQuestion matcher. Auto mode is kept in state, the platform is detected once, and `notify-send` guards leading dashes.

### next-steps 1.1.0 (patched copy)

- Fixed: suggestions no longer fork on subagent turns. The fork runs at low effort with a 30 second timeout.

### prompt-drafts 0.2.0 (patched copy)

- Changed: the `;;` marker needs whitespace before it and is ignored inside code fences and shell `case` blocks. Band hotkeys are letters (a to i, x closes) so they can't clash with next-steps' digits.

### prompt-coach 0.1.4 (patched copy)

- Changed: uses the model call's own timeout, low effort and a cached system prompt, and skips prompts prompt-drafts would save. A failed review shows one toast per session.

### reflect-mod 3.4.0 (patched copy)

- Changed: only prompts with a correction cue are sent to the model. Store writes are serialised, a failed check shows one toast per session, an empty HOME is refused, and `model` is a setting.

### prompt-cache-control 0.2.0 (patched copy)

- Fixed: Bedrock inference profile ARNs map to their model family, so the cache switches and the pane name work. Usage is no longer awaited on every request once it showed no limits, the timer runs only while counting down, and the config key names `@claude-fiyah`.

### filetree 0.5.3 (patched copy)

- Fixed: tool hooks match only edit and shell tools. Grep, Glob and long Bash output are read before context-mode shrinks them, so read highlights work. The selected file path is quoted in prompt context, and the git poll does nothing while the pane is closed.

### flightdeck 0.5.2 (patched copy)

- Changed: tool results come from classic PostToolUse, PostToolUseFailure and PermissionDenied, and a refusal you give is read from its transcript row, so no tool loses its move to the background.
- Fixed: Bedrock ARNs show as Haiku, Sonnet or Opus.

### image-view 0.2.1 (patched copy)

- Fixed: the poll timer is cancelled before it is armed again. Failed conversions retry, caches are bounded, and the folder lookup backs off.

### plan-progress 1.1.0 (patched copy)

- Changed: tool calls are watched through `tool.check` and classic PostToolUse instead of a catch-all `tool.call` hook. The stop nudge fires at most once per turn, and the new `nudgeOpenBars` option turns it off. Bedrock ARNs show as model names. The session clock no longer stacks.
- Removed: the GitHub update check and the Update button.

### skins 0.6.0 (patched copy)

- Changed: per-call bookkeeping moved from a catch-all `tool.call` hook to classic PostToolUse, so skins no longer turns off backgrounding. Run time now excludes permission waits. The frame ticker runs only while a turn works, and per-call state is capped at 500 calls.
- Removed: the daily update check and the star toast. The README update steps name the claude-fiyah marketplace.

### input-router 0.3.0

- Changed: the outline is fenced as untrusted data without an opening excerpt. Haiku prompts treat documents as data. Skipped servers are excluded in the matcher itself. Partial PDF notes go out when some chunks fail. A saved result path must belong to this session. The log rotates, and `keepDays` sets text retention.

### model-router 0.1.1

- Fixed: the judge is skipped while `CLAUDE_CODE_SUBAGENT_MODEL` forces the model. The log appends and rotates, and judge input is escaped.

### effort-optimizer 0.1.1

- Changed: acknowledgements and replies under 12 characters are not judged. The log goes to HOME, appends and rotates, band ids survive reloads, and judge input is escaped.

### handoff 0.2.0

- Changed: notes go to `<project>-<hash>/`, so two repos with the same folder name no longer share notes. `resume` reads only this project's folder and wraps the note as quoted data.

### handoff-nudge 0.1.1

- Fixed: the band offers a new handoff after context crosses the threshold again, instead of showing the old "Saved to". The command list is cached per session.

## prompt-coach 0.1.3 (2026-11-19)

### Fixed

- The reviewer model defaults to the alias `haiku` instead of `claude-haiku-4-5-20251001`. The first-party id is rejected on Bedrock, so every review failed and prompts went through unreviewed.

## input-router 0.2.0 (2026-11-19)

### Changed

- MCP results are never replaced. A large result that reads as a document gets a heading outline in the call's context instead, so context-mode still indexes the full result and Claude's first search can name a real section.
- Haiku synthesis of MCP results is opt-in per tool (`synthesizeTools`) and rides beside the result, never in its place.
- Text is read from every MCP result shape (strings, content blocks, objects). 0.1.0 skipped object results without a word, so it never ran on Atlassian results.
- Every skip is logged with its reason (shape, size, kind).
- The MCP hook moved from `tool.call` to `tool.run` with a `/^mcp__/` matcher. A `tool.call` hook only ever saw context-mode's search pointer, and a hook with no matcher turned off backgrounding for every tool.

### Removed

- The JSON field trim, the summarize and replace path, and the saved copies under `results/`. The `mcpThresholdChars` option is replaced by `outlineMinChars`.

## handoff 0.1.0, handoff-nudge 0.1.0, model-router 0.1.0, effort-optimizer 0.1.0, input-router 0.1.0 (2026-11-19)

### Added

- handoff: `/handoff [focus]` writes a handoff note to `~/.claude/handoffs/<project>/` and `/handoff resume` fills the prompt with the newest one. Ported from Plagemes/claude-mods without the mods-hub integration.
- handoff-nudge: a context usage band that drives the handoff mod (percent threshold, focus line, saved state, `/clear`). It never fills a shell install command.
- model-router: a Haiku judge for subagent models with tier aliases, mapping of inference profile ARNs to tiers, an explicit model lock, and the downgrade bar applied when the current tier is unknown.
- effort-optimizer: a non blocking effort suggestion band, with a per chat override that leaves the saved effort setting alone.
- input-router: Haiku notes for oversized MCP results and long PDFs. A saved output path is read only when it resolves inside core's own tool-results folder.

## obsidian-capture 0.6.0 (2026-10-28)

### Added

- Plan Mode and Superpowers plan captures also create an implementation prompt note under Projects/Engineering/Prompts. The note links back to the plan and records the exact source file path.

### Changed

- Recapturing a plan reuses the existing implementation prompt note, so manual edits are kept.

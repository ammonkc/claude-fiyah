# Changelog

All notable changes to the mods in this repository are recorded here. This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries are added when a mod's version is bumped. Other mods will get entries the next time they are bumped.

## Review fixes (2026-11-19)

Fixes from a review of every Claude mod in this repo. Copies of third-party mods are now marked patched in README.md.

### plan-progress 1.1.0 (patched copy)

- Changed: tool calls are watched through `tool.check` and classic PostToolUse instead of a catch-all `tool.call` hook. The stop nudge fires at most once per turn, and the new `nudgeOpenBars` option turns it off. Bedrock ARNs show as model names. The session clock no longer stacks.
- Removed: the GitHub update check and the Update button.

### skins 0.6.0 (patched copy)

- Changed: per-call bookkeeping moved from a catch-all `tool.call` hook to classic PostToolUse, so skins no longer turns off backgrounding. Run time now excludes permission waits. The frame ticker runs only while a turn works, and per-call state is capped at 500 calls.
- Removed: the daily update check and the star toast. The README update steps name the claude-fiyah marketplace.

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

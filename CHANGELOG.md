# Changelog

All notable changes to the mods in this repository are recorded here. This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries are added when a mod's version is bumped. Other mods will get entries the next time they are bumped.

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

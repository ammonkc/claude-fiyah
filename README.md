# claude-fiyah

Personal Claude Code mods, Codex plugins, and OpenCode packages.

## Checks

`.github/workflows/checks.yml` runs on every pull request and every push to `main`. The marketplace installs from GitHub, so a broken mod on `main` would reach every session after `claude plugin update`.

* **Claude mods:** `claude plugin validate` and `claude plugin test` for every folder in `mods/`, with Claude Code pinned to the version in the workflow. Both run logged out, since neither calls a model.
* **Marketplace and versions:** `scripts/ci/repo-checks.mjs` checks that every mod is listed in `.claude-plugin/marketplace.json`, and that a mod that changed has a new version. Without a bump, `claude plugin update` keeps the old copy. Run it locally with `node scripts/ci/repo-checks.mjs main`.
* **plan-progress:** its offline `.mjs` suite, which `claude plugin test` does not find.
* **OpenCode and Codex packages:** `npm test` in `opencode/worktrunk` and the Codex capture tests.

## OpenCode Worktrunk

The [OpenCode 2 Worktrunk package](opencode/worktrunk/README.md) delegates native
worktree creation, discovery and removal to the external `agent-worktree`
helper. Source, tests and the pinned SDK lockfile live here; personal helper
scripts, Worktrunk hooks and activation settings remain in dotfiles.

Install dependencies from your stable checkout:

```sh
npm ci --ignore-scripts --prefix "$HOME/Developer/repos/ammonkc/claude-fiyah/opencode/worktrunk"
```

Add that absolute package directory to the `plugins` array in your personal
OpenCode config using `{"package":"/absolute/path/to/claude-fiyah/opencode/worktrunk"}`.
See the package documentation for the optional helper path, prerequisites,
validation and [follow-up dotfiles migration](opencode/worktrunk/MIGRATION.md).
OpenCode loads local packages directly, separately from the Claude and Codex
marketplace manifests. No npm publication is required.

## obsidian-capture

Copies reports written to `~/.claude/reports/` and superpowers plans and specs into the Obsidian vault, with a journal entry and tags. Replaces the `capture-report.sh` and `capture-superpowers.sh` hooks.

Plan Mode and Superpowers plan captures also create a linked implementation prompt in `Projects/Engineering/Prompts/implement-plan-<date>-<plan-title>.md`. Search for `implement-plan` or the tags `prompt`, `implementation-prompt`, and `plan` in Obsidian or a vault search utility such as Raycast. The prompt links back to the captured plan and includes the original `source_file` path so it can be pasted into a later coding session. Recapturing a plan reuses its prompt note and preserves manual edits.

Install from this folder:

```
claude plugin marketplace add ~/Developer/repos/ammonkc/claude-fiyah
claude plugin install obsidian-capture@claude-fiyah
```

Once the repository is on GitHub, the install line is `/plugin install obsidian-capture --marketplace ammonkc/claude-fiyah`.

## git-actions

A band above the prompt with git actions once implementation is done: commit message, commit (grouped into logical commits), PR description with markdown preview, copy, create PR with `gh`, and a fast model PR review. It appears when a turn ends with changes in the git tree, and waits for plan steps to finish. Use `/git-actions` to show it manually. Focus it with ctrl+x then Tab, then use the hotkeys shown on each button.

Notes: commits made from the band skip repo git hooks (Claude Code runs a mod's git commands with hooks off), so run your checks before committing from it. If a later group fails, the band says which groups were already committed. Review output is shown locally only (never posted).

```
claude plugin install git-actions@claude-fiyah
```

## Guardrail mods

Five mods that keep cost, context and model choice in check. They are hand ports of third-party mods, rewritten for this setup rather than copied: models are called by alias (`haiku`, `sonnet`, `opus`) so they resolve to Bedrock inference profiles, nothing installs remote code, and logs hold decisions and sizes only. Each mod's README lists what changed from upstream and links the pinned upstream commit.

| Mod | What it does | Ported from |
|---|---|---|
| [handoff](mods/handoff/README.md) | `/handoff [focus]` writes a six section handoff note to `~/.claude/handoffs/<project>/`, copies it and shows it in a pane. `/handoff resume` fills the prompt with the newest note. | Plagemes/claude-mods (MIT) |
| [handoff-nudge](mods/handoff-nudge/README.md) | A band above the prompt once context passes 60% of the window. It fills `/handoff <focus>` for the handoff mod and follows its progress. | thitiwats/claude-mods (MIT) |
| [model-router](mods/model-router/README.md) | A Haiku judge picks each subagent's model at spawn. An explicit model is never overridden, and inference profile ARNs are mapped to tiers. | michaelzwiener/claude-mods, from davila7/claude-code-templates (MIT) |
| [effort-optimizer](mods/effort-optimizer/README.md) | Suggests a reasoning effort level for the main chat in a band. Apply holds it for this chat only and never changes the saved setting. | michaelzwiener/claude-mods (no license in repo) |
| [input-router](mods/input-router/README.md) | Adds a heading outline beside large MCP documents (the result is never changed, so context-mode still indexes it whole), with opt-in Haiku synthesis per tool. Long PDFs are read by Haiku. | michaelzwiener/claude-mods (no license in repo) |

model-router cannot change a subagent's model while `CLAUDE_CODE_SUBAGENT_MODEL` is set, because a session wide subagent model outranks any hook. `/model-router` warns when that is the case.

```
claude plugin install handoff@claude-fiyah
claude plugin install handoff-nudge@claude-fiyah
claude plugin install model-router@claude-fiyah
claude plugin install effort-optimizer@claude-fiyah
claude plugin install input-router@claude-fiyah
```

## Third-party mods

The mods below are copies of third-party Claude Code mods, pinned here so an upstream update cannot reach this setup on its own. Most were copied verbatim; the ones marked patched in the table carry local fixes listed in CHANGELOG.md. Each copy has been audited (read-only review of its hooks, skills, scripts and manifest for network calls, process execution, filesystem and credential access, dynamic code and obfuscation). Only code, LICENSE, README, tests and manifests were copied. Media, upstream CI, git hooks and marketing assets were dropped. To pull an upstream change, diff against the upstream repo at the version listed, re-audit, and copy again.

Copies run the same code as upstream, so the protection comes from the audit and the pinning, not from the copy itself.

| Mod | Version | Upstream | License |
|---|---|---|---|
| plan-progress | 1.1.0 (patched) | zycck/claude-mods | none in repo; plugin.json says MIT |
| image-view | 0.2.1 (patched) | jarrodwatts/claude-image-view | MIT (LICENSE) |
| next-steps | 1.1.0 (patched) | anthropics/claude-plugins-community | none in repo; plugin.json says MIT |
| notify | 0.2.0 (patched) | mishgoldenberg/claude-mods | none |
| prompt-coach | 0.1.4 (patched) | mishgoldenberg/claude-mods | none |
| prompt-drafts | 0.2.0 (patched) | vynnlee/mods | none in repo; plugin.json says MIT |
| reflect-mod | 3.4.0 (patched) | bayramannakov/claude-reflect | none in repo; plugin.json says MIT |
| prompt-cache-control | 0.3.0 (patched) | davila7/claude-code-templates | none in repo; plugin.json says MIT |
| filetree | 0.5.3 (patched) | data-goblin/claude-code-filetree | MIT (LICENSE) |
| flightdeck | 0.5.2 (patched) | scasella/claude-flightdeck | MIT (LICENSE) |
| skins | 0.6.0 (patched) | hellosverre/claude-skins | MIT (LICENSE) |

The repository is private, so the copies without a license file are kept here as they are. None of them has been relicensed.

Audited 2026-10-28. Findings that matter when you review an update:

- **plan-progress**: the upstream GitHub update check and its Update button (which ran `claude plugin update`) are removed in this copy, so it makes no network calls.
- **skins**: the upstream update check (a daily fetch of `plugin.json` from `main`) and the star toast are removed in this copy, so it makes no network calls. `hooks/vendor/mermaid-ascii.js` was rebuilt from `scripts/vendor` and matches the shipped bundle byte for byte.
- **filetree**: runs `git`, `find`, `du`, `tmux` and similar through argv arrays. The "Open with" and "Diff with" settings are run as commands, by design, from the user's own config.
- **reflect-mod**: sends short prompts to a model for review, and writes `CLAUDE.md` when you press save.
- **prompt-cache-control**: reads `settings.json` files (read only) for the cache lifetime setting. When `keepWarm` is on, or you press its button, it makes a small model call (a fork of the conversation asked for one word) that bills a cache read.
- **notify**: runs `osascript`, `powershell` or `notify-send` with arguments that have quotes and shell characters stripped.
- **flightdeck**: no network, process or filesystem access.
- **prompt-coach**: the reviewer model default is the alias `haiku` instead of the first-party id `claude-haiku-4-5-20251001`, which Bedrock rejects.

Patched 2026-11-19 after a review of all mods (see CHANGELOG.md for each copy). The common fix: catch-all `tool.call` hooks were replaced with exact matchers or classic PostToolUse hooks, because a hook that may match a tool turns off that tool's move to the background and its live output.

Install:

```
claude plugin install plan-progress@claude-fiyah
claude plugin install image-view@claude-fiyah
claude plugin install next-steps@claude-fiyah
claude plugin install notify@claude-fiyah
claude plugin install prompt-coach@claude-fiyah
claude plugin install prompt-drafts@claude-fiyah
claude plugin install reflect-mod@claude-fiyah
claude plugin install prompt-cache-control@claude-fiyah
claude plugin install filetree@claude-fiyah
claude plugin install flightdeck@claude-fiyah
claude plugin install skins@claude-fiyah
```

## Codex Obsidian plan capture

A separate [Codex package](skills/codex-obsidian-capture/README.md) provides the
`obsidian-plan` skill, explicit completed-plan artifacts, local note
formatting, native permission-mediated hooks, and a manual capture command.
The [compatibility record](skills/codex-obsidian-capture/COMPATIBILITY.md) documents
Codex 0.167.0 evidence and remaining host validation limits. Installation is a
separate authorized step. Install directly from GitHub:

```sh
codex plugin marketplace add ammonkc/claude-fiyah
codex plugin add codex-obsidian-capture@claude-fiyah-codex
```

The root `.agents/plugins/marketplace.json` supplies the Codex marketplace.
The package documentation covers private-repository SSH access, configuration,
hook trust, permissions, and optional local staging.

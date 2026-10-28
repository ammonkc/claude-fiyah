# claude-fiyah

Personal Claude Code mods.

## obsidian-capture

Copies reports written to `~/.claude/reports/` and superpowers plans and specs into the Obsidian vault, with a journal entry and tags. Replaces the `capture-report.sh` and `capture-superpowers.sh` hooks.

Install from this folder:

```
claude plugin marketplace add ~/Developer/repos/ammonkc/claude-fiyah
claude plugin install obsidian-capture@claude-fiyah
```

Once the repository is on GitHub, the install line is `/plugin install obsidian-capture --marketplace ammonkc/claude-fiyah`.

## git-actions

A band above the prompt with git actions once implementation is done: commit message, commit (grouped into logical commits), PR description with markdown preview, copy, create PR with `gh`, and a fast model PR review. It appears when a turn ends with changes in the git tree, and waits for plan steps to finish. Use `/git-actions` to show it manually. Focus it with ctrl+x then Tab, then use the hotkeys shown on each button.

Notes: commits made from the band skip repo git hooks, and review output is shown locally only (never posted).

```
claude plugin install git-actions@claude-fiyah
```

## Third-party mods

The mods below are verbatim copies of third-party Claude Code mods, pinned here so an upstream update cannot reach this setup on its own. Each copy has been audited (read-only review of its hooks, skills, scripts and manifest for network calls, process execution, filesystem and credential access, dynamic code and obfuscation). Only code, LICENSE, README, tests and manifests were copied. Media, upstream CI, git hooks and marketing assets were dropped. To pull an upstream change, diff against the upstream repo at the version listed, re-audit, and copy again.

Copies run the same code as upstream, so the protection comes from the audit and the pinning, not from the copy itself.

| Mod | Version | Upstream | License |
|---|---|---|---|
| plan-progress | 1.0.0 | zycck/claude-mods | none in repo; plugin.json says MIT |
| image-view | 0.2.0 | jarrodwatts/claude-image-view | MIT (LICENSE) |
| next-steps | 1.0.0 | anthropics/claude-plugins-community | none in repo; plugin.json says MIT |
| notify | 0.1.3 | mishgoldenberg/claude-mods | none |
| prompt-coach | 0.1.2 | mishgoldenberg/claude-mods | none |
| prompt-drafts | 0.1.0 | vynnlee/mods | none in repo; plugin.json says MIT |
| reflect-mod | 3.3.0 | bayramannakov/claude-reflect | none in repo; plugin.json says MIT |
| prompt-cache-control | 0.1.0 | davila7/claude-code-templates | none in repo; plugin.json says MIT |
| filetree | 0.5.2 | data-goblin/claude-code-filetree | MIT (LICENSE) |
| flightdeck | 0.5.1 | scasella/claude-flightdeck | MIT (LICENSE) |
| skins | 0.5.15 | hellosverre/claude-skins | MIT (LICENSE) |

The repository is private, so the copies without a license file are kept here as they are. None of them has been relicensed.

Audited 2026-10-28. Findings that matter when you review an update:

- **plan-progress**: fetches GitHub's releases list for an update check (session start, then every 30 minutes). An Update button runs `claude plugin marketplace update` and `claude plugin update` against the marketplace the plugin was installed from.
- **skins**: fetches `plugin.json` from the upstream `main` branch for an update notice. The response is only compared as a version string. `hooks/vendor/mermaid-ascii.js` was rebuilt from `scripts/vendor` and matches the shipped bundle byte for byte.
- **filetree**: runs `git`, `find`, `du`, `tmux` and similar through argv arrays. The "Open with" and "Diff with" settings are run as commands, by design, from the user's own config.
- **reflect-mod**: sends short prompts to a model for review, and writes `CLAUDE.md` when you press save.
- **prompt-cache-control**: reads `settings.json` files (read only) for the cache lifetime setting.
- **notify**: runs `osascript`, `powershell` or `notify-send` with arguments that have quotes and shell characters stripped.
- **flightdeck**: no network, process or filesystem access.

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

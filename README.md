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

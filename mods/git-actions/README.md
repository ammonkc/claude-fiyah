# git-actions

A band above the prompt with git actions once implementation is done: commit message, grouped commits, PR description, create PR, and a model review of the diff.

## How it works

* `turn.complete`: when the main chat answers and no plan steps are open, the tree is read once after the hook returns (`$.clock.after(0, ...)`). If it changed during the turn, the band appears. Subagent turns are ignored.
* `turn.start`: records the tree state in the background so the end of the turn can tell whether it changed.
* `tool.call` (matcher: `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, smart edit and write tools, and the plan progress tool): notes edits and follows plan steps, so the band waits for the plan to finish. Calls made by subagents are passed through.
* `prompt.submit`: hides the band when you start typing a new prompt, unless an action is running.
* `command.run`: `/git-actions` shows the band by hand.
* `ui.render` on `AbovePrompt`: draws the band. Focus it with ctrl+x then Tab, then use the hotkeys on each button.

## Behaviour worth knowing

* Files that look like secrets (`.env*`, `*.pem`, `*.key`, `id_rsa`, `credentials.json`, `.npmrc`, `secrets.json` style files) are never staged, never sent to the model, and are listed as skipped. Status is read with `--untracked-files=all`, so a secret inside a new folder is seen on its own. The same excludes apply to the committed diff used for the PR description and review.
* A commit is split into groups only when the changes are unrelated. If a later group fails, the error lists the groups that were already committed.
* Git commands run by a mod are started by the host with repository hooks off, so commits made from the band do not run your pre-commit or commit-msg hooks.
* Review output is shown in the band only and never posted. Untracked files are read through regular files only (symlinks are skipped).
* Needs `gh` for Create PR and for detecting an open PR.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| none | | | The mod has no settings. The model calls use the `haiku` alias. |

## Install

```
claude plugin install git-actions@claude-fiyah
```

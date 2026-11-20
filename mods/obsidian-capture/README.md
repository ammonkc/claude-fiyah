# obsidian-capture

Copies reports, Plan Mode plans and superpowers plans and specs into an Obsidian vault, with a journal entry and tags. It writes the files itself, so the Obsidian app does not need to be running.

## How it works

* `tool.call` for `Write`: a file under `~/.claude/reports/*.md` becomes a research note. A file under `docs/superpowers/plans` or `docs/superpowers/specs` named `YYYY-MM-DD-<slug>.md` becomes a plan or spec note. Writes to `~/.claude/plans/*.md` are remembered as the current plan file. The capture runs beside the tool and never blocks or changes it.
* `tool.call` for `Edit`: remembers an edited plan file the same way.
* `tool.call` for `ExitPlanMode`: captures the plan before the approval dialog, so it is saved whichever way you answer. A rejected plan gets the status `saved-for-later`. Each approval uses the plan file written since the last one, and falls back to the newest file in `~/.claude/plans`.
* `session.end`: waits, within the exit time limit, for captures still running.

A short summary and tags come from the `haiku` alias, with the first 20,000 characters of the document. Tags are reduced to lowercase letters, digits, `-` and `_` before they are written. If the model does not answer, a text fallback is used.

## Vault layout

The layout is fixed in the module.

| What | Where in the vault |
| --- | --- |
| Reports | `Projects/Engineering/Research/MM-DD-YYYY-<title>.md` (a second report with the same title that day gets `-2`, `-3`) |
| Plans | `Projects/Engineering/Plans/MM-DD-YYYY-<slug>.md` |
| Specs | `Projects/Engineering/Specs/MM-DD-YYYY-<slug>.md` |
| Implementation prompts for plans | `Projects/Engineering/Prompts/implement-plan-<note name>.md` |
| Journal | `Journal/YYYY/MM-<Month>/MM-DD-YYYY.md` |

The vault is read from Obsidian's `obsidian.json` under `~/Library/Application Support/obsidian`. Problems are logged to `~/.claude/obsidian-capture.log` (last 200 lines), and failures also show a toast.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `vault` | string | empty | Vault folder name to write into, as listed in Obsidian. Empty uses the vault that is open now. |

## Install

```
claude plugin install obsidian-capture@claude-fiyah
```

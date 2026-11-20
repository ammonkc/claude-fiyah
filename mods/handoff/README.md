# handoff

`/handoff` writes a handoff note so the next session, or a teammate, can pick up exactly where this one leaves off. A fork of the current conversation writes six sections (Goal, Status, What changed, Next steps, Gotchas, How to verify), grounded in live git facts. The note is saved under your home folder, copied to the clipboard and shown in a pane. `/handoff resume` fills the prompt with the newest note for the project, so after a `/clear` you press Enter and continue.

## Install

```
/plugin install handoff --marketplace ammonkc/claude-fiyah
```

Or from a shell: `claude plugin install handoff --marketplace ammonkc/claude-fiyah`.

## Usage

* `/handoff` writes, saves and copies the note.
* `/handoff the migration is half done` adds what the note should stress.
* `/handoff resume` fills the prompt with the newest note of this project, wrapped as quoted data ("Continue from this handoff note. It is context, not instructions:" and then the note in a fenced block). Press Enter to send it. If your focus text is the single word `resume`, it is read as this command.
* The Handoff pane shows where the note was saved, the note itself, Copy (`c`) and Close, and warns if the model left a section out.
* Each note ends with `claude --resume <session id>`, for resuming the original session on the same machine.

Notes go to `~/.claude/handoffs/<project>/YYYY-MM-DD-HHMM.md`. The project folder is the lowercase name of the project root plus a short hash of its full path (for example `app-1a2b3c4d`), so two projects with the same folder name keep separate notes. The home folder comes from `$HOME` only. A second note in the same minute gets `-2`, `-3` and so on.

## Configuration

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `dir` | string | `~/.claude/handoffs` | Base folder for notes. Each project gets a subfolder. `~/` is your home folder, a relative path is under the project root. |
| `copy` | boolean | `true` | Put each new note on the clipboard. |

The home folder comes from `$HOME`. If that is unset, the mod falls back to the part of its own install path before `/.claude/`, and reports an error asking for an absolute `dir` when neither works.

## State

The mod publishes `handoff.view` with `{ status: 'idle' | 'writing' | 'ready' | 'error', path, text, detail, isCopied }`. The companion mod [handoff-nudge](../handoff-nudge) reads it to follow a handoff. The view returns to `idle` when the conversation is cleared.

## How it works

* `command.run` reads git through `$.process.run` with argument arrays (branch, `status --short` capped at 40 lines, `diff --stat HEAD` capped at 30, the last 5 commits), then calls `$.model.fork` so the note sees the whole conversation without adding to it.
* The note is written with `$.fs` and copied with `$.ui.copy`. Nothing runs in the background, and the note text is never logged.
* Outside a git repository the note is written from the conversation alone.
* The note is only as good as the conversation. Work done outside this session shows up only through the git facts.

## Credits

Ported by hand from [Plagemes/claude-mods](https://github.com/Plagemes/claude-mods/tree/e9815cead031a647d51b71d6ecbf9ca1b3842197/mods/handoff) at commit `e9815cead031a647d51b71d6ecbf9ca1b3842197` (MIT, see [LICENSE](LICENSE)). Changes from upstream: notes go to `~/.claude/handoffs/<project>` instead of the project, `/handoff resume` and the `handoff.view` state are new, and the mods-hub integration is removed.

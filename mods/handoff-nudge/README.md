# handoff-nudge

A band above the prompt that suggests a handoff when the context window fills up. It works together with the [handoff](../handoff) mod.

```
Context at 63%. Hand off?  [Handoff] [Hide]
Context at 63%. Saved to ~/.claude/handoffs/shop/2026-10-07-1342.md.  [Clear] [Hide]
  Then run /handoff resume to continue from the note.
```

## Install

```
/plugin install handoff --marketplace ammonkc/claude-fiyah
/plugin install handoff-nudge --marketplace ammonkc/claude-fiyah
```

## How it works

1. On every context measurement the mod compares usage with the threshold. Once it is reached, the band appears.
2. Handoff has the model write one focus line of at most 25 words (the unfinished task and its next step), then fills the prompt with `/handoff <focus>`. You press Enter to run it. If the model cannot answer, the prompt is filled with a plain `/handoff`.
3. While the handoff mod writes the note the band says so. When it is done, the band shows where the note was saved. Clear fills `/clear`, and after that `/handoff resume` continues from the note.
4. Hide dismisses the band. It comes back once usage falls below the threshold and rises past it again (after `/compact` or `/clear`). A note saved before that earlier crossing is no longer shown as "Saved to"; the band offers a new handoff instead, and a note saved in the new stretch is shown as usual. The check for an installed /handoff command runs once per session, not on every measurement.
5. If no `/handoff` command is installed, the band says to install `handoff@claude-fiyah` as text. It never fills an install or shell command into the prompt.

The mod reads the handoff mod's `handoff.view` state to know when the note is ready.

## Configuration

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `thresholdPct` | number | `60` | Show the band at this percentage of the model's context window. |
| `thresholdTokens` | number | `0` | An absolute token count that replaces the percentage. `0` uses the percentage. |

## Credits

Ported by hand from [thitiwats/claude-mods](https://github.com/thitiwats/claude-mods/tree/369bdcbbdb0d85a70b925ca34be35891529d74ae/plugins/handoff-nudge) at commit `369bdcbbdb0d85a70b925ca34be35891529d74ae` (MIT, see [LICENSE](LICENSE)). Changes from upstream: a percentage threshold instead of a fixed 200k tokens, a band that follows the handoff mod's progress, and the skills.sh install command is removed in favour of a text hint.

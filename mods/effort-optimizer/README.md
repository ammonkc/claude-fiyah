# effort-optimizer

Reads each prompt you type, asks Haiku which effort level it needs, and shows a band above the prompt when that differs from the level your chat runs at.

```
Effort: medium to high suggested (costs one cache miss)   [ Apply ] [ Dismiss ]
```

## How it works

1. When you submit a prompt, the mod starts a Haiku judge in the background. The turn is never delayed.
2. The judge applies a four question rubric (back and forth or simple work is low, costly hidden mistakes are high, long critical hand offs are xhigh, everything else is medium) and answers `{level, confidence}`.
3. If the level differs from the current one and the confidence is at least `minConfidence`, the band appears.
4. Apply makes the mod put that level on the main chat's requests. Your saved effort setting is never written.
5. When you change effort yourself, the override is released and the band goes away.

Not suggested: a one step decrease (not worth a cache miss), anything inside the cooldown after a suggestion, and prompts that start with `/`, `!` or `#`, acknowledgements such as `yes, go` or `option 2`, replies under 12 characters, or prompts not typed by a person. A short task such as `audit auth for CSRF` is still judged. Subagent requests are never touched.

## Commands

`/effort-optimizer [suggest|auto|off]`

- `suggest` (default): show the band.
- `auto`: apply the judged level without asking, no band.
- `off`: do nothing and drop any override.

With no argument it prints the mode and the current level. The mode you pick is stored and wins over the `mode` setting.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `minConfidence` | 0.6 | Lowest judge confidence that can trigger a suggestion |
| `cooldownTurns` | 3 | Judged prompts to skip after a suggestion |
| `mode` | suggest | Starting mode (suggest, auto or off) |

## Notes

- The judge uses the `haiku` alias, so it works on Bedrock and other providers that map aliases.
- Decisions (never prompt text) are appended to `~/.claude/mods-logs/effort-optimizer.log`. The folder comes from `$HOME`. At session start a log over 256 KB moves to `effort-optimizer.log.1`.
- Changing effort costs one prompt cache miss. Nothing changes until you press Apply, except in auto mode.

## Credit

Ported by hand from the effort-optimizer plugin in [michaelzwiener/claude-mods](https://github.com/michaelzwiener/claude-mods/tree/a2bf57cc3ff8e37a2e22106733567cfbcb843808/plugins/effort-optimizer) at commit a2bf57cc3ff8e37a2e22106733567cfbcb843808, which uses Ben AI's effort framework. Changes: the judge runs in the background instead of blocking the first request, it uses model aliases, the blocking dialog and the unused offer band are gone, the saved effort setting is never written, and the mod switches and footer label integration is removed. The upstream repository has no license file at that commit, so none is copied here. This port declares MIT in its `plugin.json`.

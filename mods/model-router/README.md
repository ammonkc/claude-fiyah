# model-router

Picks the model of each subagent. When Claude starts a subagent (the Agent tool), Haiku reads the task and answers with a tier (`fast`, `balanced` or `deep`) and a confidence from 0 to 1. The subagent moves to that tier's model only when the confidence clears the bar for that direction. Every failure keeps the model Claude Code would have used.

```
/model-router
Model Router is on. Judge: haiku, 5000ms limit. Upgrade bar 0.3, downgrade bar 0.6.
Tiers: haiku / sonnet / opus.
Model ids mapped to a tier:
  fast     arn:aws:bedrock:...611:application-inference-profile/p2w8vnc
  deep     arn:aws:bedrock:...611:application-inference-profile/k3x9qd2
Last 2 picks:
  10:41:07 Explore: kept (explicit)
  10:42:30 general-purpose: arn:aws:bedrock:...ile/k3x9qd2 -> haiku (fast (confidence 0.90, current deep))
```

## How it decides

| Situation | Result |
| --- | --- |
| The Agent call named a model (`model: "opus"`), other than `inherit` | Kept as given. The judge is not asked. Logged as `kept (explicit)`. |
| A fork, a resume, a workflow agent or a teammate | Skipped. They inherit or choose their own model. |
| Haiku wants a bigger model than the parent's | Moves when confidence is at least `minUpgradeConfidence` (0.3). A wrong upgrade only costs money. |
| Haiku wants a smaller model than the parent's | Moves when confidence is at least `minDowngradeConfidence` (0.6). A wrong downgrade loses quality. |
| The parent's tier cannot be told | Any move needs the downgrade bar, because its direction is unknown. |
| Haiku's confidence is missing or unreadable | Never moves. |
| `risky` above 0.7 (the task itself would change production, move money or destroy data) | Forces the deep tier past both bars. A model already deep is left as it is. |
| Haiku times out, errors or answers without JSON | The model is kept. |

The task Haiku reads is capped at 12000 characters and wrapped in `<task>` tags it cannot close early.

## Bedrock and other ARN setups

The tiers default to the aliases `haiku`, `sonnet` and `opus`, which Claude Code resolves to whatever model your provider maps them to. On Bedrock with application inference profiles those ids are ARNs with no family word in them, so the router cannot rank them by name.

At session start it reads `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL` and `ANTHROPIC_SMALL_FAST_MODEL` and builds a map from each id to its tier. A model is ranked by, in order, the configured tier strings, that map, then the family words `haiku`, `sonnet` and `opus`. An id none of these knows is unknown, and unknown takes the strict bar. If one profile backs two tiers, its id names no tier and ranks as unknown.

`CLAUDE_CODE_SUBAGENT_MODEL` is different: Claude Code applies it over any hook, so while it is set this mod cannot change a subagent's model. `/model-router` says so when it sees the variable.

## Command

`/model-router` prints the last 10 picks of this session and the resolved id to tier map, with long ARNs shortened.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Off leaves every spawn as it is. |
| `fastModel` | `haiku` | Model alias or id for the fast tier. |
| `balancedModel` | `sonnet` | Model alias or id for the balanced tier. |
| `deepModel` | `opus` | Model alias or id for the deep tier. |
| `minUpgradeConfidence` | `0.3` | Confidence needed to move to a bigger model. |
| `minDowngradeConfidence` | `0.6` | Confidence needed to move to a smaller model, or from an unknown one. |
| `timeoutMs` | `5000` | How long to wait for Haiku before keeping the model. |

## Logging and privacy

Decisions are appended to `~/.claude/mods-logs/model-router.log` (the last 400 lines are kept). A line holds the agent type, the models and the reason. Prompts and task text are never logged.

## Hooks and calls

- `session.start` registers `/model-router` and reads the five environment variables.
- `agent.spawn` runs the judge and rewrites `model`.
- `command.run` answers `/model-router`.
- Calls: `$.model.complete` (alias `haiku`, effort `low`), `$.env.get`, `$.fs` for the log, `$.state` for the picks.

## Install

```
/plugin install model-router --marketplace ammonkc/claude-fiyah
```

For one session from a checkout: `claude --plugin-dir mods/model-router`. Check it with `claude plugin validate mods/model-router` and `claude plugin test mods/model-router`.

## Credits and license

A hand port of the `model-router` plugin from [michaelzwiener/claude-mods](https://github.com/michaelzwiener/claude-mods/tree/a2bf57cc3ff8e37a2e22106733567cfbcb843808/plugins/model-router) at commit `a2bf57cc3ff8e37a2e22106733567cfbcb843808` (MIT). That plugin is BenAI's copy of the Jev Model Router from [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) (MIT, by Daniel Avila), changed to use Haiku as the judge.

Changes here: alias tiers in place of raw model ids, ARN aware ranking, the strict bar for unknown models, an explicit model lock, skipping forks, resumes, workflows and teammates, and no pane, mascot, cost tables, savings ledger or main loop effort routing. See `LICENSE` for the upstream notices.

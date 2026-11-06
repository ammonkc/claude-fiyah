---
name: obsidian-plan
description: Save substantial engineering plans as durable Codex artifacts and linked Obsidian notes when the user requests planning, revises a plan, or asks to import or retry plan capture.
---

When explicitly asked to produce a substantial engineering plan, create a durable
artifact in the configured `sourceDirectory`. Do not capture questions, routine
status messages, or small task lists. Read the configuration at
`OBSIDIAN_CAPTURE_CONFIG` or `$CODEX_HOME/obsidian-capture.json` (default
`~/.codex/obsidian-capture.json`). Missing configuration is a reported setup gap.
When `sourceDirectory` is omitted, resolve it to `$XDG_STATE_HOME/codex/plans`
using the environment inherited by the host. If XDG_STATE_HOME is unset, empty,
or relative, use `~/.local/state/codex/plans`. An explicit absolute
`sourceDirectory` takes precedence; do not expand shell variables inside JSON.
The source directory is agent-owned, outside the repository and vault by default.
Create it if needed through normal filesystem tools and their current permissions.

Read [the artifact contract](artifact-contract.md). Preserve `plan_id` and
`created` across revisions and title changes; generate a UUID once for a new plan.
Write drafts with `capture_state: draft`. After the entire plan is coherent,
atomically replace the artifact with `capture_state: complete` and update its
ISO timestamp. Explicit completion is evidence of a finished draft, not user
approval. Never invent host/session metadata. Use `status: draft` unless the user
explicitly says planned or saved for later.

The installed PostToolUse hook requests capture after completed artifacts exist.
Honor that context by invoking the package's `runtime/cli.mjs capture --config
<config-file> --source <artifact-file>` through the normal sandboxed exec tool.
Locate the runtime relative to this skill directory at `../../runtime/cli.mjs`.
If `automatic` is true and hooks are unavailable, invoke the same command after
finalizing the plan. If `automatic` is false, save the artifact and capture only
on an explicit capture/import/retry request.
If access is denied, report the failure with the retry command. Do not broaden
permissions or use a hook to bypass denial. State the note paths returned by the
writer only after successful capture. Automatic discovery cannot intercept every
chat-only plan; an installed planning rule or explicit `$obsidian-plan` invocation
makes this workflow discoverable.

For import/recovery, wrap the imported engineering plan in the same artifact
contract inside `sourceDirectory`, then invoke the capture command explicitly.
Keep the original plan text and repository accurate; do not fabricate timestamps
for a historical source—use the artifact creation time. Manual retry uses the same
stable identity. Do not copy vault-generated notes into the source directory.
Capture does not authorize implementation, installation, commits, or publishing.

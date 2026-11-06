`post-tool-use.schema.json` was extracted from the installed macOS Codex CLI
0.167.0 binary's embedded `post-tool-use.command.input` schema on 2026-11-06.
It is schema evidence, distinct from delivered events.

`post-tool-use-bash.json`, `post-tool-use-apply-patch.json`, and `stop.json` are
real delivered command-hook payloads recorded from the successful disposable
Codex CLI 0.167.0 automatic smoke on macOS 26.7.2. Only the disposable absolute
path prefix was replaced with `/disposable/obsidian-smoke`; session/turn fields
remain the identifiers actually supplied by the host. Bash's fixture is the
initial capture tool event; apply_patch is the artifact revision. This test
used a local deterministic Responses server, not a paid model or live session.
`host-smoke-result.json` records the observed result and its exact limits.

`model-catalog.json` is a test-only local model descriptor using the installed
catalog's shape and explicitly exposing unified exec/freeform apply_patch. It
does not identify a real called model or establish skill-selection behavior.
The smoke recorder wraps the adapter before package hashing/trust approval.
Trust is persisted only for that bundle in the temporary CODEX_HOME, never live.
The remaining hand-authored unit events are synthetic and are not claimed real.

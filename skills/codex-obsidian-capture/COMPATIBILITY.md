# Compatibility evidence

Investigated 2026-11-06 on macOS 26.7.2, installed `codex-cli 0.167.0`.
This is the compatibility baseline; older/newer CLI, cloud and other integrations
are not claimed compatible without testing.

Official OpenAI documentation was requested at
https://developers.openai.com/codex/plugins/,
https://developers.openai.com/codex/hooks, and
https://developers.openai.com/codex/skills.md.
Sandbox retrieval failed DNS resolution; approved external retrieval returned
HTTP 403. These URLs were not successfully read, so they do not establish a
contract. Local schema/help and actual app-server probes provide the evidence
below. Official documentation reconciliation remains an explicit gap.

`codex --help`, `codex plugin --help`, plugin add/marketplace help, and
`codex app-server generate-json-schema --out <temporary-directory>` establish
native plugin management and the app-server `plugin/read`, `plugin/list` and
`hooks/list` contracts. A real isolated app-server initialized as 0.167.0 and read
a disposable package's native hook summary. `.codex-plugin/marketplace.json`
was rejected as an unsupported marketplace location. `.agents/plugins/marketplace.json`
with a `./` local source inside its root was accepted. Source traversal outside
that root is refused. The repository now supplies a root
`.agents/plugins/marketplace.json` with the contained source
`./skills/codex-obsidian-capture`, supporting direct GitHub installation. The
optional staging packager produces a smaller complete marketplace using the
same manifest and contained package path. A minimal `.codex-plugin/plugin.json`
with name/version/description and `hooks/hooks.json` was recognized by plugin/read.

The installed binary contains the `post-tool-use.command.input` JSON Schema:
required `cwd`, `hook_event_name: PostToolUse`, `model`, `permission_mode`,
`session_id`, `tool_input`, `tool_name`, `tool_response`, `tool_use_id`, nullable
`transcript_path`, and `turn_id`; optional agent fields. Its output schema includes
`hookSpecificOutput` with `hookEventName: PostToolUse` and `additionalContext`.
This is **schema evidence**, not a recorded delivered payload. The adapter relies
only on event name and tool response/name for gating; it never treats shell input
as source content or synthesizes session identity. Stop uses `systemMessage` and
suppresses reentrant `stop_hook_active` events. Package hook environment uses
`PLUGIN_ROOT`, present in the installed hook loader; actual interpolation and
context delivery require the host smoke test below.

Local hooks.json contains real PostToolUse/Stop command registrations for Orca,
Keepresso and Supacode. Their presence establishes local configuration usage,
not portable payload delivery or permissions. The fallback installer preserves
those shapes in isolated tests. The Claude registration API (`claude-code`
`tool.call`, `ExitPlanMode`, `session.end`) stays exclusively in the Claude adapter.
No Codex adapter imports it.

Permission design: command hooks do not write vaults or grant permissions. They
request a normal tool invocation through additionalContext. The writer relies on
that invocation's filesystem sandbox. Stop reminds but does not block or restart
turns. This avoids using hooks' process privileges to bypass denied agent access.
The installed CLI exposes --add-dir, sandbox policies and hook trust; this package
never enables those settings or bypasses trust automatically.

## Host smoke evidence

`node skills/codex-obsidian-capture/tests/host-probe.mjs` passed against a real
isolated Codex app-server. It stages a new native marketplace, installs into a
new temporary CODEX_HOME, discovers the namespaced
`codex-obsidian-capture:obsidian-plan` skill and both command hooks, and verifies
PLUGIN_ROOT expansion to the installed cache. No model/network requests are
needed for the local probes. The probe also invokes the actually installed
writer for initial capture and recapture in a disposable vault; the same paths
are reused and manual note/prompt edits survive. It removes its temporary home
and vault afterwards. This establishes native loading and installed-runtime
manual behavior, not automatic tool-to-hook delivery.

The `--repository` mode also passed against the repository root with both
marketplace manifests present. Codex selected `claude-fiyah-codex`, installed
the contained package, discovered its skill and hooks, and passed installed-runtime
capture/recapture. This verifies the checkout layout used by GitHub installation;
a remote fetch of the new manifest requires it to be committed and pushed first.

The untrusted probe reports both hooks `trustStatus: untrusted`. After explicit
user authorization, `tests/host-smoke.py --approve-disposable-hooks --keep` staged
a new native package and approved only its exact `trusted_hash` and
`trusted_content_hash` in a disposable home through config/batchWrite. No
`--dangerously-bypass-hook-trust` or sandbox bypass was used. A test-only recorder
wrapped the reviewed adapter before computing the trusted package hash.

The real CLI ran with `-s workspace-write`, approval policy never, and a loopback
deterministic Responses provider. Its recorded turn context confirms a restricted
filesystem profile and workspace-write sandbox. Tool events reported
`permission_mode: bypassPermissions` because of the approval policy; that field
is **not evidence of a disabled filesystem sandbox** and the adapter never uses
it as a write grant. The provider emits a fixed tool sequence; it does not call a
paid model or prove production-model skill selection/compliance.

Automatic initial capture and recapture passed. After an exec-based source write,
the real hook delivered additionalContext into the next provider request, which
used the supplied writer command through the normal exec tool. The test then
added manual edits and revised the artifact through actual freeform apply_patch.
The next real hook delivered a second capture request. The vault contained one
plan and one prompt, the plan body changed, and manual note/prompt edits survived.
Receipts suppressed extra capture requests after writer completion. Stop was
actually delivered. The run used only a disposable source directory and vault.
The outer sandbox needed an approved external test invocation to bind loopback
and start Codex's nested macOS sandbox; the nested host retained workspace-write.

Real normalized payloads differ from tool names in model requests:
`exec_command` arrives as `tool_name: Bash`, `tool_input: {command: ...}`, and a
string tool_response. Freeform apply_patch arrives as `tool_name: apply_patch`,
with its input/output as delivered by the host. The adapter scans explicitly
completed artifacts rather than decoding those command/patch inputs. The observed
Bash, apply_patch and Stop fixtures preserve actual session/turn identifiers and
replace only disposable path prefixes. See tests/fixtures/README.md and
host-smoke-result.json. The embedded schema fixture remains separately labeled.

The fixture provider uses a local model catalog exposing unified exec and
freeform apply_patch. Generic unknown-model fallback did not expose apply_patch;
that first attempted revision failed, and is not counted as a successful smoke.
Native plugin skill discovery passed independently. Skill *selection* by a
production model still remains conditional and is not claimed tested.

Orca's managed API host may differ from CLI. Native additionalContext delivery,
normal tool permission enforcement and Stop reminders need a separate disposable
Orca-host run before Orca automatic capture is claimed supported. No live Orca or
global hook configuration was changed.

A separate successful `--app-server` smoke exercised thread/start and turn/start
through a real isolated stdio app-server, with the same automatic capture,
recapture, edit preservation, and Stop delivery assertions. A separate
`--deny-vault` run targeted a sandbox-protected temporary `.aws/vault` subtree:
the writer failed with EPERM in the host tool output, no note or receipt was
written, and the model reported the failure/retry path. Neither test expanded
filesystem access.

CLI and stdio app-server 0.167.0 are the tested automatic hosts;
other hosts retain the explicit skill/manual recovery path.

Validation at this stage: 22 Node tests and 17 original Claude regressions pass;
`git diff --check` passes. Tests include EACCES, idempotence, collisions,
concurrent delivery, prompt/manual frontmatter preservation, partial repair,
Unicode/traversal/symlink handling, explicit vault selection, observed
Bash/apply_patch/Stop and synthetic exec event gating, recursion suppression,
packaging, reversible install,
and unrelated hook preservation. No automated test touched the real idl vault.

The optional skill-creator quick_validate.py command could not run because PyYAML
is absent. Native Codex skill discovery parsed and loaded the packaged SKILL.md
successfully in the real isolated host probe. No dependencies were installed.

Real hook session IDs are recorded as `capture_session` when available; they do
not become source `session` or approval metadata. Source session remains the
artifact's explicitly supplied session_id.

The Codex writer now bundles its own src/note-format.ts formatter. No helper is
extracted into the Claude mod, and its original register.ts and tests are restored.

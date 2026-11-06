# Codex Obsidian plan capture

Automatically smoke-tested on Codex CLI 0.167.0 with a deterministic local
provider; Orca automatic delivery remains unverified. A package with a planning skill, a local writer, native command hooks,
and an optional reversible registration installer. No model calls for naming or
capture. See [compatibility evidence](COMPATIBILITY.md) for tested contracts and
host limits. Claude's separate plugin and marketplace retain their existing behavior.

## Installation (separate authorized action)

Requirements: Node 22+ and Codex with plugins and command hooks. This repository
ships a marketplace template rather than modifying its protected `.agents`
directory. Stage a self-contained marketplace into a **new** directory:

```sh
node skills/codex-obsidian-capture/runtime/package.mjs /absolute/new/obsidian-marketplace
codex plugin marketplace add /absolute/new/obsidian-marketplace
codex plugin add codex-obsidian-capture@claude-fiyah-codex
```

The staged marketplace uses `.agents/plugins/marketplace.json`; the installed
package uses `.codex-plugin/plugin.json`, `skills/obsidian-plan/SKILL.md`, and
`hooks/hooks.json`. All shared runtime files are included. Do not run both native
and fallback hook registration. Hooks must be enabled and reviewed/trusted through
the host's normal hook approval flow; installation does not grant hook trust.
Restart the Codex host after installation/configuration changes.

Copy `config.example.json` to `$CODEX_HOME/obsidian-capture.json` (normally
`~/.codex/obsidian-capture.json`) **when separately authorized**, replace
`sourceDirectory` with an absolute agent-owned path, and create that directory.
Alternatively set `OBSIDIAN_CAPTURE_CONFIG` to an absolute configuration path in
the environment inherited by the Codex host. Hook environments can differ from
interactive shells; ensure `node` is available to the host.

To make planning selection consistent, add this rule to the relevant user/project
instructions when authorized:

> For explicit substantial engineering planning requests, use
> `$codex-obsidian-capture:obsidian-plan` (native) or `$obsidian-plan` (fallback)
> and finalize a durable artifact before ending the turn. Honor obsidian-plan
> capture hook context through normal sandboxed tools; report failed captures.

Skill discovery is not guaranteed to activate for every chat plan. Explicit
`$codex-obsidian-capture:obsidian-plan` (native plugin namespace) or
`$obsidian-plan` (fallback installer) works for planning, imports and manual recovery.

## Configuration and permissions

The JSON configuration defaults to vault `idl`, plan folder
`Projects/Engineering/Plans`, prompt folder `Projects/Engineering/Prompts`,
`automatic: true`, `journal: true`, and `timezone: "Pacific/Honolulu"`.
`sourceDirectory` defaults to `$CODEX_HOME/plans`. Dates are MM-DD-YYYY filenames
and MM/DD/YYYY YAML values. Journal links are
`Journal/YYYY/MM-Month/MM-DD-YYYY`. This package links the Journal note without
writing Journal entries. Set `journal: false` to omit the link on new notes.

Set `vaultPath` to an explicit absolute existing vault directory, or `vault` to its
exact registry folder name. Registry lookup uses the platform Obsidian registry;
`registryPath` can override it. Missing or ambiguous explicit names fail; no
fallback to another open vault. The Claude plugin's existing `vault` option is
unchanged. Destination folders must remain inside the vault. Symlink destinations
are rejected, including symlink note files. A symlink to the selected vault root
itself is resolved once. Source and vault directories must not overlap.

Vault writes occur **only in the normal agent tool sandbox**, never in the hook
process. The host must already permit the source directory and vault destination
folders. For Codex CLI this can be configured by a separately authorized launch
with `--add-dir /absolute/sourceDirectory --add-dir /absolute/vault`; Orca-managed
permission profiles need their own user-approved writable paths. Plugin loading,
hook trust, Obsidian registry registration, and OS filesystem access do not imply
agent write permission. No installer edits permission configuration or grants
access. Denied capture is reported; do not bypass the sandbox or auto-escalate it.

## Automatic behavior and manual fallback

The skill writes a scalar-frontmatter Markdown artifact with stable `plan_id`,
explicit `capture_state: complete`, lifecycle status, and real metadata. See the
[artifact contract](skills/obsidian-plan/artifact-contract.md). Drafts and ordinary
Markdown are ignored. On `PostToolUse`, a completed artifact without a current
receipt causes a hook `additionalContext` request to run the writer. The model
must honor this request through its regular exec tool. This covers exec-based
and apply_patch writes without parsing shell commands or assuming tool-specific
source paths. `Stop` provides a pending-capture reminder, not a blocking turn loop.
This is automatic **when the host delivers context and the agent follows it**;
it cannot forcibly intercept chat text, prove approval, or guarantee capture after
a host shutdown. It does not use Claude ExitPlanMode.

Manual capture uses exactly the same writer (substitute the installed runtime):

```sh
node /absolute/plugin/runtime/cli.mjs capture --config /absolute/config.json --source /absolute/sourceDirectory/plan.md
```

The writer returns compact JSON with the two vault-relative note paths. It stores
no full plan in logs. Failure returns nonzero with an error code or compact
validation diagnostic. Hook failures also produce a host-visible system message.
A real hook session identifier is passed as `capture_session`, identifying the
capture event, not asserting source authorship or approval. Artifact `session_id`
is recorded separately as source `session` only when explicitly available. Manual
captures omit event-session metadata unless supplied accurately. No capture
authorizes implementation, commits, deployment or publishing.

Recapture finds the existing note by stable `plan_id`, so titles, source paths,
dates and sessions can change without duplicating notes. Destination-folder
changes reuse existing note paths when the source receipt still identifies them. Only generated metadata
and content inside `plan:start`/`plan:end` change. Custom YAML, note headings,
Journal links, manual text outside markers and the entire existing prompt are
preserved. A renamed plan therefore retains its original note filename/heading
and prompt wording; the current plan body and generated source_file remain accurate.
A prompt's original source_file remains as first captured because manual prompt
edits take precedence; its vault backlink always remains usable.

Atomic file replacement and a vault-wide lock serialize competing processes. The
identity-bearing plan is written before the prompt; the source receipt is written
last. Retry repairs missing prompts or receipts after partial failure. Same-title
plans get distinct names. Duplicate identities or damaged markers stop capture
for manual repair. Receipts suppress recursive capture tool events; do not manually
edit them. Delete a receipt when deliberately requesting repair after deleting a
note, or run the manual capture command (which always checks and repairs).

Scans are bounded: 500 source entries, 8 MiB total scanned artifacts, 1 MiB per
artifact, five pending captures, and a 1.5-second hook scan budget. Vault identity
scan is limited to 10,000 entries, 2 MiB per note, and four seconds. Lock contention
fails after two seconds. Archive old artifacts/notes if these limits are exceeded.
A stale `.obsidian-plan-capture.lock` is never automatically broken: verify no
writer is running before removing it and retry.

## Fallback installer, upgrade and uninstall

If a host supports local command hooks but lacks native plugin loading, an
explicit installer copies the complete package and links the skill:

```sh
node skills/codex-obsidian-capture/runtime/install.mjs install --home /absolute/CODEX_HOME
node skills/codex-obsidian-capture/runtime/install.mjs uninstall --home /absolute/CODEX_HOME
```

It preserves unrelated hook events, group options, handlers and JSON fields,
including Orca/Keepresso/Supacode entries. Re-run is idempotent. Non-owned package
or skill collisions fail. It does not edit config.toml, instructions, permissions,
or user configuration. Uninstall removes only exact owned command registrations
and its own skill link; runtime/config files remain for review and recovery.
An interrupted install can be repaired by rerunning; if package copying stopped
before its ownership marker was written, inspect the staged package before any
manual cleanup. The installer never overwrites an unknown package.

Native upgrades: stage a fresh marketplace, review the package, use the host's
marketplace upgrade/reinstall flow, and review renewed hook trust. Do not install
fallback registration over native hooks. Native uninstall:
`codex plugin remove codex-obsidian-capture@claude-fiyah-codex`, then remove the
marketplace if no longer needed. Notes, source artifacts and your config remain.

## Validation

```sh
node --test skills/codex-obsidian-capture/tests/capture.test.mjs
claude plugin test mods/obsidian-capture
node skills/codex-obsidian-capture/tests/host-probe.mjs
sh scripts/build-obsidian-capture.sh
```

An opt-in real CLI automatic smoke (requires explicit approval for disposable
hook trust, loopback serving and nested sandbox execution) is:

```sh
python3 skills/codex-obsidian-capture/tests/host-smoke.py --approve-disposable-hooks
python3 skills/codex-obsidian-capture/tests/host-smoke.py --approve-disposable-hooks --app-server
python3 skills/codex-obsidian-capture/tests/host-smoke.py --approve-disposable-hooks --deny-vault
```

It approves only the staged test bundle in a new temporary CODEX_HOME and uses a
loopback deterministic provider. It never modifies live trust or permissions.
`--keep` retains temporary evidence; otherwise successful runs clean it up.

The shared formatter's source is `mods/obsidian-capture/hooks/shared.ts`; the
Codex package commits its bundled `runtime/shared.mjs`. Rebuild after editing the
shared source. All automated tests use disposable vaults, never `idl`.

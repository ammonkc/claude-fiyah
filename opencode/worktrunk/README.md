# OpenCode Worktrunk

A local OpenCode 2 package using `Plugin.define` and `ctx.worktree.transform`.
The SDK dependency is pinned to 2.3.0; package checks require Node 22.19 or newer.
OpenCode loads this package directly;
the Claude Code and Codex marketplaces do not register it.

## Install locally

After this change is reviewed and available in your normal checkout:

```sh
npm ci --ignore-scripts --prefix "$HOME/Developer/repos/ammonkc/claude-fiyah/opencode/worktrunk"
```

Merge this entry into the `plugins` array in your personal
`~/.config/opencode/opencode.json`, substituting your actual absolute path:

```json
{
  "worktree": { "directory": "~/Developer/worktrees" },
  "plugins": [
    {
      "package": "/Users/ammon.casey/Developer/repos/ammonkc/claude-fiyah/opencode/worktrunk",
      "options": { "helperPath": "/Users/ammon.casey/.local/bin/agent-worktree" }
    }
  ]
}
```

`helperPath` is optional and defaults to `~/.local/bin/agent-worktree` at
runtime. An explicit value must be an absolute executable path; it is passed
to `execFile` without shell interpolation. Package paths should be absolute,
since relative paths resolve from the configuration location. Restart OpenCode.
The last active worktree strategy registration wins, so avoid competing strategies.

The helper is an **external requirement**, supplied by personal dotfiles, not
bundled or reimplemented here. Install its Python 3, Git and Worktrunk (`wt`)
requirements and personal Worktrunk configuration. The source used for this
extraction is dotfiles commit `ca6b0cad7b125ceb75757a90b0e31b1bf7bb6a85`,
`packages/bin/.local/bin/agent-worktree` and the original OpenCode plugin.
Moving this package alone does not install helper scripts or hooks.

## Behavior and personal setup

Creation delegates to `agent-worktree create --tool opencode`. The requested
name comes from the basename of OpenCode's suggested directory. It creates
`opencode/<requested-name>` through Worktrunk and returns the helper's actual
directory, so inventory and startup use the same checkout. `input.branch` is a
starting ref passed as `--base`, never the new branch name. With no starting
ref, the helper uses its default `@`.

The shared helper creates worktrees under
`~/Developer/worktrees/<remote-repository-name>/<sanitized-branch>/`.
For the primary IDL checkout `~/Developer/code/indirect`, the remote name is
`indirect-lending-application`; a request `ui-task` creates
`~/Developer/worktrees/indirect-lending-application/opencode-ui-task/`.
Existing branches or occupied paths fail rather than sharing an agent checkout.

Personal Worktrunk pre-start hooks run `git-worktree-setup`, which delegates to
`wt step copy-ignored --require-include`, and IDL additionally runs
`idl-worktree-setup`. Those hooks finish before creation returns, use APFS
reflinks where available for selected ignored files, and install the Zed tasks.
Keep the primary checkout's personal `.worktreeinclude` ignored and select
`.env`, `vendor/`, and `node_modules/` as needed. Do not select live MySQL data.
These policies and scripts remain in dotfiles.

Discovery reports the primary checkout plus this tool's worktrees in the
shared layout. Removal retains branches. Dirty removal raises the SDK's
`Worktree.OperationError` with `forceRequired: true`; force is passed to the
helper only when OpenCode requests it. Each helper subprocess receives the
OpenCode AbortSignal, and cancellation retains `AbortError`. Cancellation of
an external command may leave partial work requiring inspection.

Both plugin and strategy retain the ID `dotfiles.worktrunk` for compatibility
with persisted ownership. Registration uses OpenCode's transform lifecycle;
it does not rewrite existing worktrees' strategy IDs.

## Validation

```sh
cd opencode/worktrunk
npm ci --ignore-scripts
npm test
AGENT_WORKTREE_HELPER=/absolute/path/to/agent-worktree npm run test:package
AGENT_WORKTREE_HELPER=/absolute/path/to/agent-worktree npm run test:package -- --host
```

Contract tests use the real SDK and a temporary executable to inspect the helper
protocol and cancellation. The integration test uses the external helper and
real Git/Worktrunk with an isolated temporary home and repository; it skips
when `AGENT_WORKTREE_HELPER` is absent. It checks selected ignored-file copying,
exclusion of a dummy MySQL file, collisions, strategy inventory, dirty and clean
removal, and branch retention. It does not verify the personal IDL Zed hook or
APFS clone implementation, which belong to the helper's dotfiles tests.

`test:package` packs and extracts the package, installs its dependencies offline
from the npm cache, and runs the same tests against that independent copy.
Run `npm ci` first to populate the cache. `--host` additionally checks the
installed copy's registration using `opencode debug config --standalone` with
isolated configuration; the local server needs permission to bind a socket.
It does not start a model session or operate on real project worktrees.

See [the follow-up dotfiles migration](MIGRATION.md) before activating this package.
Official references: [plugins](https://opencode.ai/docs/build/plugins),
[worktree strategies](https://opencode.ai/docs/build/plugins/server#worktrees),
and [worktree configuration](https://opencode.ai/docs/config/#worktrees).

Validation on 2026-11-16 used Node 26.12.1 and OpenCode 2.3.0: both tests passed
against the workspace and the independently installed packed copy; the
standalone config check accepted the latter's registration. JavaScript syntax
and `git diff --check` also passed. The networked npm install reported 24
moderate advisories in the pinned dependency tree; an offline install's
"0 vulnerabilities" output is not a fresh audit. No SDK upgrade or automatic
audit fix was applied. Personal IDL hooks remain covered by the dotfiles tests.

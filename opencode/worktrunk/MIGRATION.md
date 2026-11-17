# Follow-up dotfiles migration (not applied)

Apply after this package is reviewed and available at its stable local checkout.
All paths below are relative to the dotfiles repository unless stated otherwise.
Do not activate a path pointing at a temporary validation copy.

1. Install the new package dependencies:

   ```sh
   npm ci --ignore-scripts --prefix "$HOME/Developer/repos/ammonkc/claude-fiyah/opencode/worktrunk"
   ```

2. In `packages/opencode/.config/opencode/worktree-settings.json`, replace the
   `{"package":"./plugins/worktrunk"}` entry with:

   ```json
   {
     "package": "/Users/ammon.casey/Developer/repos/ammonkc/claude-fiyah/opencode/worktrunk",
     "options": { "helperPath": "/Users/ammon.casey/.local/bin/agent-worktree" }
   }
   ```

   Keep `worktree.directory` and other personal settings. Adjust absolute paths
   for your machine; omitting `options` uses the helper's standard location.

3. In `taskfiles/dotfiles.yml`, task `agents:worktrees`, replace:

   ```yaml
   - npm ci --ignore-scripts --prefix "$HOME/.config/opencode/plugins/worktrunk"
   ```

   with:

   ```yaml
   - npm ci --ignore-scripts --prefix "$HOME/Developer/repos/ammonkc/claude-fiyah/opencode/worktrunk"
   ```

   Add a precondition checking the new package's `package-lock.json` exists.
   Update the task description to identify the external local package.

4. Update `scripts/agent-worktree-configure.py`'s `merge_opencode` to remove
   **only** the old registration before appending the new fragment entries:

   ```python
   plugins = result.setdefault("plugins", [])
   plugins[:] = [entry for entry in plugins
                 if entry != {"package": "./plugins/worktrunk"}]
   ```

   Its current append-only behavior would retain both registrations. Preserve
   unrelated plugins, private settings, backups and idempotence. If the old
   entry has custom options or an absolute path, explicitly migrate that exact
   entry after reviewing it. Extend the settings merge test to begin with the
   legacy entry and assert it is replaced, unrelated entries are preserved,
   and a second merge makes no changes.

5. Remove these tracked embedded files after removing their Stow links with
   the normal unstow/restow workflow:

   ```text
   packages/opencode/.config/opencode/plugins/worktrunk/index.mjs
   packages/opencode/.config/opencode/plugins/worktrunk/package.json
   packages/opencode/.config/opencode/plugins/worktrunk/package-lock.json
   tests/agent-worktrees-plugin.mjs
   ```

   Remove the `AGENT_OPENCODE_TEST_PLUGIN` conditional block at the end of
   `CreationTests` in `tests/agent-worktrees.py`. Keep the Python shared-helper
   and settings-merge tests and `tests/agent-worktrees.sh`. Run the relocated
   integration check separately in claude-fiyah with
   `AGENT_WORKTREE_HELPER` pointing at dotfiles' helper. Clean up only confirmed
   obsolete installed links/dependencies after inspecting their targets.

6. Update `packages/opencode/README.md` to say dotfiles stows instructions and
   settings only, and link to claude-fiyah's `opencode/worktrunk/README.md` for
   package installation, tests and source. Keep personal behavior, setup and
   activation instructions here. Keep `agent-worktree`, both setup scripts,
   the settings fragment, Worktrunk config and IDL ignored include in dotfiles.

7. Restow the affected package, run `dotfiles dot:agents:worktrees`, inspect the
   merged personal config for exactly one Worktrunk registration, validate with
   `opencode debug config --standalone`, then restart OpenCode. Keep the ID
   `dotfiles.worktrunk` unchanged; do not edit persisted ownership for existing
   worktrees. Run dotfiles' shared-helper/settings and config tests afterward.

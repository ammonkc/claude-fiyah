import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, access, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("real SDK and external helper create, discover, reject collisions and safely remove", {
  skip: !process.env.AGENT_WORKTREE_HELPER && "set AGENT_WORKTREE_HELPER to the external agent-worktree executable",
}, async (t) => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "worktrunk-integration-")));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const home = join(scratch, "home with spaces");
  const repo = join(home, "Developer/code/indirect");
  await mkdir(repo, { recursive: true });
  const config = join(scratch, "config.toml");
  await writeFile(config, 'pre-start = "wt step copy-ignored --require-include"\n[remove]\ndelete-branch = false\n');
  // This test process is isolated by node:test. Every helper operation sees the fixture home.
  process.env.HOME = home;
  process.env.WORKTRUNK_CONFIG_PATH = config;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  process.env.XDG_DATA_HOME = join(home, ".local/share");
  process.env.GIT_CONFIG_GLOBAL = join(scratch, "empty-gitconfig");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  await writeFile(process.env.GIT_CONFIG_GLOBAL, "");
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.test");
  git("config", "commit.gpgsign", "false");
  git("remote", "add", "origin", "https://github.com/fixture/indirect-lending-application.git");
  await writeFile(join(repo, ".gitignore"), ".worktreeinclude\nvendor/\nmysql/\n");
  git("add", ".gitignore");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  await writeFile(join(repo, ".worktreeinclude"), "vendor/\n");
  await mkdir(join(repo, "vendor"));
  await writeFile(join(repo, "vendor/dependency"), "selected");
  await mkdir(join(repo, "mysql"));
  await writeFile(join(repo, "mysql/data"), "excluded");
  const { default: plugin } = await import(process.env.AGENT_PLUGIN_PATH
    ? pathToFileURL(process.env.AGENT_PLUGIN_PATH) : new URL("../index.mjs", import.meta.url));
  let strategy;
  await plugin.setup({ options: { helperPath: process.env.AGENT_WORKTREE_HELPER }, worktree: {
    transform: async (fn) => fn({ add(value) { strategy = value; } }),
  } });
  const context = { signal: new AbortController().signal };
  const input = { sourceDirectory: repo, directory: "/suggested/ui-task", branch: "main" };
  const result = await strategy.create(input, context);
  assert.equal(result.directory, join(home, "Developer/worktrees/indirect-lending-application/opencode-ui-task"));
  assert.equal(execFileSync("git", ["-C", result.directory, "branch", "--show-current"], { encoding: "utf8" }).trim(), "opencode/ui-task");
  assert.equal(await readFile(join(result.directory, "vendor/dependency"), "utf8"), "selected");
  await assert.rejects(access(join(result.directory, "mysql/data")));
  await assert.rejects(strategy.create(input, context));
  git("worktree", "add", "-qb", "codex/other", join(scratch, "other"));
  assert.deepEqual(await strategy.list(repo, context), [{ directory: repo, type: "root" }, { directory: result.directory, type: "worktree" }]);
  await assert.rejects(strategy.remove({ directory: repo }, context));
  await writeFile(join(result.directory, "work-in-progress"), "keep this");
  await assert.rejects(strategy.remove({ directory: result.directory, force: false }, context), (error) => error.forceRequired === true);
  await access(join(result.directory, "work-in-progress"));
  await strategy.remove({ directory: result.directory, force: true }, context);
  await assert.rejects(access(result.directory));
  git("show-ref", "--verify", "refs/heads/opencode/ui-task");
  const clean = await strategy.create({ ...input, directory: "/suggested/clean-task" }, context);
  await strategy.remove({ directory: clean.directory, force: false }, context);
  git("show-ref", "--verify", "refs/heads/opencode/clean-task");
});

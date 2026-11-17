import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, realpathSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "worktrunk-package-")));
const cache = process.env.npm_config_cache || execFileSync("npm", ["config", "get", "cache"], { encoding: "utf8" }).trim();
const npmOptions = ["--cache", cache, "--logs-dir", join(scratch, "npm-logs")];
try {
  const [packed] = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch, ...npmOptions], { cwd: root, encoding: "utf8" }));
  execFileSync("tar", ["-xzf", join(scratch, packed.filename), "-C", scratch]);
  const installed = join(scratch, "package");
  // npm pack excludes package-lock.json; use the repository lock for reproducibility.
  copyFileSync(join(root, "package-lock.json"), join(installed, "package-lock.json"));
  execFileSync("npm", ["ci", "--ignore-scripts", "--offline", ...npmOptions], { cwd: installed, stdio: "inherit" });
  execFileSync(process.execPath, ["--test", join(root, "tests/strategy.test.mjs"), join(root, "tests/integration.test.mjs")], {
    cwd: scratch, stdio: "inherit", env: { ...process.env, AGENT_PLUGIN_PATH: join(installed, "index.mjs") },
  });
  if (process.argv.includes("--host")) {
    const home = join(scratch, "host-home");
    const config = join(home, ".config/opencode");
    mkdirSync(config, { recursive: true });
    const configPath = join(config, "opencode.json");
    writeFileSync(configPath, JSON.stringify({ plugins: [{ package: installed,
      options: { helperPath: process.env.AGENT_WORKTREE_HELPER || join(home, ".local/bin/agent-worktree") },
    }], worktree: { directory: "~/Developer/worktrees" } }));
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local/share"), XDG_CACHE_HOME: join(home, ".cache"),
      XDG_STATE_HOME: join(home, ".local/state"), OPENCODE_CONFIG: configPath };
    delete env.OPENCODE_CONFIG_CONTENT;
    delete env.OPENCODE_CONFIG_DIR;
    console.log(execFileSync("opencode", ["--version"], { cwd: scratch, env, encoding: "utf8", timeout: 30000 }).trim());
    const output = execFileSync("opencode", ["debug", "config", "--standalone"], {
      cwd: scratch, env, encoding: "utf8", timeout: 30000,
    });
    if (!output.includes(installed)) throw new Error("OpenCode did not report the installed package configuration");
    console.log("OpenCode standalone config accepted the isolated installed-package registration.");
  }
  console.log("Packed, extracted, installed and tested the package without workspace links.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

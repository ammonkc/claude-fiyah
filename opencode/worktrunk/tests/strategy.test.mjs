import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { default: plugin, createStrategy } = await import(process.env.AGENT_PLUGIN_PATH
  ? pathToFileURL(process.env.AGENT_PLUGIN_PATH) : new URL("../index.mjs", import.meta.url));

test("SDK registration, helper protocol, starting ref, force and cancellation", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "worktrunk-contract-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const helperPath = join(scratch, "helper with spaces");
  const log = join(scratch, "args.json");
  await writeFile(helperPath, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(args));
if (args[0] === 'create') console.log(JSON.stringify({directory: '/actual/opencode-task'}));
if (args[0] === 'list' && args.at(-1) !== 'wait') console.log(JSON.stringify([{directory: '/primary', type: 'root'}]));
if (args[0] === 'list' && args.at(-1) === 'wait') setTimeout(() => {}, 30000);
if (args[0] === 'remove' && !args.includes('--force')) { console.error('uncommitted changes'); process.exit(1); }
`, { mode: 0o755 });
  let strategy;
  let transforms = 0;
  await plugin.setup({ options: { helperPath }, worktree: { transform: async (fn) => {
    transforms++;
    fn({ add(value) { strategy = value; } });
  } } });
  assert.equal(transforms, 1);
  assert.equal(strategy.id, "dotfiles.worktrunk");
  assert.equal(plugin.id, strategy.id);
  const context = { signal: new AbortController().signal };
  const args = async () => JSON.parse(await readFile(log, "utf8"));
  assert.deepEqual(await strategy.create({ sourceDirectory: "/source with spaces", directory: "/suggested/task", branch: "starting-ref" }, context), { directory: "/actual/opencode-task" });
  assert.deepEqual(await args(), ["create", "--tool", "opencode", "--repo", "/source with spaces", "--json", "task", "--base", "starting-ref"]);
  await strategy.create({ sourceDirectory: "/source", directory: "/suggested/task" }, context);
  assert.ok(!(await args()).includes("--base"));
  assert.deepEqual(await strategy.list("/primary", context), [{ directory: "/primary", type: "root" }]);
  await assert.rejects(strategy.remove({ directory: "/actual", force: false }, context), (error) => error.forceRequired === true);
  await strategy.remove({ directory: "/actual", force: true }, context);
  assert.deepEqual(await args(), ["remove", "--tool", "opencode", "/actual", "--force"]);
  await assert.rejects(strategy.list("wait", { signal: AbortSignal.timeout(100) }), { name: "AbortError" });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(strategy.create({ sourceDirectory: "/source", directory: "/task" }, { signal: controller.signal }), { name: "AbortError" });
  assert.throws(() => createStrategy({ helperPath: "relative/path" }), /absolute/);
  await assert.rejects(createStrategy({ helperPath: join(scratch, "missing") }).list("/source", context), /ENOENT/);
});

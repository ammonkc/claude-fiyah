import { execFile } from "node:child_process";
import { basename, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { Plugin, Worktree } from "@opencode/plugin";

// Preserve the original ID: OpenCode persists strategy ownership per worktree.
const id = "dotfiles.worktrunk";

export function createStrategy({ helperPath = join(homedir(), ".local/bin/agent-worktree") } = {}) {
  if (typeof helperPath !== "string" || !isAbsolute(helperPath)) {
    throw new TypeError("helperPath must be an absolute executable path");
  }
  function invoke(args, signal) {
    return new Promise((resolve, reject) => {
      execFile(helperPath, args, { signal, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(error.name === "AbortError" ? error : new Error(stderr.trim() || error.message, { cause: error }));
        else resolve(stdout);
      });
    });
  }

  return {
    id,
    async create(input, { signal }) {
      const args = [
        "create", "--tool", "opencode", "--repo", input.sourceDirectory,
        "--json", basename(input.directory),
      ];
      if (input.branch) args.push("--base", input.branch);
      const result = JSON.parse(await invoke(args, signal));
      return { directory: result.directory };
    },
    async remove(input, { signal }) {
      const args = ["remove", "--tool", "opencode", input.directory];
      if (input.force) args.push("--force");
      try {
        await invoke(args, signal);
      } catch (error) {
        if (!input.force && /uncommitted changes/.test(error.message)) {
          throw new Worktree.OperationError({ message: error.message, forceRequired: true });
        }
        throw error;
      }
    },
    async list(sourceDirectory, { signal }) {
      return JSON.parse(await invoke(["list", "--tool", "opencode", "--repo", sourceDirectory], signal));
    },
  };
}

export default Plugin.define({
  id,
  async setup(ctx) {
    await ctx.worktree.transform((editor) => editor.add(createStrategy(ctx.options)));
  },
});

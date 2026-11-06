#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
bun build skills/codex-obsidian-capture/src/note-format.ts --target=node --format=esm --outfile=skills/codex-obsidian-capture/runtime/shared.mjs

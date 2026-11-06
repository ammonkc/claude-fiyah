#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
bun build mods/obsidian-capture/hooks/shared.ts --target=node --format=esm --outfile=skills/codex-obsidian-capture/runtime/shared.mjs

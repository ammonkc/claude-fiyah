#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export async function packageMarketplace(destination) {
  if (!path.isAbsolute(destination)) throw new Error('destination must be absolute');
  // Require a new directory, so staging cannot overwrite configuration or a checkout.
  await fs.mkdir(destination);
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const plugin=path.join(destination,'skills/codex-obsidian-capture');
  await fs.mkdir(plugin,{recursive:true});
  for (const file of ['runtime','skills','hooks','.codex-plugin','packaging','config.example.json','README.md','COMPATIBILITY.md']) await fs.cp(path.join(root,file),path.join(plugin,file),{recursive:true});
  await fs.mkdir(path.join(destination,'.agents/plugins'),{recursive:true});
  await fs.copyFile(path.join(root,'packaging/marketplace.json'),path.join(destination,'.agents/plugins/marketplace.json'));
  return destination;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(await packageMarketplace(process.argv[2] || ''));}
  catch(error) {console.error(error.code || error.message);process.exitCode=1;}
}

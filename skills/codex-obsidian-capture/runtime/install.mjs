#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite, readOptional, locked, safeDestination } from './capture.mjs';
import { quote } from './adapter.mjs';
const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ownedSuffix=' # obsidian-plan-capture-owned-v1';
export async function install(home, remove=false) {
  if (!path.isAbsolute(home)) throw new Error('--home must be absolute; no implicit live install');
  await fs.mkdir(home,{recursive:true}); home=await fs.realpath(home);
  return locked(home,async()=>{
    const target=await safeDestination(home,'packages/obsidian-plan-capture');
    const hooksFile=await safeDestination(home,'hooks.json');
    const skill=await safeDestination(home,'skills');
    const link=path.join(skill,'obsidian-plan');
    const oldLink=await fs.lstat(link).catch(e=>{if(e.code!=='ENOENT')throw e;});
    const ownedLink=oldLink?.isSymbolicLink() && await fs.readlink(link)===path.join(target,'skills/obsidian-plan');
    if (oldLink && !ownedLink) throw new Error('existing obsidian-plan skill is not owned; refusing replacement');
    const hooks=JSON.parse(await readOptional(hooksFile) || '{"hooks":{}}');
    if (!hooks.hooks || typeof hooks.hooks!=='object' || Array.isArray(hooks.hooks)) throw new Error('invalid hooks document');
    // Remove only our command handlers. Preserve unrelated handlers inside mixed groups.
    for (const event of ['PostToolUse','Stop']) {
      if (hooks.hooks[event] && !Array.isArray(hooks.hooks[event])) throw new Error('invalid hook event list');
      if (hooks.hooks[event]) hooks.hooks[event]=hooks.hooks[event].flatMap(group=>{
        if (!Array.isArray(group.hooks)) throw new Error('invalid hook group');
        const keep=group.hooks.filter(h=>!(h.type==='command' && h.command===`node ${quote(path.join(target,'runtime/cli.mjs'))} hook${ownedSuffix}`));
        if (keep.length===group.hooks.length) return [group];
        return keep.length ? [{...group,hooks:keep}] : [];
      });
    }
    if (!remove) {
      const owner=path.join(target,'.installer-owner');
      const targetStat=await fs.lstat(target).catch(e=>{if(e.code!=='ENOENT')throw e;});
      if (targetStat && await readOptional(owner)!=='obsidian-plan-capture-v1\n') throw new Error('existing package is not installer-owned');
      // Copy all runtime dependencies. Do not consume sibling checkout files during use.
      await fs.mkdir(target,{recursive:true});
      for (const name of ['runtime','src','skills','hooks','.codex-plugin','packaging','config.example.json','README.md','COMPATIBILITY.md']) {
        // Existing symlinks anywhere in an upgrade destination are refused.
        async function noLinks(dir) {
          for (const e of await fs.readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})) {
            if (e.isSymbolicLink()) throw new Error('package upgrade contains symlink');
            if (e.isDirectory()) await noLinks(path.join(dir,e.name));
          }
        }
        await noLinks(target);
        await fs.cp(path.join(packageRoot,name),path.join(target,name),{recursive:true});
      }
      await atomicWrite(owner,'obsidian-plan-capture-v1\n');
      await fs.mkdir(skill,{recursive:true});
      if (!oldLink) await fs.symlink(path.join(target,'skills/obsidian-plan'),link);
      for (const event of ['PostToolUse','Stop']) {
        hooks.hooks[event] ||= [];
        hooks.hooks[event].push({hooks:[{type:'command',command:`node ${quote(path.join(target,'runtime/cli.mjs'))} hook${ownedSuffix}`,timeout:5}]});
      }
    }
    await atomicWrite(hooksFile,JSON.stringify(hooks,null,2)+'\n');
    if (remove && ownedLink) await fs.unlink(link);
    // Keep package files and user configuration on uninstall for review/recovery; only registration is removed.
    return {home,removed:remove,package:target};
  });
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [command,...args]=process.argv.slice(2),home=args[args.indexOf('--home')+1];
  try {
    if (!['install','uninstall'].includes(command) || !args.includes('--home')) throw new Error('usage: install.mjs install|uninstall --home ABSOLUTE_CODEX_HOME');
    console.log(JSON.stringify(await install(home,command==='uninstall')));
  } catch(error) {console.error(`obsidian-plan installer: ${error instanceof SyntaxError ? 'invalid hooks JSON' : error.code || error.message}`);process.exitCode=1;}
}

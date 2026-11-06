import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {capture,loadConfig,parseArtifact} from '../runtime/capture.mjs';
import {adapt} from '../runtime/adapter.mjs';
import {install} from '../runtime/install.mjs';
import {packageMarketplace} from '../runtime/package.mjs';
const event={hook_event_name:'PostToolUse',tool_name:'exec_command',tool_response:{exit_code:0},session_id:'real-host-fixture-needed'};
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-plan-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const sourceDirectory=path.join(root,'sources'),vaultPath=path.join(root,'vault');
  await fs.mkdir(sourceDirectory);await fs.mkdir(vaultPath);
  const file=path.join(sourceDirectory,'plan with spaces.md'),configFile=path.join(root,'config.json');
  await fs.writeFile(configFile,JSON.stringify({sourceDirectory,vaultPath}));
  const config=await loadConfig(configFile);
  const meta={capture_schema:'1',kind:'engineering-plan',capture_state:'complete',plan_id:'stable-plan-12345',title:'Repair deployment',repository:'/project with spaces',created:'2026-11-06T17:00:00Z',updated:'2026-11-06T17:00:00Z',status:'draft'};
  const write=async (changes={},body='# Repair deployment\n\nConcrete work and tests.')=> {Object.assign(meta,changes);await fs.writeFile(file,'---\n'+Object.entries(meta).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join('\n')+'\n---\n'+body);};
  await write();
  return {root,file,config,configFile,meta,write,plan:r=>path.join(vaultPath,r.plan+'.md'),prompt:r=>path.join(vaultPath,r.prompt+'.md')};
}
test('initial pair has YAML metadata, reciprocal links, journal and genuine metadata only',async t=>{
 const f=await fixture(t),r=await capture(f.config,f.file),note=await fs.readFile(f.plan(r),'utf8'),prompt=await fs.readFile(f.prompt(r),'utf8');
 assert.equal(r.plan,'Projects/Engineering/Plans/11-06-2026-repair-deployment');
 assert.match(note,/Journal\/2026\/11-November\/11-06-2026/);assert.ok(note.includes(`[[${r.prompt}|Implementation prompt]]`));
 assert.ok(prompt.includes(`[[${r.plan}|Repair deployment]]`));assert.ok(prompt.includes(f.plan(r)));assert.ok(prompt.includes('Obsidian vault "vault"'));assert.match(prompt,/does not authorize commits/);assert.ok(!note.includes('\nsession:'));assert.match(note,/status: "draft"/);
});
test('stable identity survives rename, changed title, date and session; preserves custom YAML/body/prompt',async t=>{
 const f=await fixture(t),r=await capture(f.config,f.file);
 await fs.appendFile(f.plan(r),'\n## My notes\nKeep me\n');
 let note=await fs.readFile(f.plan(r),'utf8');await fs.writeFile(f.plan(r),note.replace('---\n','---\ncustom:\n  nested: value\n'));
 await fs.appendFile(f.prompt(r),'\nManual instruction.\n');
 await f.write({title:'Renamed',created:'2027-01-01T00:00:00Z',session_id:'host-session',updated:'2027-01-02T00:00:00Z'},'Revised plan');
 const renamed=path.join(f.config.sourceDirectory,'renamed.md');await fs.rename(f.file,renamed);
 const r2=await capture(f.config,renamed);assert.equal(r2.plan,r.plan);assert.equal(r2.prompt,r.prompt);
 note=await fs.readFile(f.plan(r),'utf8');assert.match(note,/custom:\n  nested: value/);assert.match(note,/My notes\nKeep me/);assert.match(note,/Revised plan/);assert.match(note,/session: "host-session"/);
 assert.match(await fs.readFile(f.prompt(r),'utf8'),/Manual instruction/);
});
test('same title different identity has collision-safe independent notes',async t=>{
 const f=await fixture(t),r=await capture(f.config,f.file);await f.write({plan_id:'another-plan-12345'});const r2=await capture(f.config,f.file);assert.notEqual(r2.plan,r.plan);assert.notEqual(r2.prompt,r.prompt);
});
test('duplicate and concurrent delivery is idempotent',async t=>{
 const f=await fixture(t),results=await Promise.all(Array.from({length:6},()=>capture(f.config,f.file)));assert.equal(new Set(results.map(r=>r.plan)).size,1);
 const before=await fs.stat(f.plan(results[0]));await capture(f.config,f.file);assert.equal((await fs.stat(f.plan(results[0]))).mtimeMs,before.mtimeMs);
 assert.equal((await fs.readdir(path.dirname(f.plan(results[0])))).length,1);
});
test('partial prompt failure leaves recoverable identity, and retry repairs missing prompt',async t=>{
 const f=await fixture(t);const dir=path.join(f.config.vaultPath,f.config.promptsFolder);await fs.mkdir(dir,{recursive:true});
 // Make the predicted prompt a directory after name resolution but before prompt write, using a plan from initial capture.
 const r=await capture(f.config,f.file);await fs.unlink(f.prompt(r));await fs.mkdir(f.prompt(r));await f.write({},'Revision after partial failure');
 await assert.rejects(capture(f.config,f.file),{code:'EISDIR'});await fs.rmdir(f.prompt(r));
 const repaired=await capture(f.config,f.file);assert.equal(repaired.plan,r.plan);assert.match(await fs.readFile(f.prompt(r),'utf8'),/Implementation Prompt/);
 assert.match(await fs.readFile(f.plan(r),'utf8'),/Revision after partial failure/);
});
test('missing, ambiguous and explicit vault selection; no open-vault fallback',async t=>{
 const f=await fixture(t),registry=path.join(f.root,'registry.json');await fs.writeFile(registry,JSON.stringify({vaults:{other:{path:f.config.vaultPath,open:true}}}));
 await assert.rejects(capture({...f.config,vaultPath:undefined,registryPath:registry},f.file),/found 0/);
 await fs.writeFile(registry,JSON.stringify({vaults:{a:{path:f.config.vaultPath},b:{path:f.config.vaultPath}}}));
 await assert.rejects(capture({...f.config,vaultPath:undefined,vault:'vault',registryPath:registry},f.file),/found 2/);
 await assert.rejects(capture({...f.config,vaultPath:path.join(f.root,'missing')},f.file),{code:'ENOENT'});
});
test('Unicode and spaces work; traversal configuration and symlink destinations are refused',async t=>{
 const f=await fixture(t);await f.write({title:'修復 Café & deploy'});const r=await capture(f.config,f.file);assert.match(r.plan,/修復-café-and-deploy/);
 await fs.writeFile(f.configFile,JSON.stringify({...f.config,plansFolder:'../escape'}));await assert.rejects(loadConfig(f.configFile),/unsafe/);
 const g=await fixture(t);await fs.mkdir(path.join(g.config.vaultPath,'Projects'));await fs.symlink(g.root,path.join(g.config.vaultPath,'Projects/Engineering'));
 await assert.rejects(capture(g.config,g.file),/symlink/);
});
test('damaged markers, duplicate identities and prompt identity mismatch fail without clobbering',async t=>{
 const f=await fixture(t),r=await capture(f.config,f.file),original=await fs.readFile(f.plan(r),'utf8');
 await fs.writeFile(f.plan(r),original.replace('<!-- plan:end -->',''));await assert.rejects(capture(f.config,f.file),/markers damaged/);
 await fs.writeFile(f.plan(r),original);await fs.copyFile(f.plan(r),f.plan(r).replace('.md','-duplicate.md'));await assert.rejects(capture(f.config,f.file),/duplicate plan_id/);
 await fs.unlink(f.plan(r).replace('.md','-duplicate.md'));await fs.writeFile(f.prompt(r),'Manual prompt with no identity');await assert.rejects(capture(f.config,f.file),/identity mismatch/);assert.equal(await fs.readFile(f.prompt(r),'utf8'),'Manual prompt with no identity');
});
test('drafts, arbitrary Markdown, non-plan events and recursive Stop do not request capture',async t=>{
 const f=await fixture(t);await f.write({capture_state:'draft'});assert.deepEqual(await adapt(event,f.config,f.configFile,'/cli'),{});await assert.rejects(capture(f.config,f.file),/not complete/);
 await fs.writeFile(f.file,'# ordinary markdown');assert.deepEqual(await adapt(event,f.config,f.configFile,'/cli'),{});
 await f.write({capture_state:'complete'});assert.deepEqual(await adapt({hook_event_name:'PreToolUse'},f.config,f.configFile,'/cli'),{});assert.deepEqual(await adapt({hook_event_name:'Stop',stop_hook_active:true},f.config,f.configFile,'/cli'),{});
});
test('exec/apply_patch completed events request sandboxed capture; receipt suppresses recursion',async t=>{
 const f=await fixture(t);
 for (const tool_name of ['exec_command','apply_patch']) {
  const output=await adapt({...event,tool_name},f.config,f.configFile,"/package with spaces/cli.mjs");assert.match(output.hookSpecificOutput.additionalContext,/normal sandboxed exec/);assert.ok(output.hookSpecificOutput.additionalContext.includes("'/package with spaces/cli.mjs'"));
 }
 await capture(f.config,f.file);assert.deepEqual(await adapt(event,f.config,f.configFile,'/cli'),{});
 await f.write({},'Revision');assert.ok((await adapt(event,f.config,f.configFile,'/cli')).hookSpecificOutput);
 assert.deepEqual(await adapt(event,{...f.config,automatic:false},f.configFile,'/cli'),{});
});
test('source/vault overlap, outside sources and receipt symlinks fail clearly',async t=>{
 const f=await fixture(t);await assert.rejects(capture({...f.config,vaultPath:f.config.sourceDirectory},f.file),/overlap/);
 const outside=path.join(f.root,'outside.md');await fs.copyFile(f.file,outside);await assert.rejects(capture(f.config,outside),/direct Markdown child/);
 const receipt=path.join(f.config.sourceDirectory,`.capture-${f.meta.plan_id}.json`);await fs.symlink(outside,receipt);await assert.rejects(capture(f.config,f.file),/symlink/);
});
test('invalid contracts reject missing frontmatter and duplicate metadata',()=>{
 assert.throws(()=>parseArtifact('# no metadata'),/frontmatter/);
 assert.throws(()=>parseArtifact('---\ntitle: "x"\ntitle: "y"\n---\nbody'),/duplicate/);
});
test('manual command runs with installed runtime dependencies and no checkout sibling',async t=>{
 const f=await fixture(t),home=path.join(f.root,'home');await install(home);const {spawnSync}=await import('node:child_process');
 const result=spawnSync(process.execPath,[path.join(home,'packages/obsidian-plan-capture/runtime/cli.mjs'),'capture','--config',f.configFile,'--source',f.file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).ok,true);
});
test('installer rerun and uninstall preserve Orca, other hooks, mixed groups and user configuration',async t=>{
 const f=await fixture(t),home=path.join(f.root,'home');await fs.mkdir(home);
 const original={custom:'retain',hooks:{Stop:[{matcher:'*',hooks:[{type:'command',command:'orca hook'},{type:'command',command:'other hook'}]}],PreToolUse:[{hooks:[{type:'command',command:'unrelated'}]}]}};
 await fs.writeFile(path.join(home,'hooks.json'),JSON.stringify(original));await install(home);await install(home);
 let hooks=JSON.parse(await fs.readFile(path.join(home,'hooks.json'),'utf8'));assert.equal(hooks.hooks.Stop.length,2);assert.deepEqual(hooks.hooks.PreToolUse,original.hooks.PreToolUse);
 await install(home,true);await install(home,true);hooks=JSON.parse(await fs.readFile(path.join(home,'hooks.json'),'utf8'));assert.deepEqual(hooks.hooks.Stop,original.hooks.Stop);assert.deepEqual(hooks.hooks.PreToolUse,original.hooks.PreToolUse);assert.equal(hooks.custom,'retain');
});
test('installer refuses pre-existing non-owned skill',async t=>{
 const f=await fixture(t),home=path.join(f.root,'home');await fs.mkdir(path.join(home,'skills/obsidian-plan'),{recursive:true});await assert.rejects(install(home),/not owned/);
});
test('EACCES from real filesystem permission denial is reported, not treated as missing',async t=>{
 const f=await fixture(t);await fs.chmod(f.config.vaultPath,0o500);try {await assert.rejects(capture(f.config,f.file),{code:'EACCES'});} finally {await fs.chmod(f.config.vaultPath,0o700);}
});
test('packager produces complete native manifest, hooks and runtime in new directory only',async t=>{
 const f=await fixture(t),destination=path.join(f.root,'marketplace');await packageMarketplace(destination);
 const manifest=JSON.parse(await fs.readFile(path.join(destination,'.agents/plugins/marketplace.json'),'utf8'));assert.equal(manifest.plugins[0].source,'./skills/codex-obsidian-capture');
 assert.ok(await fs.stat(path.join(destination,'skills/codex-obsidian-capture/runtime/shared.mjs')));await assert.rejects(packageMarketplace(destination),{code:'EEXIST'});
});

test('installer rejects unknown package and malformed hook JSON, and preserves empty groups',async t=>{
 const f=await fixture(t),home=path.join(f.root,'home');await fs.mkdir(path.join(home,'packages/obsidian-plan-capture'),{recursive:true});await assert.rejects(install(home),/not installer-owned/);
 const g=await fixture(t),other=path.join(g.root,'home');await fs.mkdir(other);await fs.writeFile(path.join(other,'hooks.json'),'{broken');await assert.rejects(install(other),SyntaxError);
 await fs.writeFile(path.join(other,'hooks.json'),JSON.stringify({hooks:{Stop:[{matcher:'custom',hooks:[]}]}}));await install(other);await install(other,true);assert.deepEqual(JSON.parse(await fs.readFile(path.join(other,'hooks.json'),'utf8')).hooks.Stop,[{matcher:'custom',hooks:[]}]);
});
test('malformed artifact timestamps, completion state and embedded markers are rejected',async t=>{
 const f=await fixture(t);await f.write({updated:'not a date'});await assert.rejects(capture(f.config,f.file),/invalid updated/);
 await f.write({updated:'2026-11-06T17:00:00Z',capture_state:'unknown'});await assert.rejects(capture(f.config,f.file),/unsupported artifact/);
 await f.write({capture_state:'complete'},'<!-- plan:start --> body');await assert.rejects(capture(f.config,f.file),/reserved plan markers/);
});
test('manual CLI failures report denied/missing access without leaking payload or generating notes',async t=>{
 const f=await fixture(t),{spawnSync}=await import('node:child_process');const cli=path.resolve('skills/codex-obsidian-capture/runtime/cli.mjs');
 await fs.writeFile(f.configFile,'{\"private_token\":\"do-not-log');const result=spawnSync(process.execPath,[cli,'hook','--config',f.configFile],{input:JSON.stringify(event),encoding:'utf8'});assert.equal(result.status,1);assert.ok(!result.stderr.includes('do-not-log'));assert.match(JSON.parse(result.stdout).systemMessage,/invalid JSON/);
});

test('destination configuration changes reuse identity-bearing note and prompt from receipt',async t=>{
 const f=await fixture(t),first=await capture(f.config,f.file);await f.write({},'Revised after configuration change');
 const second=await capture({...f.config,plansFolder:'Other/Plans',promptsFolder:'Other/Prompts'},f.file);assert.equal(second.plan,first.plan);assert.equal(second.prompt,first.prompt);assert.match(await fs.readFile(f.plan(first),'utf8'),/Revised after configuration change/);
});

test('observed Codex 0.167.0 Bash, apply_patch and Stop payloads request capture and receipts suppress delivery',async t=>{
 const f=await fixture(t);
 for (const name of ['post-tool-use-bash.json','post-tool-use-apply-patch.json','stop.json']) {
  const observed=JSON.parse(await fs.readFile(new URL(`fixtures/${name}`,import.meta.url),'utf8'));
  const output=await adapt(observed,f.config,f.configFile,'/installed/cli.mjs');
  assert.ok(observed.hook_event_name==='Stop' ? output.systemMessage : output.hookSpecificOutput?.additionalContext);
 }
 const observed=JSON.parse(await fs.readFile(new URL('fixtures/post-tool-use-bash.json',import.meta.url),'utf8'));
 const result=await capture(f.config,f.file,observed.session_id);
 const note=await fs.readFile(f.plan(result),'utf8');assert.ok(note.includes('capture_session: '+JSON.stringify(observed.session_id)));assert.ok(!note.includes('\nsession:'));
 assert.deepEqual(await adapt(observed,f.config,f.configFile,'/installed/cli.mjs'),{});
});

test('omitted sourceDirectory follows absolute XDG state, with fallback and explicit override independent of CODEX_HOME',async t=>{
 const f=await fixture(t),{spawnSync}=await import('node:child_process');
 const customState=path.join(f.root,'custom state'),fakeHome=path.join(f.root,'home'),codexHome=path.join(f.root,'dotfiles/codex/.codex');
 await fs.writeFile(f.configFile,JSON.stringify({vaultPath:f.config.vaultPath}));
 const moduleUrl=new URL('../runtime/capture.mjs',import.meta.url).href;
 const resolve=xdg=>{
  const env={...process.env,HOME:fakeHome,CODEX_HOME:codexHome};delete env.XDG_STATE_HOME;if(xdg!==undefined)env.XDG_STATE_HOME=xdg;
  const result=spawnSync(process.execPath,['--input-type=module','-e',`import {loadConfig} from ${JSON.stringify(moduleUrl)}; console.log((await loadConfig(process.argv[1])).sourceDirectory);`,f.configFile],{env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return result.stdout.trim();
 };
 assert.equal(resolve(customState),path.join(customState,'codex/plans'));
 for(const xdg of [undefined,'','relative/state'])assert.equal(resolve(xdg),path.join(fakeHome,'.local/state/codex/plans'));
 await fs.writeFile(f.configFile,JSON.stringify({sourceDirectory:f.config.sourceDirectory,vaultPath:f.config.vaultPath}));
 assert.equal(resolve(customState),f.config.sourceDirectory);
});

test('installed CLI captures via Stow-folded config and XDG default without writing to dotfiles',async t=>{
 const f=await fixture(t),{spawnSync}=await import('node:child_process');
 const packageHome=path.join(f.root,'installed-home');await install(packageHome);
 const dotfiles=path.join(f.root,'dotfiles/codex/.codex'),deployedHome=path.join(f.root,'home/.codex'),state=path.join(f.root,'state');
 await fs.mkdir(dotfiles,{recursive:true});await fs.mkdir(path.dirname(deployedHome),{recursive:true});await fs.symlink(dotfiles,deployedHome);
 const configText=JSON.stringify({vaultPath:f.config.vaultPath,automatic:true});await fs.writeFile(path.join(dotfiles,'obsidian-capture.json'),configText);
 const sourceDir=path.join(state,'codex/plans');await fs.mkdir(sourceDir,{recursive:true});const source=path.join(sourceDir,'plan.md');await fs.copyFile(f.file,source);
 const result=spawnSync(process.execPath,[path.join(packageHome,'packages/obsidian-plan-capture/runtime/cli.mjs'),'capture','--source',source],{env:{...process.env,CODEX_HOME:deployedHome,XDG_STATE_HOME:state,OBSIDIAN_CAPTURE_CONFIG:''},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);const captured=JSON.parse(result.stdout);assert.ok(await fs.stat(f.plan(captured)));
 assert.equal((await fs.lstat(deployedHome)).isSymbolicLink(),true);
 assert.equal(await fs.readFile(path.join(dotfiles,'obsidian-capture.json'),'utf8'),configText);
 assert.deepEqual(await fs.readdir(dotfiles),['obsidian-capture.json']);
 assert.ok((await fs.readdir(sourceDir)).some(name=>name.startsWith('.capture-')));
});

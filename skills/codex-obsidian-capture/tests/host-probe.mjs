// Real Codex app-server packaging/trust probe. No model calls, trust bypass or permission changes.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {packageMarketplace} from '../runtime/package.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-host-probe-'));
const repositoryMode=process.argv.includes('--repository');
const home=path.join(root,'home'),marketplace=repositoryMode ? fileURLToPath(new URL('../../../',import.meta.url)) : path.join(root,'marketplace');
await fs.mkdir(home);await fs.writeFile(path.join(home,'config.toml'),'cli_auth_credentials_store = "file"\n[features]\nplugins = true\nhooks = true\nremote_plugin = false\n');
if (!repositoryMode) await packageMarketplace(marketplace);
const env={...process.env,CODEX_HOME:home};
const run=args=>{const r=spawnSync('codex',args,{env,encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr);return JSON.parse(r.stdout);};
const added=run(['plugin','marketplace','add',marketplace,'--json']);
const installed=run(['plugin','add','codex-obsidian-capture@claude-fiyah-codex','--json']);
const server=spawn('codex',['app-server','--stdio'],{env,stdio:['pipe','pipe','pipe']});
server.stderr.resume();
const pending=new Map();
createInterface({input:server.stdout}).on('line',line=>{const result=JSON.parse(line);const entry=pending.get(result.id);if(entry){pending.delete(result.id);clearTimeout(entry.timer);result.error ? entry.reject(new Error(result.error.message)) : entry.resolve(result.result);}});
let sequence=0;
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>reject(new Error(`RPC timeout: ${method}`)),10000);pending.set(id,{resolve,reject,timer});server.stdin.write(JSON.stringify({id,method,params})+'\n');});
try {
 const initialized=await rpc('initialize',{clientInfo:{name:'obsidian-host-probe',version:'1'},capabilities:{experimentalApi:true}});
 const {plugin}=await rpc('plugin/read',{marketplacePath:path.join(marketplace,'.agents/plugins/marketplace.json'),pluginName:'codex-obsidian-capture'});
 assert.equal(plugin.skills.length,1);assert.equal(plugin.hooks.length,2);
 const hooks=await rpc('hooks/list',{cwds:[root]});const loaded=hooks.data.flatMap(x=>x.hooks).filter(x=>x.pluginId==='codex-obsidian-capture@claude-fiyah-codex');
 assert.equal(loaded.length,2);assert.ok(loaded.every(x=>x.command.includes(installed.installedPath)));
 // Manual capture/recapture uses the actually installed package. It does not claim host automatic delivery.
 const sourceDirectory=path.join(root,'plans'),vaultPath=path.join(root,'vault'),configFile=path.join(root,'capture.json');
 await fs.mkdir(sourceDirectory);await fs.mkdir(vaultPath);await fs.writeFile(configFile,JSON.stringify({sourceDirectory,vaultPath}));
 const source=path.join(sourceDirectory,'plan.md');
 const artifact=body=>'---\ncapture_schema: 1\nkind: engineering-plan\ncapture_state: complete\nplan_id: "host-smoke-plan-123"\ntitle: "Host smoke"\nrepository: '+JSON.stringify(root)+'\ncreated: "2026-11-06T17:00:00Z"\nupdated: "2026-11-06T17:00:00Z"\nstatus: draft\n---\n'+body;
 const capture=()=>{const r=spawnSync(process.execPath,[path.join(installed.installedPath,'runtime/cli.mjs'),'capture','--config',configFile,'--source',source],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 await fs.writeFile(source,artifact('Initial engineering plan'));const first=capture();
 const note=path.join(vaultPath,first.plan+'.md'),prompt=path.join(vaultPath,first.prompt+'.md');
 await fs.appendFile(note,'\nManual note survives\n');await fs.appendFile(prompt,'\nManual prompt survives\n');
 await fs.writeFile(source,artifact('Revised engineering plan'));const second=capture();
 assert.equal(first.plan,second.plan);assert.equal(first.prompt,second.prompt);assert.match(await fs.readFile(note,'utf8'),/Revised engineering plan/);assert.match(await fs.readFile(note,'utf8'),/Manual note survives/);assert.match(await fs.readFile(prompt,'utf8'),/Manual prompt survives/);
 console.log(JSON.stringify({host:initialized.userAgent,marketplaceSource:repositoryMode ? 'repository root' : 'staged package',marketplaceRecognized:!!added.marketplaceName,installedVersion:installed.version,skillNames:plugin.skills.map(x=>x.name),hooks:loaded.map(x=>({event:x.eventName,trust:x.trustStatus,pluginRootExpanded:!x.command.includes('${PLUGIN_ROOT}')})),manualCapture:true,manualRecapture:true,automaticCapture:'NOT VERIFIED: hooks are untrusted; this probe never grants trust',disposableRoot:root},null,2));
} finally {
 server.kill();
 for (const entry of pending.values())clearTimeout(entry.timer);
 await new Promise(resolve=>server.once('exit',resolve));
 await fs.rm(root,{recursive:true,force:true});
}

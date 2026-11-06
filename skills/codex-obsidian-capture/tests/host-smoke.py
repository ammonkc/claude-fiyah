#!/usr/bin/env python3
"""Real CLI smoke with a loopback deterministic Responses provider and temporary native plugin.
Requires explicit consent for trusting this package ONLY inside the disposable CODEX_HOME.
No live credentials/config, network providers, hook-trust bypass, or expanded filesystem roots.
"""
import argparse, base64, http.server, json, os, pathlib, re, shutil, subprocess, tempfile, threading, time
parser = argparse.ArgumentParser()
parser.add_argument('--approve-disposable-hooks', action='store_true')
parser.add_argument('--app-server', action='store_true', help='Exercise the real stdio app-server turn path instead of codex exec')
parser.add_argument('--deny-vault', action='store_true', help='Use a sandbox-protected .aws subtree to verify denied automatic capture')
parser.add_argument('--keep', action='store_true', help='Keep disposable evidence after testing')
args = parser.parse_args()
if not args.approve_disposable_hooks:
    parser.error('Explicit disposable hook-trust approval is required; pass --approve-disposable-hooks only when authorized')
repo = pathlib.Path(__file__).resolve().parents[3]
root = pathlib.Path(tempfile.mkdtemp(prefix='obsidian-auto-smoke-')).resolve()
home, workspace, marketplace = root/'home', root/'workspace', root/'marketplace'
home.mkdir(); workspace.mkdir()
source_dir, vault = workspace/'plans', (workspace/'.aws/vault' if args.deny_vault else workspace/'vault')
source_dir.mkdir(); vault.mkdir(parents=True)
source = source_dir/'plan.md'
env = {**os.environ, 'CODEX_HOME': str(home), 'OBSIDIAN_CAPTURE_CONFIG': str(home/'obsidian-capture.json')}
(home/'obsidian-capture.json').write_text(json.dumps({'sourceDirectory':str(source_dir),'vaultPath':str(vault)}))
(home/'config.toml').write_text('cli_auth_credentials_store = "file"\n[features]\nplugins = true\nhooks = true\nremote_plugin = false\n')
subprocess.run(['node',str(repo/'skills/codex-obsidian-capture/runtime/package.mjs'),str(marketplace)],check=True,stdout=subprocess.DEVNULL)
# Test-only recorder wraps the reviewed adapter; the complete test bundle is hashed and trusted below.
plugin = marketplace/'skills/codex-obsidian-capture'
(plugin/'runtime/record.mjs').write_text('''import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
let text='';for await(const part of process.stdin)text+=part;
const event=JSON.parse(text);
fs.appendFileSync(process.env.OBSIDIAN_SMOKE_EVENTS,JSON.stringify(event)+'\\n');
const result=spawnSync(process.execPath,[new URL('./cli.mjs',import.meta.url).pathname,'hook'],{input:text,encoding:'utf8'});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status??1;
''')
hooks_file=plugin/'hooks/hooks.json'
hooks_file.write_text(hooks_file.read_text().replace('/runtime/cli.mjs','/runtime/record.mjs'))
events_file=root/'events.jsonl';env['OBSIDIAN_SMOKE_EVENTS']=str(events_file)
def run_json(arguments):
    result=subprocess.run(['codex',*arguments],env=env,text=True,capture_output=True,check=True)
    return json.loads(result.stdout)
run_json(['plugin','marketplace','add',str(marketplace),'--json'])
installed=run_json(['plugin','add','codex-obsidian-capture@claude-fiyah-codex','--json'])
server=subprocess.Popen(['codex','app-server','--stdio'],env=env,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=open(root/'app-server.stderr','w'))
def rpc(i,method,params):
    server.stdin.write(json.dumps({'id':i,'method':method,'params':params})+'\n');server.stdin.flush()
    while True:
        line=server.stdout.readline()
        if not line: raise RuntimeError('app-server exited')
        result=json.loads(line)
        if result.get('id')==i:
            if 'error' in result: raise RuntimeError(result['error'])
            return result['result']
initialized=rpc(1,'initialize',{'clientInfo':{'name':'obsidian-auto-smoke','version':'1'},'capabilities':{'experimentalApi':True}})
hooks=rpc(2,'hooks/list',{'cwds':[str(workspace)]})['data'][0]['hooks']
owned=[hook for hook in hooks if hook.get('pluginId')=='codex-obsidian-capture@claude-fiyah-codex']
assert len(owned)==2
edits=[]
for hook in owned:
    command_hash,content_hash=hook['currentHash'].split('/')
    for key,value in [('trusted_hash',command_hash),('trusted_content_hash',content_hash)]:
        edits.append({'keyPath':'hooks.state.'+json.dumps(hook['key'])+'.'+key,'value':value,'mergeStrategy':'upsert'})
rpc(3,'config/batchWrite',{'filePath':str(home/'config.toml'),'edits':edits,'reloadUserConfig':True})
verified=rpc(4,'hooks/list',{'cwds':[str(workspace)]})['data'][0]['hooks']
assert all(h['trustStatus']=='trusted' for h in verified if h.get('pluginId')=='codex-obsidian-capture@claude-fiyah-codex'),verified
server.terminate();server.wait(timeout=5)
artifact='---\ncapture_schema: 1\nkind: engineering-plan\ncapture_state: complete\nplan_id: "automatic-smoke-plan-123"\ntitle: "Host smoke"\nrepository: '+json.dumps(str(workspace))+'\ncreated: "2026-11-06T17:00:00Z"\nupdated: "2026-11-06T17:00:00Z"\nstatus: draft\n---\n# Host smoke\n\nInitial engineering plan\n'
# Encoding avoids shell interpolation of user-like plan bodies.
create_command="python3 -c "+__import__('shlex').quote('import pathlib,base64;pathlib.Path('+repr(str(source))+').write_bytes(base64.b64decode('+repr(base64.b64encode(artifact.encode()).decode())+'))')
def all_strings(value):
    if isinstance(value,str): yield value
    elif isinstance(value,list):
        for item in value: yield from all_strings(item)
    elif isinstance(value,dict):
        for item in value.values(): yield from all_strings(item)
capture_context_count=[0]
def capture_command(request):
    contexts=[s for s in all_strings(request.get('input',[])) if 'obsidian-plan: completed engineering plan artifact(s) await capture.' in s]
    count=sum(context.count('obsidian-plan: completed engineering plan artifact(s) await capture.') for context in contexts)
    assert count>capture_context_count[0], 'no fresh hook context for this revision'
    capture_context_count[0]=count
    commands=[line for context in contexts for line in context.splitlines() if line.startswith('node ') and ' capture --config ' in line]
    if not commands: raise AssertionError('real hook additionalContext did not reach provider request')
    return commands[-1]
requests=[];failure=[]
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*unused): pass
    def do_GET(self):
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"data":[]}')
    def do_POST(self):
        try:
            raw=self.rfile.read(int(self.headers['Content-Length']))
            if self.headers.get('Content-Encoding')=='gzip': raw=__import__('gzip').decompress(raw)
            request=json.loads(raw);requests.append(request);step=len(requests)-1
            (root/f'request-{step}.json').write_text(json.dumps(request,indent=2))
            if step==0: name,arguments='exec_command',{'cmd':create_command,'yield_time_ms':1000,'max_output_tokens':1000}
            elif step in (1,4): name,arguments='exec_command',{'cmd':capture_command(request),'yield_time_ms':1000,'max_output_tokens':1000}
            elif args.deny_vault and step>=2: name,arguments=None,None
            elif step==2:
                command="python3 -c "+__import__('shlex').quote('import pathlib,json;v=pathlib.Path('+repr(str(vault))+');p=next((v/"Projects/Engineering/Plans").glob("*.md"));q=next((v/"Projects/Engineering/Prompts").glob("*.md"));p.write_text(p.read_text()+"\\nManual note survives\\n");q.write_text(q.read_text()+"\\nManual prompt survives\\n")')
                name,arguments='exec_command',{'cmd':command,'yield_time_ms':1000,'max_output_tokens':1000}
            elif step==3:
                name='apply_patch';arguments='*** Begin Patch\n*** Update File: '+str(source)+'\n@@\n-title: "Host smoke"\n+title: "Host smoke revised"\n@@\n-Initial engineering plan\n+Revised engineering plan\n*** End Patch'
            else: name,arguments=None,None
            if name=='apply_patch': item={'type':'custom_tool_call','id':f'item_{step}','call_id':f'call_{step}','name':name,'input':arguments,'status':'completed'}
            elif name: item={'type':'function_call','id':f'item_{step}','call_id':f'call_{step}','name':name,'arguments':json.dumps(arguments),'status':'completed'}
            else: item={'type':'message','id':f'item_{step}','role':'assistant','status':'completed','content':[{'type':'output_text','text':('Capture denied; report failure and use manual retry after permission setup.' if args.deny_vault else 'Smoke complete.'),'annotations':[]}]}
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            response={'id':f'resp_{step}','object':'response','created_at':int(time.time()),'status':'completed','output':[item],'usage':{'input_tokens':1,'output_tokens':1,'total_tokens':2}}
            for event in [{'type':'response.created','response':{**response,'status':'in_progress','output':[]}}, {'type':'response.output_item.added','output_index':0,'item':item}, {'type':'response.output_item.done','output_index':0,'item':item}, {'type':'response.completed','response':response}]:
                self.wfile.write(('event: '+event['type']+'\ndata: '+json.dumps(event)+'\n\n').encode());self.wfile.flush()
        except Exception as error:
            failure.append(str(error));self.send_error(500,str(error))
http=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=http.serve_forever,daemon=True).start()
with (home/'config.toml').open('a') as config:
    config.write('\n[model_providers.fixture]\nname = "Disposable fixture"\nwire_api = "responses"\nrequires_openai_auth = false\nbase_url = '+json.dumps(f'http://127.0.0.1:{http.server_port}/v1')+'\n')
try:
    if args.app_server:
        from types import SimpleNamespace
        server=subprocess.Popen(['codex','app-server','--stdio','-c','model_provider="fixture"','-c','model="fixture"','-c','model_catalog_json='+json.dumps(str(pathlib.Path(__file__).parent/'fixtures/model-catalog.json'))],env=env,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=open(root/'turn-server.stderr','w'))
        timer=threading.Timer(60,server.kill);timer.start()
        try:
            rpc(10,'initialize',{'clientInfo':{'name':'obsidian-auto-smoke-app-server','version':'1'},'capabilities':{'experimentalApi':True}})
            thread=rpc(11,'thread/start',{'cwd':str(workspace),'model':'fixture','modelProvider':'fixture','approvalPolicy':'never','sandbox':'workspace-write'})['thread']
            rpc(12,'turn/start',{'threadId':thread['id'],'input':[{'type':'text','text':'Finalize a substantial engineering plan and honor obsidian-plan capture context.'}]})
            notifications=[]
            while True:
                line=server.stdout.readline()
                if not line: raise RuntimeError('turn app-server exited before completion')
                item=json.loads(line);notifications.append(item)
                if item.get('method')=='turn/completed':
                    assert item['params']['turn']['status']=='completed',item
                    break
            result=SimpleNamespace(returncode=0,stdout='\n'.join(json.dumps(item) for item in notifications),stderr='')
        finally:
            timer.cancel();server.terminate();server.wait(timeout=5)
    else:
        result=subprocess.run(['codex','--no-daemon','exec','--skip-git-repo-check','-C',str(workspace),'-s','workspace-write','-c','approval_policy="never"','-c','model_provider="fixture"','-c','model="fixture"','-c','model_catalog_json='+json.dumps(str(pathlib.Path(__file__).parent/'fixtures/model-catalog.json')),'-c','model_reasoning_effort="low"','--json','Finalize a substantial engineering plan and honor obsidian-plan capture context.'],env=env,text=True,capture_output=True,timeout=60)
    (root/'cli.stdout').write_text(result.stdout);(root/'cli.stderr').write_text(result.stderr)
    assert result.returncode==0,result.stderr
    assert not failure,failure
    rollout=next((home/'sessions').rglob('*.jsonl'))
    turns=[json.loads(line)['payload'] for line in rollout.read_text().splitlines() if json.loads(line)['type']=='turn_context']
    assert any(turn.get('sandbox_policy',{}).get('type')=='workspace-write' for turn in turns)
    notes=list((vault/'Projects/Engineering/Plans').glob('*.md'));prompts=list((vault/'Projects/Engineering/Prompts').glob('*.md'))
    if args.deny_vault:
        assert not notes and not prompts,'sandbox-protected vault was written'
        assert not list(source_dir.glob('.capture-*.json')),'failed capture wrote a success receipt'
        assert any('obsidian-plan: capture failed: filesystem failure (EPERM)' in text for request in requests for text in all_strings(request.get('input',[]))), 'denied writer failure did not reach host tool output'
        assert 'Capture denied' in result.stdout,result.stdout
        print(json.dumps({'host':initialized['userAgent'],'sandboxDeniedCapture':True,'vaultFilesWritten':False,'receiptWritten':False,'failureReported':True,'evidence':str(root)},indent=2))
    else:
        assert len(notes)==len(prompts)==1,(notes,prompts,result.stderr)
        assert 'Revised engineering plan' in notes[0].read_text()
        assert 'Manual note survives' in notes[0].read_text()
        assert 'Manual prompt survives' in prompts[0].read_text()
        events=[json.loads(line) for line in events_file.read_text().splitlines()]
        post=[e for e in events if e['hook_event_name']=='PostToolUse']
        assert len(post)>=5,events
        assert 'capture_session: '+json.dumps(post[0]['session_id']) in notes[0].read_text()
        assert '\nsession:' not in notes[0].read_text(), 'capture event falsely became source session'
        assert any(e['tool_name']=='apply_patch' for e in post),[e['tool_name'] for e in post]
        print(json.dumps({'host':initialized['userAgent'],'transport':('app-server stdio' if args.app_server else 'CLI exec'),'nativeTrustedHooks':True,'automaticCapture':True,'automaticRecapture':True,'manualEditsPreserved':True,'realEventTools':[e['tool_name'] for e in post],'stopDelivered':any(e['hook_event_name']=='Stop' for e in events),'fixtureProvider':'loopback deterministic Responses; no paid model','evidence':str(root)},indent=2))
except Exception:
    print('Smoke evidence retained at',root)
    args.keep=True
    raise
finally:
    http.shutdown();http.server_close()
    if not args.keep: shutil.rmtree(root)

#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { capture, loadConfig } from './capture.mjs';
import { adapt } from './adapter.mjs';
const [command,...args] = process.argv.slice(2);
const option = key => {const i=args.indexOf(`--${key}`);return i<0 ? undefined : args[i+1];};
try {
  const configFile=path.resolve(option('config') || process.env.OBSIDIAN_CAPTURE_CONFIG || path.join(process.env.CODEX_HOME || path.join(os.homedir(),'.codex'),'obsidian-capture.json'));
  const config=await loadConfig(configFile);
  if (command === 'capture') {
    if (!option('source')) throw new Error('capture requires --source');
    console.log(JSON.stringify({ok:true,...await capture(config,path.resolve(option('source')),option('capture-session'))}));
  } else if (command === 'hook') {
    let text=''; for await (const chunk of process.stdin) {text+=chunk;if(text.length>2*1024*1024) throw new Error('hook payload exceeds 2 MiB');}
    console.log(JSON.stringify(await adapt(JSON.parse(text),config,configFile,fileURLToPath(import.meta.url))));
  } else throw new Error('usage: node runtime/cli.mjs capture --config FILE --source FILE | hook --config FILE');
} catch (error) {
  // Compact diagnostics, no payloads, plan content, paths from raw host errors, or credentials.
  const message=error instanceof SyntaxError ? 'invalid JSON configuration, artifact metadata, or hook payload' : error.code ? `filesystem failure (${error.code}); check configured paths and sandbox access` : String(error.message).slice(0,180);
  console.error(`obsidian-plan: capture failed: ${message}`);
  if (command==='hook') console.log(JSON.stringify({systemMessage:`obsidian-plan capture failed: ${message}. Use manual capture after resolving the failure.`}));
  process.exitCode=1;
}

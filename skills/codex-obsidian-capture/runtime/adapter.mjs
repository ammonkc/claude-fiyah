import * as fs from 'node:fs/promises';
import path from 'node:path';
import { sourceArtifact, readOptional, hash, safeDestination } from './capture.mjs';
export const quote = value => "'" + value.replace(/'/g,"'\\''") + "'";

// A hook never writes the vault. Its only output is context asking the agent to use its normal sandbox.
export async function adapt(event,config,configFile,cliFile) {
  if (!config.automatic || !['PostToolUse','Stop'].includes(event?.hook_event_name) || (event.hook_event_name === 'Stop' && event.stop_hook_active)) return {};
  if (event.hook_event_name === 'PostToolUse' && (!Object.hasOwn(event,'tool_response') || typeof event.tool_name !== 'string')) return {};
  if (event.tool_response?.isError === true || event.tool_response?.exit_code > 0) return {};
  const entries = await fs.readdir(config.sourceDirectory,{withFileTypes:true}).catch(error=> { if (error.code === 'ENOENT') return []; throw error; });
  if (entries.length > 500) throw new Error('sourceDirectory exceeds 500 entries; archive older artifacts');
  const pending = [], seen = new Set();
  const deadline=Date.now()+1500;
  let bytes=0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (Date.now()>deadline || (bytes+=(await fs.stat(path.join(config.sourceDirectory,entry.name))).size)>8*1024*1024) throw new Error('artifact scan limit exceeded; archive old artifacts');
    let artifact;
    try { artifact = await sourceArtifact(config,path.join(config.sourceDirectory,entry.name)); }
    catch (error) {
      if (error.code || /exceeds/.test(error.message)) throw error;
      const text=await fs.readFile(path.join(config.sourceDirectory,entry.name),'utf8');
      if (/^capture_schema:/m.test(text) && /^capture_state:\s*"?complete"?\s*$/m.test(text)) throw error;
      continue; // Ordinary Markdown and unfinished artifacts are not completed plan contracts.
    }
    if (artifact.meta.capture_state !== 'complete') continue;
    if (seen.has(artifact.meta.plan_id)) throw new Error('duplicate plan_id in sourceDirectory; keep only the current revision');
    seen.add(artifact.meta.plan_id);
    const receiptText = await readOptional(await safeDestination(config.sourceDirectory,`.capture-${artifact.meta.plan_id}.json`));
    let receipt; try { receipt = JSON.parse(receiptText); } catch {}
    if (receipt?.fingerprint === artifact.fingerprint && receipt?.configuration === hash(JSON.stringify(config))) continue;
    const session=typeof event.session_id==='string' && /^[a-zA-Z0-9_-]{8,128}$/.test(event.session_id) ? ` --capture-session ${quote(event.session_id)}` : '';
    pending.push(`node ${quote(cliFile)} capture --config ${quote(configFile)} --source ${quote(artifact.source)}${session}`);
    if (pending.length > 5) throw new Error('more than five pending artifacts; use manual capture');
  }
  if (!pending.length) return {};
  const message = `obsidian-plan: completed engineering plan artifact(s) await capture. Run these commands through the normal sandboxed exec tool before finishing, subject to the current filesystem permissions. If denied or failed, report the failure and offer these same commands for manual retry; never escalate or grant vault access just for capture. Do not recapture generated vault notes.\n${pending.join('\n')}`;
  return event.hook_event_name === 'PostToolUse' ? {hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext:message}} : {systemMessage:message};
}

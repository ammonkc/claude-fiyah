import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { MONTHS, planSection } from './shared.mjs';

const defaultSourceDirectory = () => {
  const stateHome=process.env.XDG_STATE_HOME;
  return path.join(stateHome && path.isAbsolute(stateHome) ? stateHome : path.join(os.homedir(), '.local', 'state'), 'codex', 'plans');
};

export const defaults = {
  vault: 'idl', plansFolder: 'Projects/Engineering/Plans', promptsFolder: 'Projects/Engineering/Prompts',
  sourceDirectory: defaultSourceDirectory(),
  automatic: true, journal: true, timezone: 'Pacific/Honolulu',
};
export const hash = text => createHash('sha256').update(text).digest('hex');
const missing = error => { if (error.code !== 'ENOENT') throw error; return undefined; };
export const readOptional = file => fs.readFile(file, 'utf8').catch(missing);
export const inside = (root, file) => file === root || (!path.relative(root, file).startsWith('..' + path.sep) && path.relative(root, file) !== '..' && !path.isAbsolute(path.relative(root, file)));
const scalar = value => JSON.stringify(value);

// The artifact contract is deliberately a scalar YAML subset, avoiding a runtime YAML dependency.
export function parseArtifact(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error('artifact requires YAML frontmatter');
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const m = /^([a-z_]+):\s*(.+)$/.exec(line);
    if (!m || Object.hasOwn(meta, m[1])) throw new Error('invalid or duplicate artifact field');
    let value = m[2].trim();
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'")) throw new Error('use JSON quoted strings in artifact metadata');
    if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new Error('artifact fields must be single-line scalars');
    meta[m[1]] = value;
  }
  for (const key of ['plan_id', 'title', 'repository', 'created', 'updated', 'status']) if (!meta[key]) throw new Error(`missing artifact field: ${key}`);
  if (meta.capture_schema !== '1' || meta.kind !== 'engineering-plan' || !['draft','complete'].includes(meta.capture_state)) throw new Error('unsupported artifact contract');
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(meta.plan_id)) throw new Error('invalid plan_id');
  if (!['draft','planned','saved-for-later'].includes(meta.status)) throw new Error('unsupported lifecycle status');
  for (const key of ['created','updated']) if (!/^\d{4}-\d\d-\d\dT/.test(meta[key]) || !Number.isFinite(Date.parse(meta[key]))) throw new Error(`invalid ${key} timestamp`);
  if (!path.isAbsolute(meta.repository)) throw new Error('repository must be absolute');
  if (!match[2].trim() || /<!-- plan:(?:start|end) -->/.test(match[2])) throw new Error('empty plan or reserved plan markers');
  return { meta, body: match[2].trimEnd() };
}

export async function loadConfig(file) {
  const config = { ...defaults, sourceDirectory: defaultSourceDirectory(), ...JSON.parse(await fs.readFile(file, 'utf8')) };
  for (const key of ['automatic','journal']) if (typeof config[key] !== 'boolean') throw new Error(`${key} must be boolean`);
  if (!path.isAbsolute(config.sourceDirectory)) throw new Error('sourceDirectory must be absolute');
  for (const key of ['plansFolder','promptsFolder']) {
    if (typeof config[key] !== 'string' || !config[key] || path.isAbsolute(config[key]) || config[key].split(/[\\/]/).some(x => !x || x === '.' || x === '..') || /[\[\]|\r\n\0]/.test(config[key])) throw new Error(`unsafe ${key}`);
  }
  if (config.plansFolder === config.promptsFolder) throw new Error('destination folders must differ');
  new Intl.DateTimeFormat('en-US', { timeZone: config.timezone }).format();
  return config;
}

export async function resolveVault(config) {
  if (config.vaultPath) {
    if (!path.isAbsolute(config.vaultPath)) throw new Error('vaultPath must be absolute');
    return fs.realpath(config.vaultPath);
  }
  const registry = config.registryPath || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/obsidian/obsidian.json') : process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'obsidian/obsidian.json') : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'obsidian/obsidian.json'));
  const entries = Object.values(JSON.parse(await fs.readFile(registry, 'utf8')).vaults || {});
  const hits = entries.filter(x => path.basename(x.path) === config.vault);
  if (hits.length !== 1) throw new Error(`vault ${config.vault}: expected one match, found ${hits.length}`);
  return fs.realpath(hits[0].path);
}

// Reject symlinks at every destination component, including existing notes. No alternate-vault fallback.
export async function safeDestination(root, relative) {
  if (!inside(root, path.resolve(root, relative))) throw new Error('destination escapes vault');
  let current = root;
  for (const segment of relative.split(path.sep)) {
    if (!segment || segment === '.' || segment === '..') throw new Error('unsafe destination');
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch(missing);
    if (stat?.isSymbolicLink()) throw new Error('symlink destination refused');
  }
  return current;
}
export async function atomicWrite(file, text) {
  const stat = await fs.lstat(file).catch(missing);
  if (stat?.isSymbolicLink()) throw new Error('symlink write refused');
  const previous = await readOptional(file);
  if (previous === text) return;
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, file);
  } finally { await fs.unlink(temp).catch(missing); }
}

export async function locked(root, operation) {
  const lock = await safeDestination(root, '.obsidian-plan-capture.lock');
  const deadline = Date.now() + 2000;
  while (true) {
    try { await fs.mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() > deadline) throw new Error('capture lock busy; retry, or inspect stale lock before removing it');
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
  try { return await operation(); } finally { await fs.rmdir(lock); }
}

function field(note, key) {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(note)?.[1];
  const value = fm?.split('\n').find(line => line.startsWith(`${key}: `))?.slice(key.length + 2);
  if (value === undefined) return undefined;
  try { return JSON.parse(value); } catch { return value; }
}
function metadata(note, fields) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(note);
  if (!m) throw new Error('existing note frontmatter is damaged; repair manually');
  let lines = m[1].split('\n');
  for (const [key,value] of Object.entries(fields)) {
    const indices = lines.flatMap((line,i) => line.startsWith(`${key}:`) ? [i] : []);
    if (indices.length > 1) throw new Error(`duplicate generated metadata: ${key}`);
    if (indices.length) lines[indices[0]] = `${key}: ${scalar(value)}`;
    else lines.push(`${key}: ${scalar(value)}`);
  }
  return `---\n${lines.join('\n')}\n---\n${m[2]}`;
}
function replaceMarked(note, body) {
  const start = '<!-- plan:start -->', end = '<!-- plan:end -->';
  if (note.split(start).length !== 2 || note.split(end).length !== 2 || note.indexOf(end) < note.indexOf(start)) throw new Error('plan markers damaged; repair manually');
  return note.slice(0,note.indexOf(start)) + start + '\n' + body + '\n' + note.slice(note.indexOf(end));
}
const safeTitle = title => title.replace(/[\[\]|]/g, '').trim();
export const slug = title => title.normalize('NFKC').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}\s-]/gu,'').replace(/[\s-]+/g,'-').replace(/^-|-$/g,'').slice(0,80) || 'unnamed-plan';
function noteHeader(fields,tags) {
  return `---\n${Object.entries(fields).map(([key,value])=>`${key}: ${scalar(value)}`).join('\n')}\ntags:\n${tags.map(tag=>`  - ${tag}`).join('\n')}\n---\n\n`;
}
function dateParts(created,timezone) {
  const parts = new Intl.DateTimeFormat('en-US',{ timeZone: timezone,year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(new Date(created));
  const get = type => parts.find(x=>x.type===type).value;
  const yyyy=get('year'),mm=get('month'),dd=get('day');
  return { created:`${mm}/${dd}/${yyyy}`, prefix:`${mm}-${dd}-${yyyy}`, journal:`Journal/${yyyy}/${mm}-${MONTHS[Number(mm)-1]}/${mm}-${dd}-${yyyy}` };
}

export async function sourceArtifact(config, source) {
  const root = await fs.realpath(config.sourceDirectory);
  const canonical = await fs.realpath(source);
  if (!inside(root, canonical) || path.dirname(canonical) !== root || !canonical.endsWith('.md')) throw new Error('source must be a direct Markdown child of sourceDirectory');
  if ((await fs.stat(canonical)).size > 1024*1024) throw new Error('artifact exceeds 1 MiB');
  const text = await fs.readFile(canonical,'utf8');
  return { ...parseArtifact(text), source: canonical, fingerprint: hash(text) };
}

export async function capture(config, source, captureSession) {
  if (captureSession!==undefined && !/^[a-zA-Z0-9_-]{8,128}$/.test(captureSession)) throw new Error('invalid capture session identifier');
  const artifact = await sourceArtifact(config,source);
  if (artifact.meta.capture_state !== 'complete') throw new Error('artifact is not complete');
  const root = await resolveVault(config);
  const sourceRoot = await fs.realpath(config.sourceDirectory);
  if (inside(root, sourceRoot) || inside(sourceRoot,root)) throw new Error('source and vault must not overlap');
  return locked(root, async () => {
    const planDir = await safeDestination(root,config.plansFolder), promptDir = await safeDestination(root,config.promptsFolder);
    await fs.mkdir(planDir,{recursive:true}); await fs.mkdir(promptDir,{recursive:true});
    const entries = await fs.readdir(planDir,{withFileTypes:true});
    if (entries.length > 10000) throw new Error('too many plan notes');
    let found, priorReceipt;
    const receiptText=await readOptional(await safeDestination(sourceRoot,`.capture-${artifact.meta.plan_id}.json`));
    try {priorReceipt=JSON.parse(receiptText);} catch {}
    if (priorReceipt?.vault===root && typeof priorReceipt.plan==='string') {
      const file=await safeDestination(root,`${priorReceipt.plan}.md`),text=await readOptional(file);
      if (text!==undefined && field(text,'plan_id')===artifact.meta.plan_id) found={file,text};
    }
    const scanDeadline = Date.now() + 4000;
    for (const entry of entries) {
      if (Date.now() > scanDeadline) throw new Error('vault identity scan timed out; retry after archiving old notes');
      if (!entry.name.endsWith('.md')) continue;
      const file = await safeDestination(root,path.join(config.plansFolder,entry.name));
      if ((await fs.stat(file)).size > 2*1024*1024) throw new Error('oversized existing plan note');
      const text = await fs.readFile(file,'utf8');
      if (field(text,'plan_id') === artifact.meta.plan_id) {
        if (found && found.file!==file) throw new Error('duplicate plan_id in vault; repair before retry');
        found = {file,text};
      }
    }
    const d=dateParts(artifact.meta.created,config.timezone), title=safeTitle(artifact.meta.title) || 'Unnamed Plan';
    let planRel = found ? path.relative(root,found.file).replace(/\.md$/,'') : `${config.plansFolder}/${d.prefix}-${slug(title)}`;
    if (!found) {
      let n=0, base=planRel;
      while ((await readOptional(await safeDestination(root,`${planRel}.md`))) !== undefined || (await readOptional(await safeDestination(root,`${config.promptsFolder}/implement-plan-${path.basename(planRel)}.md`))) !== undefined) {
        planRel = `${base}-${hash(artifact.meta.plan_id).slice(0,10)}${n++ ? `-${n}` : ''}`;
      }
    }
    const promptRel = found ? field(found.text,'implementation_prompt')?.match(/^\[\[([^\]|]+)\]\]$/)?.[1] : `${config.promptsFolder}/implement-plan-${path.basename(planRel)}`;
    if (!promptRel || (path.dirname(promptRel) !== config.promptsFolder && !(priorReceipt?.vault===root && priorReceipt.prompt===promptRel))) throw new Error('invalid implementation_prompt backlink');
    const generated = {status:artifact.meta.status, source:'Codex (Plan Artifact)', source_type:'plan file', source_file:artifact.source, plan_id:artifact.meta.plan_id, repository:artifact.meta.repository, updated:artifact.meta.updated, capture_hash:artifact.fingerprint, ...(artifact.meta.source_host ? {source_host:artifact.meta.source_host} : {}), ...(artifact.meta.session_id ? {session:artifact.meta.session_id} : {}), ...(captureSession ? {capture_session:captureSession} : {})};
    const initial = noteHeader({created:d.created,...generated,implementation_prompt:`[[${promptRel}]]`},['plan','codex-session']) + `# ${title}\n\n${config.journal ? `## Logged In\n[[${d.journal}]]\n\n` : ''}## Implementation Prompt\n[[${promptRel}|Implementation prompt]]\n\n${planSection(artifact.body)}`;
    const note = found ? metadata(replaceMarked(found.text,artifact.body),generated) : initial;
    const planFile = await safeDestination(root,`${planRel}.md`), promptFile = await safeDestination(root,`${promptRel}.md`);
    // Write the identity-bearing plan first: retry can recover its original name after prompt failure.
    await atomicWrite(planFile,note);
    if ((await readOptional(promptFile)) === undefined) {
      const prompt = noteHeader({created:field(note,'created'),source:'Codex (Implementation Prompt)',plan_note:`[[${planRel}]]`,plan_id:artifact.meta.plan_id,source_file:artifact.source,repository:artifact.meta.repository},['prompt','implementation-prompt','plan','codex-session']) + `# Implement Plan: ${title}\n\n## Plan\n[[${planRel}|${title}]]\n\n## Prompt\n\nImplement the plan ${JSON.stringify(title)} in ${artifact.meta.repository}.\n\nRead the original source_file at this exact path:\n${artifact.source}\n\nIf it is unavailable, read the captured plan at this exact path:\n${planFile}\n\nOr resolve ${JSON.stringify(planRel)} in the Obsidian vault ${JSON.stringify(path.basename(root))}. If neither source nor captured plan is accessible, ask for the plan before proceeding.\n\nRead repository and ancestor instructions, inspect git status/diff and current code, preserve unrelated changes, check already-completed steps, and implement remaining work. Run relevant tests and report changed files, validation, and blockers. This prompt does not authorize commits, deployment, pushing, publishing, or releases.\n`;
      await atomicWrite(promptFile,prompt);
    } else if (field(await fs.readFile(promptFile,'utf8'),'plan_id') !== artifact.meta.plan_id) throw new Error('prompt identity mismatch; refusing overwrite');
    // Receipt is written last. Missing receipt causes repair of a partially completed pair on retry.
    await atomicWrite(await safeDestination(sourceRoot,`.capture-${artifact.meta.plan_id}.json`),JSON.stringify({fingerprint:artifact.fingerprint,configuration:hash(JSON.stringify(config)),plan:planRel,prompt:promptRel,vault:root})+'\n');
    return {plan:planRel,prompt:promptRel,updated:!!found};
  });
}

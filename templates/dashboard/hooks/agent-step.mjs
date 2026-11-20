#!/usr/bin/env node
// PreToolUse hook (matcher Read|Skill): when an agent reads a skill (`.claude/skills/<name>/SKILL.md`) or invokes one
// with the Skill tool, appends one `agent-step` event to the run, so the dashboard shows which step each agent is in.
// Input (stdin JSON, Claude Code hooks docs): cwd, transcript_path, tool_name, tool_input, and agent_id/agent_type
// when the tool call comes from a sub-agent. Never blocks: exit 0 always, nothing on stdout.
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRunByCwd, recordEvent, resolveStoreDir } from '../record.mjs';
import { BEAD, promptText } from './subagent-stop.mjs';

const SKILL_FILE = /[\\/]\.claude[\\/]skills[\\/]([A-Za-z0-9][A-Za-z0-9._-]{0,127})[\\/]SKILL\.md$/;
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CHUNK = 256 * 1024;

/** The skill a tool call reads or runs, and the directory to look the run up from, or null. */
export function skillOf(input) {
  const ti = input?.tool_input;
  if (!ti || typeof ti !== 'object') return null;
  if (input.tool_name === 'Read' && typeof ti.file_path === 'string') {
    const m = SKILL_FILE.exec(ti.file_path);
    return m ? { skill: m[1], dir: path.dirname(ti.file_path) } : null;
  }
  if (input.tool_name === 'Skill' && typeof ti.skill === 'string') {
    const skill = ti.skill.replace(/^\//, '');
    return SKILL_NAME.test(skill) ? { skill, dir: null } : null;
  }
  return null;
}

/** Reads at most CHUNK bytes from the start or the end of a file; '' if it cannot be read. */
function readPart(file, fromEnd) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, CHUNK);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, fromEnd ? size - len : 0);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const parse = (line) => {
  try { return JSON.parse(line); } catch { return null; }
};

/** The model of the latest assistant message in the end of a transcript, or null. */
export function lastModel(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = parse(lines[i]);
    const model = o?.type === 'assistant' ? o.message?.model : null;
    if (typeof model === 'string' && model && model !== '<synthetic>') return model;
  }
  return null;
}

/** The bead named in the first user prompt of the start of a transcript, or null. */
export function firstPromptBead(text) {
  for (const line of text.split('\n')) {
    const o = parse(line);
    if (o?.type === 'user' && o.message) return BEAD.exec(promptText(o.message.content))?.[1] ?? null;
  }
  return null;
}

/**
 * Who makes the call: the session itself (no agent_id) or a sub-agent. Claude Code keeps a sub-agent's transcript
 * and a `.meta.json` (agentType, model) in `<session transcript without .jsonl>/subagents/agent-<id>.*`.
 */
export function agentOf(input) {
  const out = {};
  const transcript = typeof input.transcript_path === 'string' && input.transcript_path ? input.transcript_path : null;
  const id = typeof input.agent_id === 'string' && AGENT_ID.test(input.agent_id) ? input.agent_id : null;
  if (!id) {
    const model = transcript ? lastModel(readPart(transcript, true)) : null;
    if (model) out.model = model;
    return out;
  }
  out.agentId = id;
  if (typeof input.agent_type === 'string' && input.agent_type) out.agentType = input.agent_type;
  if (!transcript) return out;
  const base = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents', `agent-${id}`);
  let meta = null;
  try { meta = JSON.parse(readFileSync(`${base}.meta.json`, 'utf8')); } catch { /* older Claude Code: no meta file */ }
  if (!out.agentType && typeof meta?.agentType === 'string' && meta.agentType) out.agentType = meta.agentType;
  const model = typeof meta?.model === 'string' && meta.model ? meta.model : lastModel(readPart(`${base}.jsonl`, true));
  if (model) out.model = model;
  const bead = firstPromptBead(readPart(`${base}.jsonl`, false));
  if (bead) out.bead = bead;
  return out;
}

/** Handles one hook input. Returns the recorded event or null (no-op). May throw; main() swallows. */
export function handle(input, { env = process.env } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const hit = skillOf(input);
  if (!hit) return null;
  let run = null;
  let storeDir = null;
  for (const dir of [hit.dir, input.cwd]) {
    if (typeof dir !== 'string' || !dir) continue;
    try {
      storeDir = resolveStoreDir({ cwd: dir, env });
      run = findRunByCwd(dir, { storeDir });
    } catch { run = null; }
    if (run) break;
  }
  if (!run) return null;
  return recordEvent(storeDir, run.id, 'agent-step', { skill: hit.skill, ...agentOf(input) });
}

export function main() {
  try {
    handle(JSON.parse(readFileSync(0, 'utf8')));
  } catch (err) {
    console.error(`pipeline-agent-step: ${err?.message ?? err}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
  process.exitCode = 0;
}

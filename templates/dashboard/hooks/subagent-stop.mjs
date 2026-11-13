#!/usr/bin/env node
// SubagentStop hook: appends one `agent` event (duration, tokens, estimated cost) to the active pipeline run.
// Input (stdin JSON, Claude Code hooks docs): cwd, agent_id, agent_type, agent_transcript_path.
// Never blocks or fails the session: exit 0 always, nothing on stdout.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRunByCwd, recordEvent, resolveStoreDir } from '../record.mjs';

const PRICING_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pricing.json');
const TOKEN_FIELDS = {
  input: 'input_tokens', output: 'output_tokens',
  cacheRead: 'cache_read_input_tokens', cacheWrite: 'cache_creation_input_tokens',
};

export function loadPricing(file = PRICING_FILE) {
  try { return JSON.parse(readFileSync(file, 'utf8')).models ?? {}; } catch { return {}; }
}

const BEAD = /\bbead\b\s*:?\s*([a-z][a-z0-9]*-[a-z0-9]+(?:\.[0-9]+)*)\b/i;

function promptText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n');
  return '';
}

const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);

/** Parses a sub-agent transcript (JSONL). Bad lines are skipped. Returns the event fields and the transcript cwd. */
export function summarizeTranscript(text, pricing = loadPricing()) {
  const messages = new Map(); // message id -> { model, usage } (streamed lines repeat the id: keep the max per field)
  let first = null;
  let last = null;
  let cwd = null;
  let anon = 0;
  let bead = null;
  let seenPrompt = false;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    const t = Date.parse(o.timestamp);
    if (Number.isFinite(t)) {
      if (first === null || t < first) first = t;
      if (last === null || t > last) last = t;
    }
    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd;
    const m = o.message;
    if (o.type === 'user' && !seenPrompt && m) {
      seenPrompt = true; // only the first user prompt names the bead
      bead = BEAD.exec(promptText(m.content))?.[1] ?? null;
    }
    if (o.type !== 'assistant' || !m || typeof m.usage !== 'object' || m.usage === null) continue;
    const id = typeof m.id === 'string' ? m.id : `anon-${anon++}`;
    const cur = messages.get(id) ?? { model: null, usage: {} };
    if (typeof m.model === 'string' && m.model && m.model !== '<synthetic>') cur.model = m.model;
    for (const f of Object.values(TOKEN_FIELDS)) cur.usage[f] = Math.max(num(cur.usage[f]), num(m.usage[f]));
    messages.set(id, cur);
  }

  const fields = {};
  if (first !== null) fields.durationMs = last - first;
  if (bead) fields.bead = bead;
  if (messages.size === 0) return { fields, cwd };

  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0;
  let priced = true;
  let model = null;
  for (const msg of messages.values()) {
    for (const [k, f] of Object.entries(TOKEN_FIELDS)) totals[k] += msg.usage[f] ?? 0;
    if (msg.model) model = msg.model;
    if (Object.values(msg.usage).every((v) => v === 0)) continue; // zero usage costs nothing, whatever its model
    const p = msg.model ? pricing[msg.model] : null;
    if (!p) { priced = false; continue; }
    for (const k of Object.keys(totals)) cost += ((msg.usage[TOKEN_FIELDS[k]] ?? 0) * num(p[k])) / 1e6;
  }
  if (model) fields.model = model;
  Object.assign(fields, {
    tokensIn: totals.input, tokensOut: totals.output,
    tokensCacheRead: totals.cacheRead, tokensCacheWrite: totals.cacheWrite,
  });
  if (priced) fields.cost = Number(cost.toFixed(6)); // unknown model: no cost field, never 0
  return { fields, cwd };
}

/** Handles one hook input. Returns the recorded event or null (no-op). May throw; main() swallows. */
export function handle(input, { env = process.env, pricing = loadPricing() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const file = input.agent_transcript_path;
  if (typeof file !== 'string' || !file) return null;
  const { fields, cwd: transcriptCwd } = summarizeTranscript(readFileSync(file, 'utf8'), pricing);

  let run = null;
  let storeDir = null;
  for (const cwd of [input.cwd, transcriptCwd]) {
    if (typeof cwd !== 'string' || !cwd) continue;
    try {
      storeDir = resolveStoreDir({ cwd, env });
      run = findRunByCwd(cwd, { storeDir });
    } catch { run = null; }
    if (run) break;
  }
  if (!run) return null;

  const event = {};
  if (typeof input.agent_id === 'string' && input.agent_id) event.agentId = input.agent_id;
  if (typeof input.agent_type === 'string' && input.agent_type) event.agentType = input.agent_type;
  return recordEvent(storeDir, run.id, 'agent', { ...event, ...fields });
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

export function main() {
  try {
    handle(JSON.parse(readStdin()));
  } catch (err) {
    console.error(`pipeline-subagent-stop: ${err?.message ?? err}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
  process.exitCode = 0;
}

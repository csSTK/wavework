#!/usr/bin/env node
// Pipeline run recorder: appends events of /next-task* runs to a store shared by all worktrees.
// CLI: record.mjs <event> [--run <id>] [--key value ...]. Never fails loudly (exit 0 always).
// Importable: resolveStoreDir, findRunByCwd, recordEvent, readRun, listRuns, EVENT_TYPES.
import { execFileSync } from 'node:child_process';
import {
  appendFileSync, closeSync, mkdirSync, openSync, readdirSync, readFileSync,
  realpathSync, renameSync, writeFileSync, constants,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORE_ENV = 'WAVEWORK_PIPELINE_STORE';
export const EVENT_TYPES = [
  'run-start', 'run-end', 'step-start', 'step-end', 'child-start', 'child-end',
  'review', 'tests', 'finding', 'agent',
];
const RUN_KINDS = ['next-task', 'beads', 'batch'];
const RUN_STATUSES = ['running', 'done', 'blocked', 'failed'];
const NUMERIC = new Set([
  'wave', 'round', 'mustFix', 'passed', 'failed', 'duration', 'durationMs',
  'tokensIn', 'tokensOut', 'tokensCacheRead', 'tokensCacheWrite', 'cost',
]);
const LIST = new Set(['units']);
export const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Store directory: $WAVEWORK_PIPELINE_STORE, else <git common dir>/pipeline-runs. Throws if neither works. */
export function resolveStoreDir({ cwd = process.cwd(), env = process.env } = {}) {
  if (env[STORE_ENV]) return path.resolve(env[STORE_ENV]);
  const out = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  return path.join(path.resolve(cwd, out), 'pipeline-runs');
}

function real(p) {
  try { return realpathSync(p); } catch { return path.resolve(p); }
}

function within(dir, cwd) {
  const rel = path.relative(dir, cwd);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function readRun(storeDir, id) {
  if (typeof id !== 'string' || !RUN_ID.test(id)) return null;
  try { return JSON.parse(readFileSync(path.join(storeDir, id, 'run.json'), 'utf8')); } catch { return null; }
}

export function listRuns(storeDir) {
  let names;
  try { names = readdirSync(storeDir); } catch { return []; }
  return names.map((n) => readRun(storeDir, n)).filter(Boolean);
}

/** The running run whose worktree contains cwd (deepest worktree wins), or null. */
export function findRunByCwd(cwd, { storeDir = resolveStoreDir({ cwd }) } = {}) {
  const target = real(cwd);
  let best = null;
  let bestLen = -1;
  for (const run of listRuns(storeDir)) {
    if (run.status !== 'running' || !run.worktree) continue;
    const wt = real(run.worktree);
    if (within(wt, target) && wt.length > bestLen) { best = run; bestLen = wt.length; }
  }
  return best;
}

function writeRunJson(storeDir, id, run) {
  const dir = path.join(storeDir, id);
  const tmp = path.join(dir, `.run.json.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, JSON.stringify(run, null, 2) + '\n');
  renameSync(tmp, path.join(dir, 'run.json'));
}

function appendLine(file, obj) {
  // One write call with O_APPEND: lines from parallel processes do not interleave.
  const fd = openSync(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT, 0o644);
  try { appendFileSync(fd, JSON.stringify(obj) + '\n'); } finally { closeSync(fd); }
}

/** Records one event. `fields` are the event's data (without ts/type). Returns the written event. */
export function recordEvent(storeDir, runId, type, fields = {}, now = new Date()) {
  if (!EVENT_TYPES.includes(type)) throw new Error(`unknown event type: ${type}`);
  if (!RUN_ID.test(runId || '')) throw new Error(`invalid run id: ${runId}`);
  const ts = now.toISOString();
  mkdirSync(path.join(storeDir, runId), { recursive: true });
  const event = { ...fields, ts, type, run: runId };
  appendLine(path.join(storeDir, runId, 'events.jsonl'), event);

  if (type === 'run-start') {
    const kind = RUN_KINDS.includes(fields.kind) ? fields.kind : 'next-task';
    writeRunJson(storeDir, runId, {
      id: runId, kind, units: fields.units ?? [], parent: fields.parent ?? null,
      branch: fields.branch ?? null, worktree: fields.worktree ?? null,
      status: 'running', started: ts, ended: null,
    });
  } else if (type === 'run-end') {
    const run = readRun(storeDir, runId) ?? { id: runId, started: null };
    const status = RUN_STATUSES.includes(fields.status) && fields.status !== 'running' ? fields.status : 'done';
    writeRunJson(storeDir, runId, { ...run, status, ended: ts });
  }
  return event;
}

/** Parses `--key value` pairs; numeric and list fields are coerced, bare flags become true. */
export function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = args[i + 1];
    let value = true;
    if (next !== undefined && !next.startsWith('--')) { value = next; i++; }
    if (typeof value === 'string') {
      if (LIST.has(key)) value = value.split(',').map((s) => s.trim()).filter(Boolean);
      else if (NUMERIC.has(key) && value.trim() !== '' && Number.isFinite(Number(value))) value = Number(value);
    }
    out[key] = value;
  }
  return out;
}

/** CLI entry. Returns the exit code, which is always 0. */
export function main(argv, { cwd = process.cwd(), env = process.env, stderr = console.error } = {}) {
  try {
    const [type, ...rest] = argv;
    if (!type) throw new Error(`usage: record.mjs <${EVENT_TYPES.join('|')}> --run <id> [--key value ...]`);
    const { run, ...fields } = parseArgs(rest);
    const storeDir = resolveStoreDir({ cwd, env });
    let runId = typeof run === 'string' ? run : undefined;
    if (!runId) runId = findRunByCwd(cwd, { storeDir })?.id;
    if (!runId) throw new Error('no --run given and no running run for this directory');
    recordEvent(storeDir, runId, type, fields);
  } catch (e) {
    stderr(`pipeline-record: ${e?.message ?? String(e)}`);
  }
  return 0;
}

if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}

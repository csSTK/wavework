import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordEvent } from '../../templates/dashboard/record.mjs';
import { modelLabel } from '../../templates/dashboard/public/format.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, '..', '..', 'templates', 'dashboard', 'hooks', 'agent-step.mjs');

const line = (o) => JSON.stringify(o);

/** A store with one running run, its worktree with a skill file, and a session transcript with one sub-agent. */
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-step-'));
  const store = path.join(root, 'store');
  const worktree = path.join(root, 'wt');
  mkdirSync(path.join(worktree, '.claude', 'skills', 'next-task-test'), { recursive: true });
  recordEvent(store, 'run-a', 'run-start', { kind: 'next-task', units: ['x'], worktree });
  const session = path.join(root, 'projects', 'sess-1');
  const transcript = `${session}.jsonl`;
  mkdirSync(path.join(session, 'subagents'), { recursive: true });
  writeFileSync(transcript, [
    line({ type: 'user', message: { role: 'user', content: 'go' } }),
    line({ type: 'assistant', message: { id: 'm1', model: 'claude-sonnet-5-5', usage: {} } }),
    line({ type: 'assistant', message: { id: 'm2', model: 'claude-opus-5-5', usage: {} } }),
    line({ type: 'assistant', message: { id: 'm3', model: '<synthetic>', usage: {} } }),
  ].join('\n') + '\n');
  const sub = path.join(session, 'subagents', 'agent-abc123');
  writeFileSync(`${sub}.jsonl`, [
    line({ type: 'user', message: { role: 'user', content: 'Implement bead x-1.35 in worktree /w on branch epic/x.' } }),
    line({ type: 'assistant', message: { id: 'm1', model: 'claude-haiku-5-5', usage: {} } }),
  ].join('\n') + '\n');
  return { root, store, worktree, transcript, sub, skillFile: path.join(worktree, '.claude', 'skills', 'next-task-test', 'SKILL.md') };
}

function runHook(stdin, { store, cwd }) {
  return spawnSync('node', [HOOK], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    env: { ...process.env, WAVEWORK_PIPELINE_STORE: store }, cwd, encoding: 'utf8',
  });
}

function steps(store) {
  const f = path.join(store, 'run-a', 'events.jsonl');
  return readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.type === 'agent-step');
}

const read = (s, extra = {}) => ({
  hook_event_name: 'PreToolUse', session_id: 'sess-1', transcript_path: s.transcript, cwd: s.root,
  tool_name: 'Read', tool_input: { file_path: s.skillFile }, ...extra,
});

test('the orchestrator reading a skill in the worktree records the skill and the session model', () => {
  const s = setup();
  const r = runHook(read(s), { store: s.store, cwd: s.root });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const [e] = steps(s.store);
  assert.equal(e.skill, 'next-task-test');
  assert.equal(e.model, 'claude-opus-5-5', 'latest real model, <synthetic> skipped');
  assert.equal(e.agentId, undefined);
});

test('a sub-agent: agent id and type, model from its meta file, bead from its first prompt', () => {
  const s = setup();
  writeFileSync(`${s.sub}.meta.json`, JSON.stringify({ agentType: 'implementer-sonnet', model: 'claude-sonnet-5-5' }));
  runHook(read(s, { agent_id: 'abc123', agent_type: 'implementer-sonnet' }), { store: s.store, cwd: s.root });
  const [e] = steps(s.store);
  assert.deepEqual({ agentId: e.agentId, agentType: e.agentType, model: e.model, bead: e.bead, skill: e.skill },
    { agentId: 'abc123', agentType: 'implementer-sonnet', model: 'claude-sonnet-5-5', bead: 'x-1.35', skill: 'next-task-test' });
});

test('a sub-agent without a meta file: model from its own transcript', () => {
  const s = setup();
  runHook(read(s, { agent_id: 'abc123' }), { store: s.store, cwd: s.root });
  assert.equal(steps(s.store)[0].model, 'claude-haiku-5-5');
});

test('an agent id that is not a plain id is ignored for file lookups', () => {
  const s = setup();
  runHook(read(s, { agent_id: '../../etc' }), { store: s.store, cwd: s.root });
  const [e] = steps(s.store);
  assert.equal(e.agentId, undefined);
  assert.equal(e.skill, 'next-task-test');
});

test('the Skill tool is recorded when the session cwd is in the worktree', () => {
  const s = setup();
  runHook(read(s, { tool_name: 'Skill', tool_input: { skill: 'next-task-review' }, cwd: s.worktree }), { store: s.store, cwd: s.root });
  assert.equal(steps(s.store)[0].skill, 'next-task-review');
});

test('no-ops: other files, skills outside any run, bad input', () => {
  const s = setup();
  runHook(read(s, { tool_input: { file_path: path.join(s.worktree, 'README.md') } }), { store: s.store, cwd: s.root });
  runHook(read(s, { tool_input: { file_path: path.join(s.root, 'other', '.claude', 'skills', 'next-task', 'SKILL.md') } }), { store: s.store, cwd: s.root });
  runHook(read(s, { tool_name: 'Bash', tool_input: { command: 'ls' } }), { store: s.store, cwd: s.root });
  const bad = runHook('not json', { store: s.store, cwd: s.root });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, '');
  assert.deepEqual(steps(s.store), []);
  assert.ok(existsSync(path.join(s.store, 'run-a', 'events.jsonl')));
});

test('modelLabel shortens Claude model ids', () => {
  assert.equal(modelLabel('claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.equal(modelLabel('claude-opus-4-1-20250805'), 'Opus 4.1');
  assert.equal(modelLabel('claude-haiku-4-5'), 'Haiku 4.5');
  assert.equal(modelLabel('sonnet'), 'sonnet');
  assert.equal(modelLabel(null), '—');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordEvent } from '../../templates/dashboard/record.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, '..', '..', 'templates', 'dashboard', 'hooks', 'subagent-stop.mjs');
const FIX = path.join(here, 'fixtures', 'subagent-stop');

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'subagent-stop-'));
  const store = path.join(root, 'store');
  const worktree = path.join(root, 'wt');
  mkdirSync(path.join(worktree, 'sub'), { recursive: true });
  recordEvent(store, 'run-a', 'run-start', { kind: 'next-task', units: ['x'], worktree });
  return { root, store, worktree };
}

function runHook(stdin, { store, cwd }) {
  return spawnSync('node', [HOOK], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    env: { ...process.env, WAVEWORK_PIPELINE_STORE: store },
    cwd, encoding: 'utf8',
  });
}

function events(store, run = 'run-a') {
  const f = path.join(store, run, 'events.jsonl');
  return readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.type === 'agent');
}

const input = (cwd, fixture, extra = {}) => ({
  hook_event_name: 'SubagentStop', session_id: 's', cwd, agent_id: 'agent-1', agent_type: 'implementer-sonnet',
  agent_transcript_path: path.join(FIX, fixture), ...extra,
});

test('sums tokens deduped by message id, detects model, duration and cost', () => {
  const { store, worktree } = setup();
  const r = runHook(input(path.join(worktree, 'sub'), 'basic.jsonl'), { store, cwd: worktree });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const [e] = events(store);
  assert.equal(e.agentId, 'agent-1');
  assert.equal(e.agentType, 'implementer-sonnet');
  assert.equal(e.model, 'claude-sonnet-5-5');
  assert.equal(e.tokensIn, 15);
  assert.equal(e.tokensOut, 136);
  assert.equal(e.tokensCacheRead, 18220);
  assert.equal(e.tokensCacheWrite, 10600);
  assert.equal(e.durationMs, 30500);
  assert.ok(Math.abs(e.cost - 0.031534) < 1e-9, `cost ${e.cost}`);
});

test('cost is computed per message model', () => {
  const { store, worktree } = setup();
  runHook(input(worktree, 'mixed-models.jsonl'), { store, cwd: worktree });
  const [e] = events(store);
  // 1M haiku input ($0.10) + 1M opus output ($20)
  assert.ok(Math.abs(e.cost - 20.1) < 1e-9, `cost ${e.cost}`);
});

test('unknown model: cost field is absent, not 0', () => {
  const { store, worktree } = setup();
  const r = runHook(input(worktree, 'unknown-model.jsonl'), { store, cwd: worktree });
  assert.equal(r.status, 0);
  const [e] = events(store);
  assert.equal(e.model, 'claude-mystery-9');
  assert.equal(e.tokensIn, 5);
  assert.equal('cost' in e, false);
});

test('malformed transcript lines are skipped', () => {
  const { store, worktree } = setup();
  runHook(input(worktree, 'malformed.jsonl'), { store, cwd: worktree });
  const [e] = events(store);
  assert.equal(e.tokensIn, 1);
  assert.equal(e.tokensCacheWrite, 4);
});

test('transcript without usage: event has duration but no tokens or cost', () => {
  const { store, worktree } = setup();
  runHook(input(worktree, 'no-usage.jsonl'), { store, cwd: worktree });
  const [e] = events(store);
  assert.equal(e.durationMs, 9000);
  assert.equal('tokensIn' in e, false);
  assert.equal('cost' in e, false);
});

test('no matching run is a no-op', () => {
  const { root, store } = setup();
  const other = path.join(root, 'elsewhere');
  mkdirSync(other);
  const r = runHook(input(other, 'basic.jsonl'), { store, cwd: other });
  assert.equal(r.status, 0);
  assert.equal(events(store).length, 0);
  assert.deepEqual(readdirSync(store), ['run-a']);
});

test('ended run is not matched', () => {
  const { store, worktree } = setup();
  recordEvent(store, 'run-a', 'run-end', { status: 'done' });
  runHook(input(worktree, 'basic.jsonl'), { store, cwd: worktree });
  assert.equal(events(store).length, 0);
});

test('malformed or missing input exits 0 and writes nothing', () => {
  const { root, store, worktree } = setup();
  for (const stdin of ['', 'not json', '[]', '{}', JSON.stringify({ cwd: worktree }),
    JSON.stringify({ cwd: worktree, agent_transcript_path: path.join(root, 'missing.jsonl') })]) {
    const r = runHook(stdin, { store, cwd: worktree });
    assert.equal(r.status, 0, stdin);
    assert.equal(r.stdout, '');
  }
  assert.equal(events(store).length, 0);
});

test('hook cwd outside the worktree falls back to the cwd recorded in the transcript', () => {
  const { root, store, worktree } = setup();
  const t = path.join(root, 'agent.jsonl');
  const line = { type: 'assistant', timestamp: '2026-11-13T10:00:00.000Z', cwd: worktree,
    message: { id: 'm', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 } } };
  writeFileSync(t, JSON.stringify(line) + '\n');
  const elsewhere = path.join(root, 'elsewhere');
  mkdirSync(elsewhere);
  runHook({ cwd: elsewhere, agent_id: 'a', agent_transcript_path: t }, { store, cwd: elsewhere });
  assert.equal(events(store).length, 1);
});

test('bead is extracted from the first user prompt (implementer wording)', () => {
  const { store, worktree } = setup();
  runHook(input(worktree, 'bead-implementer.jsonl'), { store, cwd: worktree });
  assert.equal(events(store)[0].bead, 'shipr-1hxo.3');
});

test('bead is extracted from a reviewer prompt with content blocks and "bead:"', () => {
  const { store, worktree } = setup();
  runHook(input(worktree, 'bead-reviewer.jsonl'), { store, cwd: worktree });
  assert.equal(events(store)[0].bead, 'shipr-1hxo.12');
});

test('no bead id in the first prompt: no bead field', () => {
  const { store, worktree } = setup();
  runHook(input(worktree, 'basic.jsonl'), { store, cwd: worktree });
  assert.equal('bead' in events(store)[0], false);
});

test('zero-usage synthetic or model-less messages do not remove the cost', () => {
  const { store, worktree } = setup();
  runHook(input(worktree, 'synthetic-zero.jsonl'), { store, cwd: worktree });
  const [e] = events(store);
  assert.equal(e.model, 'claude-opus-5-5');
  assert.equal(e.tokensIn, 1000000);
  assert.ok(Math.abs(e.cost - 4) < 1e-9, `cost ${e.cost}`);
});

test('synthetic message with non-zero usage makes cost absent', () => {
  const { store, worktree } = setup();
  runHook(input(worktree, 'synthetic-nonzero.jsonl'), { store, cwd: worktree });
  const [e] = events(store);
  assert.equal(e.tokensIn, 1000005);
  assert.equal('cost' in e, false);
});

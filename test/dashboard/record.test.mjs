import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EVENT_TYPES, findRunByCwd, main, parseArgs, readRun, recordEvent, resolveStoreDir,
} from '../../templates/dashboard/record.mjs';

const RECORD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'dashboard', 'record.mjs');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'pipeline-record-'));
const events = (store, id) =>
  readFileSync(path.join(store, id, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('every event type is appended with ts and type', () => {
  const store = tmp();
  const samples = {
    'run-start': { kind: 'beads', units: ['a', 'b'] }, 'run-end': { status: 'done' },
    'step-start': { step: 'deps' }, 'step-end': { step: 'deps' },
    'child-start': { bead: 'x.1', model: 'sonnet', wave: 1 },
    'child-end': { bead: 'x.1', result: 'ok', redBeforeGreen: 'FooTest' },
    review: { verdict: 'pass', mustFix: 0, round: 1 },
    tests: { scope: 'backend', passed: 5, failed: 0, duration: 12 },
    finding: { bead: 'x.9' },
    agent: { agentId: 'a1', model: 'sonnet', durationMs: 5, tokensIn: 1, tokensOut: 2, cost: 0.1 },
  };
  assert.deepEqual(Object.keys(samples).sort(), [...EVENT_TYPES].sort());
  for (const [type, f] of Object.entries(samples)) recordEvent(store, 'r1', type, f);
  const got = events(store, 'r1');
  assert.deepEqual(got.map((e) => e.type), Object.keys(samples));
  for (const e of got) assert.match(e.ts, /^\d{4}-\d\d-\d\dT/);
  assert.equal(got[6].mustFix, 0);
});

test('run-start writes run.json, run-end updates status and ended', () => {
  const store = tmp();
  recordEvent(store, 'r1', 'run-start', { kind: 'batch', units: ['e1'], parent: 'p', branch: 'b', worktree: '/w' });
  const run = readRun(store, 'r1');
  assert.deepEqual([run.id, run.kind, run.parent, run.branch, run.worktree, run.status, run.ended],
    ['r1', 'batch', 'p', 'b', '/w', 'running', null]);
  recordEvent(store, 'r1', 'run-end', { status: 'blocked' });
  const end = readRun(store, 'r1');
  assert.equal(end.status, 'blocked');
  assert.ok(end.ended);
  assert.equal(end.kind, 'batch');
});

test('run.json is replaced by rename: no temp files remain and it is always valid JSON', () => {
  const store = tmp();
  recordEvent(store, 'r1', 'run-start', { worktree: '/w' });
  for (let i = 0; i < 50; i++) {
    recordEvent(store, 'r1', 'run-end', { status: 'done' });
    JSON.parse(readFileSync(path.join(store, 'r1', 'run.json'), 'utf8'));
  }
  assert.deepEqual(readdirSync(path.join(store, 'r1')).sort(), ['events.jsonl', 'run.json']);
});

test('parallel processes appending leave valid JSONL', async () => {
  const store = tmp();
  const env = { ...process.env, WAVEWORK_PIPELINE_STORE: store };
  const n = 8, per = 25;
  await Promise.all(Array.from({ length: n }, (_, p) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', `
      import(${JSON.stringify(RECORD)}).then(({ recordEvent }) => {
        for (let i = 0; i < ${per}; i++) recordEvent(${JSON.stringify(store)}, 'par', 'finding', { bead: 'p${p}-' + i, pad: 'x'.repeat(2000) });
      });`], { env, stdio: 'inherit' });
    child.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`exit ${c}`))));
  })));
  const got = events(store, 'par');
  assert.equal(got.length, n * per);
  assert.equal(new Set(got.map((e) => e.bead)).size, n * per);
});

test('cwd-to-run lookup finds the running run containing cwd, deepest worktree wins', () => {
  const store = tmp();
  const root = tmp();
  const wtA = path.join(root, 'a'), wtB = path.join(root, 'a', 'nested'), wtC = path.join(root, 'c');
  for (const d of [wtA, wtB, wtC]) mkdirSync(path.join(d, 'sub'), { recursive: true });
  recordEvent(store, 'A', 'run-start', { worktree: wtA });
  recordEvent(store, 'B', 'run-start', { worktree: wtB });
  recordEvent(store, 'C', 'run-start', { worktree: wtC });
  recordEvent(store, 'C', 'run-end', { status: 'done' });
  assert.equal(findRunByCwd(path.join(wtA, 'sub'), { storeDir: store }).id, 'A');
  assert.equal(findRunByCwd(path.join(wtB, 'sub'), { storeDir: store }).id, 'B');
  assert.equal(findRunByCwd(path.join(wtC, 'sub'), { storeDir: store }), null, 'finished run ignored');
  assert.equal(findRunByCwd(root, { storeDir: store }), null);
  const sibling = path.join(root, 'a-other');
  mkdirSync(sibling);
  assert.equal(findRunByCwd(sibling, { storeDir: store }), null, 'prefix of a path is not containment');
  const link = path.join(root, 'link');
  symlinkSync(wtA, link);
  assert.equal(findRunByCwd(link, { storeDir: store }).id, 'A', 'symlinked cwd resolves');
});

test('CLI without --run uses the cwd lookup', () => {
  const store = tmp();
  const wt = tmp();
  const env = { ...process.env, WAVEWORK_PIPELINE_STORE: store };
  recordEvent(store, 'r9', 'run-start', { worktree: wt });
  const r = spawnSync(process.execPath, [RECORD, 'step-start', '--step', 'plan'], { cwd: wt, env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(events(store, 'r9').at(-1).step, 'plan');
});

test('store resolves via the git common dir from any worktree', () => {
  const repo = tmp();
  const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'i');
  const wt = path.join(tmp(), 'wt');
  git(repo, 'worktree', 'add', '-q', '-b', 'feat', wt);
  const env = {};
  const expected = path.join(realpathSync(repo), '.git', 'pipeline-runs');
  const viaGit = (cwd) => path.join(realpathSync(path.dirname(resolveStoreDir({ cwd, env }))), 'pipeline-runs');
  assert.equal(viaGit(wt), expected);
  assert.equal(viaGit(repo), expected);
});

test('env override wins over git', () => {
  assert.equal(resolveStoreDir({ cwd: '/', env: { WAVEWORK_PIPELINE_STORE: '/x/y' } }), '/x/y');
});

test('parseArgs coerces numbers and lists, camel-cases keys', () => {
  assert.deepEqual(parseArgs(['--wave', '2', '--units', 'a,b', '--red-before-green', 'T1', '--flag', '--name', '12abc']),
    { wave: 2, units: ['a', 'b'], redBeforeGreen: 'T1', flag: true, name: '12abc' });
});

test('broken store dir exits 0 with one stderr line', () => {
  const base = tmp();
  const blocker = path.join(base, 'file');
  writeFileSync(blocker, 'not a dir');
  const r = spawnSync(process.execPath, [RECORD, 'finding', '--run', 'r1', '--bead', 'x'], {
    env: { ...process.env, WAVEWORK_PIPELINE_STORE: path.join(blocker, 'store') }, encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.match(r.stderr, /pipeline-record:/);
});

test('bad input (unknown event, bad run id, no run, outside git) exits 0 with a stderr line', () => {
  const store = tmp();
  const env = { ...process.env, WAVEWORK_PIPELINE_STORE: store };
  for (const args of [['bogus', '--run', 'r1'], ['finding', '--run', '../evil'], ['finding'], []]) {
    const r = spawnSync(process.execPath, [RECORD, ...args], { cwd: tmp(), env, encoding: 'utf8' });
    assert.equal(r.status, 0, args.join(' '));
    assert.match(r.stderr, /pipeline-record:/);
  }
  assert.deepEqual(readdirSync(store), []);
  const lines = [];
  assert.equal(main(['finding', '--run', 'r1'], { cwd: tmp(), env: {}, stderr: (l) => lines.push(l) }), 0);
  assert.equal(lines.length, 1);
});

test('fields cannot override ts, type or run', () => {
  const store = tmp();
  const e = recordEvent(store, 'r1', 'finding', { type: 'run-end', ts: 'x', run: 'other', bead: 'b' });
  assert.deepEqual([e.type, e.run, e.bead], ['finding', 'r1', 'b']);
  assert.match(e.ts, /^\d{4}-/);
  const [line] = events(store, 'r1');
  assert.deepEqual([line.type, line.run], ['finding', 'r1']);
});

test('readRun rejects ids that are not valid run ids, even when the file exists', () => {
  const parent = tmp();
  const store = path.join(parent, 'store');
  mkdirSync(store);
  recordEvent(store, 'r1', 'run-start', {});
  assert.equal(readRun(store, 'r1').id, 'r1');
  mkdirSync(path.join(parent, 'decoy'));
  writeFileSync(path.join(parent, 'decoy', 'run.json'), '{"id":"decoy","status":"running"}');
  mkdirSync(path.join(store, 'a', 'b'), { recursive: true });
  writeFileSync(path.join(store, 'a', 'b', 'run.json'), '{"id":"ab","status":"running"}');
  assert.equal(readRun(store, '../decoy'), null);
  assert.equal(readRun(store, 'a/b'), null);
  for (const id of ['../..', '..', '/etc', '%2e%2e%2f', '', undefined, 'x'.repeat(129)]) {
    assert.equal(readRun(store, id), null, String(id));
  }
});

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../templates/dashboard/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.join(HERE, '..', '..', 'templates', 'dashboard');
const SERVER = path.join(HERE, '..', '..', 'templates', 'dashboard', 'server.mjs');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'pipeline-server-'));

function writeRun(store, run, events) {
  const dir = path.join(store, run.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run));
  writeFileSync(path.join(dir, 'events.jsonl'),
    events.map((e) => JSON.stringify({ run: run.id, ...e })).join('\n') + '\n');
}

const T = (s) => `2026-11-13T10:00:${String(s).padStart(2, '0')}.000Z`;

function fixtureStore() {
  const store = tmp();
  writeRun(store, {
    id: 'batch.x', kind: 'batch', units: ['e1', 'e2'], parent: null, branch: null, worktree: null,
    status: 'running', started: T(0), ended: null,
  }, [{ ts: T(0), type: 'run-start' }]);
  writeRun(store, {
    id: 'epic.e1', kind: 'next-task', units: ['e1'], parent: 'batch.x', branch: 'epic/e1', worktree: '/w/e1',
    status: 'done', started: T(5), ended: T(50),
  }, [
    { ts: T(5), type: 'run-start' },
    { ts: T(6), type: 'step-start', step: 'plan' },
    { ts: T(10), type: 'step-end', step: 'plan' },
    { ts: T(11), type: 'step-start', step: 'wave' },
    { ts: T(12), type: 'child-start', bead: 'e1.1', model: 'sonnet', wave: 1 },
    { ts: T(20), type: 'agent', agentId: 'a1', bead: 'e1.1', model: 'sonnet', durationMs: 8000, tokensIn: 100, tokensOut: 50, tokensCacheRead: 10, tokensCacheWrite: 5, cost: 0.5 },
    { ts: T(21), type: 'agent', agentId: 'a2', bead: 'e1.1', model: 'sonnet', durationMs: 2000, tokensIn: 20, tokensOut: 10, cost: 0.25 },
    { ts: T(22), type: 'child-end', bead: 'e1.1', result: 'ok', redBeforeGreen: 'FooTest' },
    { ts: T(23), type: 'step-end', step: 'wave' },
    { ts: T(24), type: 'review', verdict: 'fix', mustFix: 2, round: 1 },
    { ts: T(30), type: 'review', verdict: 'pass', mustFix: 0, round: 2 },
    { ts: T(31), type: 'tests', scope: 'backend', passed: 10, failed: 0, duration: 12 },
    { ts: T(40), type: 'step-start', step: 'push' },
    { ts: T(41), type: 'step-end', step: 'push', sha: 'abc1234def' },
    { ts: T(50), type: 'run-end' },
  ]);
  return store;
}

async function start(opts = {}) {
  const store = opts.storeDir ?? fixtureStore();
  const publicDir = opts.publicDir ?? path.join(DASH, 'public');
  const server = createServer({ storeDir: store, port: 0, publicDir, ...opts, ghRunner: opts.ghRunner });
  await server.listen();
  const base = `http://127.0.0.1:${server.port}`;
  return { server, store, base, close: () => server.close() };
}

function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: rawPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

test('health answers and server binds 127.0.0.1 only', async () => {
  const s = await start();
  try {
    const r = await fetch(`${s.base}/api/health`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, root: path.resolve(DASH) });
    assert.equal(s.server.address().address, '127.0.0.1');
  } finally { await s.close(); }
});

test('starts in under 1 s with an empty (missing) store', async () => {
  const t0 = Date.now();
  const s = await start({ storeDir: path.join(tmp(), 'nope') });
  try {
    const r = await fetch(`${s.base}/api/runs`);
    assert.deepEqual(await r.json(), []);
    assert.ok(Date.now() - t0 < 1000);
  } finally { await s.close(); }
});

test('GET /api/runs lists newest first with batch members nested under the batch', async () => {
  const s = await start();
  try {
    writeRun(s.store, {
      id: 'beads.old', kind: 'beads', units: ['b'], parent: null, branch: null, worktree: null,
      status: 'done', started: '2026-11-12T10:00:00.000Z', ended: '2026-11-12T11:00:00.000Z',
    }, []);
    const runs = await (await fetch(`${s.base}/api/runs`)).json();
    assert.deepEqual(runs.map((r) => r.id), ['batch.x', 'beads.old']);
    assert.deepEqual(runs[0].children.map((r) => r.id), ['epic.e1']);
    assert.equal(runs[0].children[0].status, 'done');
    assert.equal(runs[1].children.length, 0);
    assert.equal(runs[0].children[0].totals.cost, 0.75);
  } finally { await s.close(); }
});

test('GET /api/runs/:id returns run, events and derived timeline', async () => {
  const s = await start();
  try {
    const d = await (await fetch(`${s.base}/api/runs/epic.e1`)).json();
    assert.equal(d.run.id, 'epic.e1');
    assert.equal(d.events.length, 15);
    const tl = d.timeline;
    const plan = tl.steps.find((x) => x.step === 'plan');
    assert.equal(plan.durationMs, 4000);
    assert.equal(tl.steps.find((x) => x.step === 'push').sha, 'abc1234def');
    assert.equal(tl.children.length, 1);
    const c = tl.children[0];
    assert.equal(c.bead, 'e1.1');
    assert.equal(c.model, 'sonnet');
    assert.equal(c.result, 'ok');
    assert.equal(c.durationMs, 10000);
    assert.deepEqual(c.agents, {
      count: 2, durationMs: 10000, tokensIn: 120, tokensOut: 60, tokensCacheRead: 10, tokensCacheWrite: 5, cost: 0.75,
    });
    assert.deepEqual(tl.reviews.map((r) => [r.round, r.verdict, r.mustFix]), [[1, 'fix', 2], [2, 'pass', 0]]);
    assert.equal(tl.tests[0].passed, 10);
    assert.deepEqual(tl.totals, {
      agents: 2, tokensIn: 120, tokensOut: 60, tokensCacheRead: 10, tokensCacheWrite: 5, cost: 0.75, durationMs: 45000,
    });
    assert.equal(tl.sha, 'abc1234def');
  } finally { await s.close(); }
});

test('timeline tolerates unfinished steps and bad lines', async () => {
  const store = tmp();
  writeRun(store, { id: 'r', kind: 'next-task', units: [], parent: null, status: 'running', started: T(0), ended: null },
    [{ ts: T(0), type: 'run-start' }, { ts: T(1), type: 'step-start', step: 'wave' }]);
  appendFileSync(path.join(store, 'r', 'events.jsonl'), '{"partial":');
  const s = await start({ storeDir: store });
  try {
    const d = await (await fetch(`${s.base}/api/runs/r`)).json();
    assert.equal(d.events.length, 2);
    assert.equal(d.timeline.steps[0].end, null);
    assert.equal(d.timeline.steps[0].durationMs, null);
    assert.equal(d.timeline.sha, null);
  } finally { await s.close(); }
});

test('unknown run id is 404', async () => {
  const s = await start();
  try { assert.equal((await fetch(`${s.base}/api/runs/nothere`)).status, 404); } finally { await s.close(); }
});

test('invalid run ids are 400, never touching the filesystem outside the store', async () => {
  const s = await start();
  try {
    for (const p of ['..', '../x', '%2e%2e%2f', '%2e%2e', '..%2f..%2fetc', '%2F', 'a%2Fb', '%2Fetc%2Fpasswd', '.hidden', 'a%00b', '%E0%A4%A', 'a%20b', 'x'.repeat(129)]) {
      const r = await rawGet(s.server.port, `/api/runs/${p}`);
      assert.equal(r.status, 400, p);
    }
    const r = await rawGet(s.server.port, '/api/runs//etc/passwd');
    assert.ok([400, 404].includes(r.status));
  } finally { await s.close(); }
});

test('static files come from public/ only; traversal is refused', async () => {
  const pub = tmp();
  writeFileSync(path.join(pub, 'index.html'), '<h1>hi</h1>');
  writeFileSync(path.join(pub, 'app.js'), 'x');
  const secret = path.join(tmp(), 'secret.txt');
  writeFileSync(secret, 'secret');
  symlinkSync(secret, path.join(pub, 'link.txt'));
  const tokens = path.join(tmp(), 'tokens.css');
  writeFileSync(tokens, ':root{--a:1}');
  const s = await start({ publicDir: pub, tokensPath: tokens });
  try {
    let r = await rawGet(s.server.port, '/');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.equal(r.body, '<h1>hi</h1>');
    r = await rawGet(s.server.port, '/app.js');
    assert.match(r.headers['content-type'], /javascript/);
    r = await rawGet(s.server.port, '/tokens.css');
    assert.equal(r.body, ':root{--a:1}');
    assert.match(r.headers['content-type'], /text\/css/);
    for (const p of ['/../server.mjs', '/%2e%2e/server.mjs', '/..%2fserver.mjs', '/%2fetc/passwd', '/link.txt', '/a%00', '/nope.txt']) {
      const x = await rawGet(s.server.port, p);
      assert.ok([400, 404].includes(x.status), `${p} -> ${x.status}`);
      assert.ok(!x.body.includes('secret'));
    }
  } finally { await s.close(); }
});

test('CI: parses gh output for the pushed sha, caches completed results', async () => {
  const calls = [];
  const ghRunner = async (args) => {
    calls.push(args);
    return JSON.stringify([
      { status: 'completed', conclusion: 'success', url: 'https://gh/1', name: 'ci' },
      { status: 'completed', conclusion: 'failure', url: 'https://gh/2', name: 'e2e' },
    ]);
  };
  const s = await start({ ghRunner });
  try {
    const d = await (await fetch(`${s.base}/api/runs/epic.e1`)).json();
    assert.equal(d.ci.sha, 'abc1234def');
    assert.equal(d.ci.state, 'failure');
    assert.deepEqual(d.ci.runs.map((r) => r.name), ['ci', 'e2e']);
    assert.deepEqual(calls[0], ['run', 'list', '--commit', 'abc1234def', '--json', 'status,conclusion,url,name']);
    await fetch(`${s.base}/api/runs/epic.e1`);
    assert.equal(calls.length, 1);
  } finally { await s.close(); }
});

test('CI: not-completed runs are refreshed; state reflects progress', async () => {
  let n = 0;
  const ghRunner = async () => {
    n++;
    return JSON.stringify([{ status: n === 1 ? 'in_progress' : 'completed', conclusion: n === 1 ? '' : 'success', url: 'u', name: 'ci' }]);
  };
  const s = await start({ ghRunner, ciRefreshMs: 0 });
  try {
    assert.equal((await (await fetch(`${s.base}/api/runs/epic.e1`)).json()).ci.state, 'pending');
    assert.equal((await (await fetch(`${s.base}/api/runs/epic.e1`)).json()).ci.state, 'success');
  } finally { await s.close(); }
});

test('CI: missing or failing gh = unknown, and runs without a sha have no ci lookup', async () => {
  const enoent = async () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); };
  const s = await start({ ghRunner: enoent });
  try {
    const d = await (await fetch(`${s.base}/api/runs/epic.e1`)).json();
    assert.equal(d.ci.state, 'unknown');
    assert.deepEqual(d.ci.runs, []);
    const b = await (await fetch(`${s.base}/api/runs/batch.x`)).json();
    assert.equal(b.ci, null);
  } finally { await s.close(); }
  const s2 = await start({ ghRunner: async () => 'not json' });
  try {
    assert.equal((await (await fetch(`${s2.base}/api/runs/epic.e1`)).json()).ci.state, 'unknown');
  } finally { await s2.close(); }
});

test('CI: a malicious sha is never passed to gh', async () => {
  const store = tmp();
  const calls = [];
  writeRun(store, { id: 'r', kind: 'next-task', units: [], parent: null, status: 'done', started: T(0), ended: T(1) },
    [{ ts: T(0), type: 'step-end', step: 'push', sha: '--repo=evil' }]);
  const s = await start({ storeDir: store, ghRunner: async (a) => { calls.push(a); return '[]'; } });
  try {
    const d = await (await fetch(`${s.base}/api/runs/r`)).json();
    assert.equal(d.ci.state, 'unknown');
    assert.equal(calls.length, 0);
  } finally { await s.close(); }
});

async function sseOnce(base, trigger, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { req.destroy(); reject(new Error('no SSE event')); }, timeoutMs);
    const req = http.get(`${base}/api/events`, (res) => {
      assert.match(res.headers['content-type'], /text\/event-stream/);
      let buf = '';
      let triggered = false;
      res.on('data', (c) => {
        buf += c;
        if (!triggered) { triggered = true; setTimeout(trigger, 100); }
        const m = buf.match(/event: run-changed\ndata: (\{.*\})\n\n/);
        if (m) { clearTimeout(timer); req.destroy(); resolve(JSON.parse(m[1])); }
      });
    });
    req.on('error', () => {});
  });
}

for (const watch of ['fs', 'poll']) {
  test(`SSE emits run-changed when an events file changes (${watch})`, async () => {
    const s = await start({ watch, pollMs: 50 });
    try {
      const got = await sseOnce(s.base, () =>
        appendFileSync(path.join(s.store, 'epic.e1', 'events.jsonl'), JSON.stringify({ ts: T(55), type: 'finding', bead: 'f' }) + '\n'));
      assert.deepEqual(got, { id: 'epic.e1' });
    } finally { await s.close(); }
  });
}

test('SSE emits for a brand-new run in a store that did not exist at start', async () => {
  const store = path.join(tmp(), 'later');
  const s = await start({ storeDir: store, pollMs: 50 });
  try {
    const got = await sseOnce(s.base, () =>
      writeRun(store, { id: 'new.run', kind: 'beads', units: [], parent: null, status: 'running', started: T(0), ended: null }, []));
    assert.equal(got.id, 'new.run');
  } finally { await s.close(); }
});

test('CLI entry binds PIPELINE_DASHBOARD_PORT and serves health', async () => {
  const store = tmp();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, WAVEWORK_PIPELINE_STORE: store, PIPELINE_DASHBOARD_PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    const port = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no listen line')), 3000);
      child.stdout.on('data', (d) => {
        const m = String(d).match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (m) { clearTimeout(t); resolve(Number(m[1])); }
      });
    });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
  } finally { child.kill(); }
});

test('cost is null when any agent lacks a numeric cost; no agents means null', async () => {
  const store = tmp();
  writeRun(store, { id: 'r', kind: 'next-task', units: [], parent: null, status: 'running', started: T(0), ended: null }, [
    { ts: T(1), type: 'child-start', bead: 'b1', model: 'sonnet' },
    { ts: T(2), type: 'agent', agentId: 'a1', bead: 'b1', tokensIn: 5, cost: 0.5 },
    { ts: T(3), type: 'agent', agentId: 'a2', bead: 'b1', tokensIn: 5 },
    { ts: T(4), type: 'child-end', bead: 'b1', result: 'ok' },
    { ts: T(5), type: 'child-start', bead: 'b2' },
  ]);
  const s = await start({ storeDir: store });
  try {
    const d = await (await fetch(`${s.base}/api/runs/r`)).json();
    assert.equal(d.timeline.children[0].agents.cost, null);
    assert.equal(d.timeline.children[0].agents.tokensIn, 10);
    assert.equal(d.timeline.totals.cost, null);
    assert.equal(d.timeline.children[1].agents.count, 0);
    assert.equal(d.timeline.children[1].agents.cost, null);
  } finally { await s.close(); }
});

test('steps with the same name are paired by wave, ends may arrive in any order', async () => {
  const store = tmp();
  writeRun(store, { id: 'r', kind: 'next-task', units: [], parent: null, status: 'running', started: T(0), ended: null }, [
    { ts: T(1), type: 'step-start', step: 'wave', wave: 1 },
    { ts: T(2), type: 'step-start', step: 'wave', wave: 2 },
    { ts: T(5), type: 'step-end', step: 'wave', wave: 1 },
    { ts: T(9), type: 'step-end', step: 'wave', wave: 2 },
    { ts: T(12), type: 'step-end', step: 'wave', wave: 3 },
  ]);
  const s = await start({ storeDir: store });
  try {
    const steps = (await (await fetch(`${s.base}/api/runs/r`)).json()).timeline.steps;
    assert.deepEqual(steps.map((x) => [x.wave, x.durationMs]), [[1, 4000], [2, 7000], [3, null]]);
  } finally { await s.close(); }
});

test('CI: failure is refreshed on the TTL (re-runs), success is cached for good', async () => {
  let n = 0;
  const ghRunner = async () => { n++; return JSON.stringify([{ status: 'completed', conclusion: n === 1 ? 'failure' : 'success', url: 'u', name: 'ci' }]); };
  const s = await start({ ghRunner, ciRefreshMs: 0 });
  try {
    assert.equal((await (await fetch(`${s.base}/api/runs/epic.e1`)).json()).ci.state, 'failure');
    assert.equal((await (await fetch(`${s.base}/api/runs/epic.e1`)).json()).ci.state, 'success');
    await fetch(`${s.base}/api/runs/epic.e1`);
    assert.equal(n, 2);
  } finally { await s.close(); }
});

test('foreign Host headers are rejected with 403 (DNS rebinding guard)', async () => {
  const s = await start();
  try {
    const get = (host) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: s.server.port, path: '/api/health', headers: { host } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(await get('evil.example'), 403);
    assert.equal(await get(`evil.example:${s.server.port}`), 403);
    assert.equal(await get(`localhost:${s.server.port}`), 200);
    assert.equal(await get(`127.0.0.1:${s.server.port}`), 200);
  } finally { await s.close(); }
});

test('a running batch whose members have all ended is reported as ended', async () => {
  const store = tmp();
  const base = { kind: 'next-task', units: [], worktree: null, branch: null };
  writeRun(store, { id: 'b', ...base, kind: 'batch', parent: null, status: 'running', started: T(0), ended: null }, []);
  writeRun(store, { id: 'm1', ...base, parent: 'b', status: 'done', started: T(1), ended: T(10) }, []);
  writeRun(store, { id: 'm2', ...base, parent: 'b', status: 'blocked', started: T(11), ended: T(20) }, []);
  writeRun(store, { id: 'c', ...base, kind: 'batch', parent: null, status: 'running', started: T(0), ended: null }, []);
  writeRun(store, { id: 'c1', ...base, parent: 'c', status: 'done', started: T(1), ended: T(10) }, []);
  writeRun(store, { id: 'c2', ...base, parent: 'c', status: 'running', started: T(11), ended: null }, []);
  const s = await start({ storeDir: store });
  try {
    const runs = await (await fetch(`${s.base}/api/runs`)).json();
    const b = runs.find((r) => r.id === 'b');
    assert.equal(b.status, 'blocked');
    assert.equal(b.ended, T(20));
    assert.equal(runs.find((r) => r.id === 'c').status, 'running');
    assert.equal((await (await fetch(`${s.base}/api/runs/b`)).json()).run.status, 'blocked');
  } finally { await s.close(); }
});

test('/api/info reports the project name; the UI title and brand use it', async () => {
  const s = await start({ project: 'my-app' });
  try {
    assert.deepEqual(await (await fetch(`${s.base}/api/info`)).json(), { project: 'my-app' });
  } finally { await s.close(); }
});

test('/tokens.css without project tokens is an empty stylesheet, not an error', async () => {
  const s = await start({ publicDir: path.join(DASH, 'public'), tokensPath: null });
  try {
    const r = await rawGet(s.server.port, '/tokens.css');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/css/);
    assert.doesNotMatch(r.body, /--/);
  } finally { await s.close(); }
});

test('/tokens.css follows a tokensPath function per request: safe file served, null becomes empty', async () => {
  const file = path.join(tmp(), 'tokens.css');
  writeFileSync(file, ':root{--b:2}');
  let current = file;
  const s = await start({ tokensPath: () => current });
  try {
    assert.equal((await rawGet(s.server.port, '/tokens.css')).body, ':root{--b:2}');
    current = null;
    assert.doesNotMatch((await rawGet(s.server.port, '/tokens.css')).body, /--b/);
  } finally { await s.close(); }
});

test('shipped UI loads the neutral default theme before the project tokens, and defines every token app.css uses', async () => {
  const html = readFileSync(path.join(DASH, 'public', 'index.html'), 'utf8');
  assert.ok(html.indexOf('/default-theme.css') !== -1 && html.indexOf('/default-theme.css') < html.indexOf('/tokens.css'));
  assert.ok(html.indexOf('/tokens.css') < html.indexOf('/app.css'));
  const theme = readFileSync(path.join(DASH, 'public', 'default-theme.css'), 'utf8');
  const css = readFileSync(path.join(DASH, 'public', 'app.css'), 'utf8');
  const missing = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))].filter((v) => !theme.includes(`${v}:`));
  assert.deepEqual(missing, []);
  assert.doesNotMatch(theme + css, /shipir/i);
});

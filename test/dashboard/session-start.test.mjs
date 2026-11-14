import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.join(here, '..', '..', 'templates', 'dashboard');
/** The stale-server stop needs lsof and ps; tests that expect a kill are skipped without them. */
const toolsMissing = (() => {
  for (const [cmd, args] of [['lsof', ['-v']], ['ps', ['-p', String(process.pid)]]]) {
    if (spawnSync(cmd, args, { stdio: 'ignore' }).error) return 'lsof/ps not available';
  }
  return false;
})();
const HOOK = path.join(DASH, 'hooks', 'session-start.mjs');
const SERVER = path.join(DASH, 'server.mjs');

/** Every port a test in this file used; the module-level check below makes sure none still answers. */
const usedPorts = new Set();

/** A free TCP port on 127.0.0.1 (bound then released). */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Runs the hook as Claude Code would (SessionStart JSON on stdin). */
function runHook({ port, store, cwd = process.cwd(), env = {} }) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn('node', [HOOK], {
      cwd,
      env: { ...process.env, PIPELINE_DASHBOARD_PORT: String(port), WAVEWORK_PIPELINE_STORE: store, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr, elapsed: Date.now() - started }));
    child.stdin.end(JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd }));
  });
}

/** Parsed body of GET /api/health, or null when it does not answer {ok:true}. */
function healthBody(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 300, agent: false }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(res.statusCode === 200 && json.ok === true ? json : null);
        } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

const healthOk = async (port) => (await healthBody(port)) !== null;

async function waitFor(check, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

/**
 * A per-test sandbox: temp store, a free port, and cleanup registered with t.after, which runs even when an
 * assertion fails. Cleanup stops only what this test started: the pid the hook recorded in its own store, and
 * the children the test spawned (see killOnExit). Then it checks that the port is free.
 */
async function sandbox(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'session-start-'));
  const store = path.join(root, 'store');
  const port = await freePort();
  usedPorts.add(port);
  usedPorts.add(port + 1);
  const box = {
    root,
    store,
    port,
    pidFile: path.join(store, 'server.pid'),
    logFile: path.join(store, 'server.log'),
    lockFile: path.join(store, 'server.starting'),
    children: [],
  };
  t.after(async () => {
    // Children first: a live child keeps the test process running, and a failing stop below must not skip them.
    try {
      for (const child of box.children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await stopRecorded(box);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  return box;
}

/** Stops the server recorded by the hook in <store>/server.pid, then waits until the port (and the next) answers nothing. */
async function stopRecorded({ port, pidFile }) {
  if (existsSync(pidFile)) {
    try {
      const { pid } = JSON.parse(readFileSync(pidFile, 'utf8'));
      process.kill(pid, 'SIGTERM');
    } catch { /* not recorded, malformed, or already gone */ }
  }
  const down = await waitFor(async () => !(await healthOk(port)) && !(await healthOk(port + 1)), 3000);
  if (!down) throw new Error(`a server still answers on port ${port} or ${port + 1} after cleanup`);
}

/** True while a child process has neither exited nor been killed by a signal (exitCode stays null on a signal). */
const isAlive = (child) => child.exitCode === null && child.signalCode === null;

/** Registers a child the test spawned; sandbox cleanup kills it however the test ends. */
function killOnExit(box, child) {
  box.children.push(child);
  return child;
}

/** Starts server.mjs directly (as the user would) and waits until it answers health. */
async function startServer(box) {
  const child = killOnExit(box, spawn('node', [SERVER], {
    env: { ...process.env, PIPELINE_DASHBOARD_PORT: String(box.port), WAVEWORK_PIPELINE_STORE: box.store },
    stdio: 'ignore',
  }));
  const up = await waitFor(() => healthOk(box.port));
  assert.ok(up, 'test server did not come up');
  return child;
}

/** The checkout the hook should run server.mjs from: the main checkout when it has one, else this worktree. */
function expectedRoot() {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: process.cwd(), encoding: 'utf8',
  }).trim();
  const main = path.join(path.dirname(common), '.claude', 'wavework', 'dashboard');
  return existsSync(path.join(main, 'server.mjs')) ? main : DASH;
}

/**
 * A tiny stand-in for a dashboard server that answers health on the box port and reports `reportedRoot`.
 * Runs as its own process. Named like the real server so the hook's "is this the dashboard server" check
 * (ps command line) accepts it.
 */
function spawnFakeServer(box, reportedRoot, dir = path.join(box.root, 'dashboard'), reportedStore = undefined) {
  mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'server.mjs');
  writeFileSync(script, `import http from 'node:http';
http.createServer((q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ ok: true, root: ${JSON.stringify(reportedRoot)}, store: ${JSON.stringify(reportedStore)} })); })
  .listen(${box.port}, '127.0.0.1');
`);
  return killOnExit(box, spawn(process.execPath, [script], { stdio: 'ignore' }));
}

/**
 * A stand-in whose checkout has been deleted: it runs from <box>/gone-checkout/server.mjs, reports that directory
 * as its root and the directory is removed once it answers. `child.staleRoot` is the (now missing) root.
 */
async function spawnStaleServer(box) {
  const staleRoot = path.join(box.root, 'gone-checkout');
  const child = spawnFakeServer(box, staleRoot, staleRoot);
  assert.ok(await waitFor(() => healthOk(box.port)), 'stale stand-in did not come up');
  rmSync(staleRoot, { recursive: true, force: true });
  child.staleRoot = staleRoot;
  return child;
}

/** Imports the hook's helpers (the CLI does not run when imported). */
const hookModule = () => import(HOOK);

/** The URL message for this repository's server on `port`, noting the configured port when it differs. */
const urlMessage = (box, port = box.port) => `Pipeline dashboard: http://127.0.0.1:${port}${port === box.port ? '' : ` (port ${box.port} is taken by another process or repository)`}`;

/** Asserts the hook started this repository's server on the port after the configured one. */
async function assertStartedOnNextPort(box, r) {
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).systemMessage, urlMessage(box, box.port + 1));
  const health = await healthBody(box.port + 1);
  assert.ok(health, 'a server for this repository must answer on the next port');
  assert.equal(health.store, box.store);
}

test('running server: hook prints its URL and starts nothing', async (t) => {
  const box = await sandbox(t);
  await startServer(box);
  const r = await runHook(box);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).systemMessage, urlMessage(box));
  assert.equal(existsSync(box.pidFile), false, 'no second server must be started');
});

test('no server: hook starts server.mjs detached, prints the URL as systemMessage, ', async (t) => {
  const box = await sandbox(t);
  const r = await runHook(box);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.systemMessage, `Pipeline dashboard: http://127.0.0.1:${box.port}`);
  const health = await healthBody(box.port);
  assert.ok(health, 'server must answer health after the hook returns');
  assert.equal(health.root, expectedRoot(), 'server runs from the main checkout when it has one');
  assert.ok(existsSync(box.logFile), 'server output goes to <store>/server.log');
  assert.ok(existsSync(box.pidFile), 'hook records the server pid for cleanup');
});

test('server still starting when the hook stops waiting: its pid is recorded, so it can be stopped', async (t) => {
  const box = await sandbox(t);
  const r = await runHook({ ...box, env: { PIPELINE_DASHBOARD_START_WAIT_MS: '1' } });
  assert.equal(r.code, 0);
  assert.ok(existsSync(box.pidFile), 'the spawned pid must be recorded even if the hook gives up waiting');
  assert.ok(await waitFor(() => healthOk(box.port)), 'the server still comes up after the hook returned');
});

test('two hooks started back to back start only one server', async (t) => {
  const box = await sandbox(t);
  const [a, b] = await Promise.all([runHook(box), runHook(box)]);
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  assert.ok(await healthOk(box.port));
  const log = existsSync(box.logFile) ? readFileSync(box.logFile, 'utf8') : '';
  // Without the start lock the second server fails with EADDRINUSE and logs a second "pipeline dashboard:" line.
  assert.equal(log.includes('EADDRINUSE'), false, `second server tried to start, log:\n${log}`);
  const lines = log.split('\n').filter((l) => l.includes('pipeline dashboard:')).length;
  assert.equal(lines, 1, `expected exactly one "pipeline dashboard:" line, log:\n${log}`);
  // A third run after both returned sees the running server and only prints its URL.
  const c = await runHook(box);
  assert.equal(JSON.parse(c.stdout).systemMessage, urlMessage(box));
  assert.equal(readFileSync(box.logFile, 'utf8').split('\n').filter((l) => l.includes('pipeline dashboard:')).length, 1);
});

test('stale start lock (crashed hook, older than 5 s) is taken over: server starts', async (t) => {
  const box = await sandbox(t);
  mkdirSync(box.store, { recursive: true });
  writeFileSync(box.lockFile, '');
  const old = new Date(Date.now() - 60_000);
  utimesSync(box.lockFile, old, old);
  const r = await runHook(box);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).systemMessage, `Pipeline dashboard: http://127.0.0.1:${box.port}`);
  assert.ok(await healthOk(box.port));
  assert.equal(existsSync(box.lockFile), false, 'the lock is released after the start');
});

test('fresh start lock (another hook is starting): this hook does not spawn', async (t) => {
  const box = await sandbox(t);
  mkdirSync(box.store, { recursive: true });
  writeFileSync(box.lockFile, '');
  const r = await runHook(box);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.includes('http://'), false, `no URL expected, got: ${r.stdout}`);
  assert.equal(await healthOk(box.port), false, 'no server must be started');
  assert.equal(existsSync(box.pidFile), false);
  assert.equal(existsSync(box.logFile), false);
  assert.equal(existsSync(box.lockFile), true, 'a lock that is not ours is left alone');
});

test('healthy server whose checkout is gone: stopped via the recorded pid, replaced by a fresh one', { skip: toolsMissing }, async (t) => {
  const box = await sandbox(t);
  mkdirSync(box.store, { recursive: true });
  const stale = await spawnStaleServer(box);
  writeFileSync(box.pidFile, JSON.stringify({ pid: stale.pid, port: box.port, root: stale.staleRoot }));
  const r = await runHook(box);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).systemMessage, `Pipeline dashboard: http://127.0.0.1:${box.port}`);
  assert.ok(await waitFor(() => stale.exitCode !== null || stale.signalCode !== null, 15000), 'stale server must be stopped');
  const health = await healthBody(box.port);
  assert.ok(health, 'a fresh server must answer');
  assert.equal(health.root, expectedRoot());
});

test('healthy server whose checkout is gone but not the recorded pid: nothing is killed, the next port is used', async (t) => {
  const box = await sandbox(t);
  mkdirSync(box.store, { recursive: true });
  const stale = await spawnStaleServer(box);
  const unrelated = killOnExit(box, spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }));
  // The recorded pid belongs to another process on another port: it must not be killed.
  writeFileSync(box.pidFile, JSON.stringify({ pid: unrelated.pid, port: box.port + 5, root: stale.staleRoot }));
  await assertStartedOnNextPort(box, await runHook(box));
  assert.ok(isAlive(unrelated), 'unrelated process must stay alive');
  assert.ok(isAlive(stale), 'the server that is not the recorded one must stay alive');
});

test('record names a live process that does not hold the port: nothing is killed', async (t) => {
  const box = await sandbox(t);
  mkdirSync(box.store, { recursive: true });
  const stale = await spawnStaleServer(box);
  const bystander = killOnExit(box, spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }));
  // Same port and same missing root as the answering server, but the recorded pid is a bystander, not the listener
  // (what pid reuse after a restart would look like).
  writeFileSync(box.pidFile, JSON.stringify({ pid: bystander.pid, port: box.port, root: stale.staleRoot }));
  await assertStartedOnNextPort(box, await runHook(box));
  assert.ok(isAlive(bystander), 'a process that does not hold the port must not be killed');
  assert.ok(isAlive(stale), 'the listener is left alone when its pid is not the recorded one');
});

test('recording a spawned pid never replaces the record of a live server on the same port', async (t) => {
  const box = await sandbox(t);
  mkdirSync(box.store, { recursive: true });
  const checkout = DASH;
  const live = spawnFakeServer(box, checkout);
  assert.ok(await waitFor(() => healthOk(box.port)), 'live stand-in did not come up');
  writeFileSync(box.pidFile, JSON.stringify({ pid: live.pid, port: box.port, root: checkout }));
  const newcomer = killOnExit(box, spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }));
  const { recordSpawnedPid } = await hookModule();
  const written = await recordSpawnedPid(box.pidFile, { pid: newcomer.pid, port: box.port, root: checkout });
  assert.equal(written, false, 'the record of a live server on this port must stay');
  assert.equal(JSON.parse(readFileSync(box.pidFile, 'utf8')).pid, live.pid);
});

test('recording a spawned pid replaces a record whose process is gone', async (t) => {
  const box = await sandbox(t);
  mkdirSync(box.store, { recursive: true });
  const gone = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((resolve) => gone.once('exit', resolve));
  writeFileSync(box.pidFile, JSON.stringify({ pid: gone.pid, port: box.port, root: 'x' }));
  const newcomer = killOnExit(box, spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }));
  const { recordSpawnedPid } = await hookModule();
  const written = await recordSpawnedPid(box.pidFile, { pid: newcomer.pid, port: box.port, root: 'x' });
  assert.equal(written, true);
  assert.equal(JSON.parse(readFileSync(box.pidFile, 'utf8')).pid, newcomer.pid);
});

test('foreign process on the port: the server starts on the next port', async (t) => {
  const box = await sandbox(t);
  const foreign = http.createServer((req, res) => { res.writeHead(404); res.end('nope'); });
  await new Promise((resolve) => foreign.listen(box.port, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => foreign.close(resolve)));
  await assertStartedOnNextPort(box, await runHook(box));
});

test("another repository's dashboard on the port: it is left alone and this repository's server starts on the next port", async (t) => {
  // The bug this guards against: every repository shares the configured port, so a session in repository B used to
  // find repository A's healthy server, print nothing, and B's runs never appeared until A's server was stopped.
  const box = await sandbox(t);
  const otherRepo = spawnFakeServer(box, DASH, path.join(box.root, 'other-repo'), path.join(box.root, 'other-store'));
  assert.ok(await waitFor(() => healthOk(box.port)), 'stand-in did not come up');
  await assertStartedOnNextPort(box, await runHook(box));
  assert.ok(isAlive(otherRepo), "the other repository's server must stay alive");
  // The next session finds the server on the next port instead of starting another one.
  const again = await runHook(box);
  assert.equal(JSON.parse(again.stdout).systemMessage, urlMessage(box, box.port + 1));
  assert.equal(readFileSync(box.logFile, 'utf8').split('\n').filter((l) => l.includes('pipeline dashboard:')).length, 1);
});

test('every candidate port taken: one warning, nothing started', async (t) => {
  const box = await sandbox(t);
  const taken = [];
  for (let p = box.port; p < box.port + 10; p++) {
    const s = http.createServer((req, res) => { res.writeHead(404); res.end('nope'); });
    // A port another process already holds counts as taken too.
    await new Promise((resolve) => { s.once('error', resolve); s.listen(p, '127.0.0.1', resolve); });
    taken.push(s);
  }
  t.after(() => Promise.all(taken.map((s) => new Promise((resolve) => s.close(resolve)))));
  const r = await runHook(box);
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.stdout).systemMessage, new RegExp(`ports ${box.port}-${box.port + 9} are all in use`));
  assert.equal(existsSync(box.pidFile), false);
});

test('classify: a server reporting this store is mine, another store is other, a missing checkout is stale', async () => {
  const { classify } = await hookModule();
  const store = mkdtempSync(path.join(tmpdir(), 'classify-'));
  t_cleanup.push(store);
  assert.equal(classify({ state: 'ok', root: DASH, store }, store), 'mine');
  assert.equal(classify({ state: 'ok', root: DASH, store: path.join(store, 'x') }, store), 'other');
  assert.equal(classify({ state: 'ok', root: '/definitely/missing', store }, store), 'stale');
  assert.equal(classify({ state: 'free', root: null, store: null }, store), 'free');
  assert.equal(classify({ state: 'foreign', root: null, store: null }, store), 'foreign');
});
const t_cleanup = [];
after(() => { for (const d of t_cleanup) rmSync(d, { recursive: true, force: true }); });

test('errors never fail the session: invalid port or unusable store exit 0 silently', async (t) => {
  const box = await sandbox(t);
  const bad = await runHook({ ...box, port: 'not-a-port' });
  assert.equal(bad.code, 0);
  assert.equal(bad.stdout, '');

  // The store path is a regular file, so the store directory cannot be created.
  writeFileSync(box.store, 'x');
  const unusable = await runHook(box);
  assert.equal(unusable.code, 0);
  assert.equal(unusable.stdout, '');
});

// Final check for the whole file: no server may still answer on any port the tests used.
after(async () => {
  const leaked = [];
  for (const port of usedPorts) if (await healthOk(port)) leaked.push(port);
  assert.deepEqual(leaked, [], 'servers still listening on test ports after the run');
});

test('a server whose command line is another checkout\'s server.mjs is never stopped, even if pid, port and root match the record', async (t) => {
  const box = await sandbox(t);
  mkdirSync(box.store, { recursive: true });
  // Runs from <box>/other/server.mjs but reports (and is recorded with) a missing root of a different checkout.
  const other = spawnFakeServer(box, '/definitely/missing/checkout', path.join(box.root, 'other'));
  assert.ok(await waitFor(() => healthOk(box.port)), 'stand-in did not come up');
  writeFileSync(box.pidFile, JSON.stringify({ pid: other.pid, port: box.port, root: '/definitely/missing/checkout' }));
  await assertStartedOnNextPort(box, await runHook(box));
  assert.ok(isAlive(other), 'the foreign server must stay alive');
});

test('commandNamesServer matches the server file as a whole argument, not as the tail of another path', async () => {
  const { commandNamesServer } = await hookModule();
  const file = '/x/root/server.mjs';
  assert.equal(commandNamesServer(`/usr/bin/node ${file}`, file), true);
  assert.equal(commandNamesServer(`node ${file}\n`, file), true);
  assert.equal(commandNamesServer(file, file), true);
  assert.equal(commandNamesServer('node /y/x/root/server.mjs', file), false, 'suffix of a longer path');
  assert.equal(commandNamesServer('node /x/root/server.mjs.bak', file), false, 'prefix of a longer name');
  assert.equal(commandNamesServer('node /x/root/server.mjsx --flag', file), false);
  assert.equal(commandNamesServer('node /x/r.ot/server.mjs', '/x/r.ot/server.mjs'), true, 'regex characters are literal');
  assert.equal(commandNamesServer('node /x/rXot/server.mjs', '/x/r.ot/server.mjs'), false);
});

test('a server running from a path that merely ends with the recorded root is not stopped (real suffix collision)', { skip: toolsMissing }, async (t) => {
  const box = await sandbox(t);
  mkdirSync(box.store, { recursive: true });
  const missingRoot = path.join(box.root, 'root'); // recorded root, never exists
  const lookalike = `${path.join(box.root, 'pre')}${missingRoot}`; // <box>/pre<box>/root: its server.mjs path ends with the recorded one
  const other = spawnFakeServer(box, missingRoot, lookalike);
  assert.ok(await waitFor(() => healthOk(box.port)), 'stand-in did not come up');
  writeFileSync(box.pidFile, JSON.stringify({ pid: other.pid, port: box.port, root: missingRoot }));
  await assertStartedOnNextPort(box, await runHook(box));
  assert.ok(isAlive(other));
});

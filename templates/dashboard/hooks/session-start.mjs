#!/usr/bin/env node
// SessionStart hook: makes sure the pipeline dashboard server runs and tells the user its URL.
// Health answers from a live checkout -> silent. Port free -> start server.mjs detached (log in <store>/server.log)
// and print the URL. Port held by something else, or by a server whose checkout was deleted and is not the
// recorded one -> one warning. Always exits 0.
// Time budget (hard kill is the 5 s `timeout` in settings.json), worst case = stale-server replace path:
//   probe 300 ms + lsof 800 + ps 800 + stop wait 250 + start wait 2000 + probes 150 + node start-up ~100  =  about 4.4 s.
// Keep the sum under 5 s when changing any of these.
// Output format: https://code.claude.com/docs/en/hooks.md (systemMessage on stdout JSON; exit 0).
import { execFile, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStoreDir } from '../record.mjs';
import { resolvePort } from '../lib/settings.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OWN_SERVER = path.join(HERE, '..', 'server.mjs');
// Where the dashboard lives in a checkout (wavework init puts it there).
const DASHBOARD_REL = ['.claude', 'wavework', 'dashboard'];
const PROBE_MS = 300;        // first health probe
const LOOP_PROBE_MS = 150;   // probes while waiting for a started server
// How long a started server gets to answer. The env override is for tests (a near-zero wait forces "gave up waiting").
const WAIT_MS = Number(process.env.PIPELINE_DASHBOARD_START_WAIT_MS) > 0 ? Number(process.env.PIPELINE_DASHBOARD_START_WAIT_MS) : 2000;
const EXEC_MS = 800;         // lsof / ps each (a loaded machine can be slow; see the budget above)
const STOP_WAIT_MS = 250;    // how long a stopped stale server gets to release the port
const STALE_LOCK_MS = 5000;  // a start lock this old belongs to a crashed hook

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function emit(systemMessage) {
  process.stdout.write(JSON.stringify({ systemMessage }) + '\n');
}

const inUse = (port) => `Pipeline dashboard: port ${port} is in use by another process (set dashboard.port in .claude/wavework.json and run wavework update to change it)`;
const staleInUse = (port) => `Pipeline dashboard: port ${port} is in use by a server from a missing checkout that is not the recorded one; stop it to start the dashboard`;
const couldNotStart = (logFile) => `Pipeline dashboard: could not start, see ${logFile}`;

/**
 * Health probe. state: 'ok' (our health answers {"ok":true}), 'free' (connection refused),
 * 'foreign' (something else answers, or accepts the connection but does not answer in time).
 * root: the checkout directory the server reports, when it reports one.
 */
function probe(port, timeout) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode === 200 && json.ok === true) {
            resolve({ state: 'ok', root: typeof json.root === 'string' ? json.root : null });
            return;
          }
        } catch { /* not our health answer */ }
        resolve({ state: 'foreign', root: null });
      });
      res.on('error', () => resolve({ state: 'foreign', root: null }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ state: 'foreign', root: null }); });
    req.on('error', (e) => resolve({ state: e.code === 'ECONNREFUSED' ? 'free' : 'foreign', root: null }));
  });
}

const isMissingCheckout = (root) => typeof root === 'string' && !existsSync(root);


/** Runs a fixed program with an argument list (no shell). Resolves to stdout, or null when it cannot run or fails. */
function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', timeout: EXEC_MS }, (err, stdout) => resolve(err ? null : stdout));
  });
}

/**
 * True only when `pid` is the single listener on `port` and its command line is the dashboard server. A pid that is
 * merely recorded (pids get reused) is not enough. Anything that cannot be checked (no lsof or ps, no listener) counts
 * as not proven, so nothing is killed.
 */
/** True when `command` names `serverFile` as a whole argument (not merely as the tail of a longer path). */
export function commandNamesServer(command, serverFile) {
  const escaped = serverFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(command.trim());
}

async function isDashboardListener(pid, port, serverFile) {
  const listing = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  if (listing === null) return false;
  const pids = listing.split('\n').filter(Boolean).map(Number);
  if (pids.length !== 1 || pids[0] !== pid) return false;
  const command = await run('ps', ['-p', String(pid), '-o', 'command=']);
  return command !== null && commandNamesServer(command, serverFile);
}

/** The main checkout's directory (the common git dir's parent), or null outside git. */
function mainCheckout() {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.dirname(common);
  } catch {
    return null;
  }
}

/**
 * Which server.mjs to run: the main checkout's when it has one, so the long-lived server does not depend on a
 * worktree that a later /next-task-finish deletes; otherwise the copy this hook belongs to.
 */
function serverLocation() {
  const main = mainCheckout();
  const mainServer = main ? path.join(main, ...DASHBOARD_REL, 'server.mjs') : null;
  if (mainServer && existsSync(mainServer)) return { server: mainServer, cwd: main, root: path.dirname(mainServer) };
  return { server: OWN_SERVER, cwd: process.cwd(), root: path.dirname(OWN_SERVER) };
}

/** Exclusive create of the start lock. A lock older than STALE_LOCK_MS (crashed hook) is taken over. */
function acquireLock(lockFile) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return openSync(lockFile, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (!takeOverStaleLock(lockFile)) return null;
    }
  }
  return null;
}

/**
 * Removes a stale lock without racing other hooks: rename is atomic, so the lock file is moved to a unique name
 * and only the hook that moved it inspects it. A fresh lock that was moved by mistake is linked back (link does
 * not overwrite, so a lock someone else created meanwhile is never replaced). Returns true if a stale lock was removed.
 */
function takeOverStaleLock(lockFile) {
  const parked = `${lockFile}.${process.pid}.${randomUUID()}`;
  try {
    renameSync(lockFile, parked);
  } catch {
    return false; // gone, or moved by another hook
  }
  let stale = false;
  try {
    stale = Date.now() - statSync(parked).mtimeMs >= STALE_LOCK_MS;
  } catch { /* unreadable: treat as not ours */ }
  if (!stale) {
    try { linkSync(parked, lockFile); } catch { /* someone else created a lock meanwhile */ }
  }
  rmSync(parked, { force: true });
  return stale;
}

const readRecord = (pidFile) => {
  try {
    return JSON.parse(readFileSync(pidFile, 'utf8'));
  } catch {
    return null;
  }
};

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/**
 * Records the pid of a freshly spawned server, unless <store>/server.pid already names a live server on the same
 * port (then that server stays recorded). Returns true when the record was written.
 */
export async function recordSpawnedPid(pidFile, record) {
  const current = readRecord(pidFile);
  if (current && current.port === record.port && Number.isInteger(current.pid) && isAlive(current.pid)
      && (await probe(record.port, LOOP_PROBE_MS)).state === 'ok') {
    return false;
  }
  writeFileSync(pidFile, JSON.stringify(record));
  return true;
}

/**
 * Spawns the detached server and records its pid at once, before any health wait: a server that is still starting
 * when the hook stops waiting must stay stoppable (the next session or a test cleanup reads this record).
 */
async function startServer({ server, cwd, root }, { logFile, pidFile, port }) {
  const logFd = openSync(logFile, 'a');
  let child;
  try {
    child = spawn(process.execPath, [server], { cwd, env: { ...process.env, PIPELINE_DASHBOARD_PORT: String(port) }, detached: true, stdio: ['ignore', logFd, logFd] });
  } finally {
    closeSync(logFd);
  }
  const spawned = { child, exited: false, answered: false };
  if (child.pid) await recordSpawnedPid(pidFile, { pid: child.pid, port, root });
  // A child that exits clears only its own record, and only if it never answered health: a process that served
  // is a real server, and its record is not this hook's to drop.
  const forget = () => {
    spawned.exited = true;
    if (spawned.answered) return;
    if (readRecord(pidFile)?.pid === child.pid) rmSync(pidFile, { force: true });
  };
  child.once('exit', forget);
  child.once('error', forget);
  child.unref();
  return spawned;
}

/** Probes until the server answers ok, the spawned child exits, or WAIT_MS passes. Returns the last probe. */
async function waitForServer(port, spawned) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const last = await probe(port, LOOP_PROBE_MS);
    if (last.state === 'ok') {
      if (spawned) spawned.answered = true;
      return { state: 'ok', last };
    }
    if (spawned?.exited || Date.now() >= deadline) return { state: 'failed', last };
    await sleep(100);
  }
}

/**
 * Stops the server recorded in <store>/server.pid, but only when the record matches the answering server exactly
 * (same port and same checkout root). Returns true once the port is free.
 */
async function stopRecordedServer(pidFile, port, root) {
  const record = readRecord(pidFile);
  if (!record || record.port !== port || record.root !== root || !Number.isInteger(record.pid) || record.pid < 1) return false;
  // The command line must name this record's own server file (<root>/server.mjs): another repo's dashboard, or
  // a developer's own, never matches, so one repo's hook can only ever stop the server it started itself.
  if (!(await isDashboardListener(record.pid, port, path.join(String(record.root), 'server.mjs')))) return false;
  try {
    process.kill(record.pid, 'SIGTERM');
  } catch {
    return false;
  }
  const deadline = Date.now() + STOP_WAIT_MS;
  while (Date.now() < deadline) {
    if ((await probe(port, LOOP_PROBE_MS)).state === 'free') {
      rmSync(pidFile, { force: true });
      return true;
    }
    await sleep(50);
  }
  return false;
}

async function main() {
  const port = resolvePort(path.join(HERE, '..'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return;
  const url = `http://127.0.0.1:${port}`;

  const first = await probe(port, PROBE_MS);
  if (first.state === 'foreign') return emit(inUse(port));
  if (first.state === 'ok' && !isMissingCheckout(first.root)) return;

  const storeDir = resolveStoreDir({ cwd: process.cwd() });
  mkdirSync(storeDir, { recursive: true });
  const pidFile = path.join(storeDir, 'server.pid');
  const logFile = path.join(storeDir, 'server.log');
  if (first.state === 'ok') {
    // Healthy server whose checkout was deleted: replace it, but only the process we recorded for this port and root.
    if (!(await stopRecordedServer(pidFile, port, first.root))) return emit(staleInUse(port));
  }

  // Only the session holding the lock spawns; a concurrent session waits for that server instead.
  const lockFile = path.join(storeDir, 'server.starting');
  const lock = acquireLock(lockFile);
  if (lock === null) {
    const r = await waitForServer(port, null);
    if (r.state === 'ok') return emit(`Pipeline dashboard: ${url}`);
    return emit(r.last.state === 'foreign' ? inUse(port) : couldNotStart(logFile));
  }
  let r;
  try {
    const spawned = await startServer(serverLocation(), { logFile, pidFile, port });
    r = await waitForServer(port, spawned);
    if (r.state === 'ok') return emit(`Pipeline dashboard: ${url}`);
  } finally {
    closeSync(lock);
    rmSync(lockFile, { force: true });
  }
  emit(r.last.state === 'foreign' ? inUse(port) : couldNotStart(logFile));
}

// Runs only as the CLI entry (tests import the helpers). Let the process end on its own (no process.exit, so stdout
// is never cut short); nothing here keeps the loop alive.
const isEntry = (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isEntry) {
  main().catch(() => { /* never fail the session */ }).finally(() => { process.exitCode = 0; });
}

#!/usr/bin/env node
// Pipeline dashboard server: JSON API over the run store, SSE live updates, CI status, static UI.
// Node built-ins only. Binds 127.0.0.1. See README "Server/API".
import { readFileSync, readdirSync, realpathSync, statSync, watch as fsWatch } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCiLookup } from './lib/ci.mjs';
import { deriveTimeline } from './lib/derive.mjs';
import { projectName, readSettings, resolvePort } from './lib/settings.mjs';
import { resolveTokensFile } from './lib/tokens.mjs';
import { RUN_ID, listRuns, readRun, resolveStoreDir } from './record.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// This folder is <repo>/.claude/wavework/dashboard, so the checkout root is three levels up.
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8',
};

function readEvents(storeDir, id) {
  if (!RUN_ID.test(id)) return [];
  let text;
  try { text = readFileSync(path.join(storeDir, id, 'events.jsonl'), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* partial or corrupt line: skip */ }
  }
  return out;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

function sendText(res, status, type, text) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-cache' });
  res.end(text);
}

function sendFile(res, file) {
  let data;
  try { data = readFileSync(file); } catch { return sendJson(res, 404, { error: 'not found' }); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(data);
}

/** Maps a URL path to a file inside publicDir, or null. Rejects traversal, NULs and symlinks leaving publicDir. */
function resolvePublic(publicDir, rawPath) {
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { return { status: 400 }; }
  if (decoded.includes('\0') || decoded.includes('\\')) return { status: 400 };
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  if (rel.split('/').includes('..')) return { status: 400 };
  const base = path.resolve(publicDir);
  const candidate = path.resolve(base, rel);
  if (!candidate.startsWith(base + path.sep)) return { status: 400 };
  try {
    const realBase = realpathSync(base);
    const real = realpathSync(candidate);
    if (!real.startsWith(realBase + path.sep) || !statSync(real).isFile()) return { status: 404 };
    return { file: real };
  } catch { return { status: 404 }; }
}

function snapshot(storeDir) {
  const snap = new Map();
  let names;
  try { names = readdirSync(storeDir); } catch { return snap; }
  for (const n of names) {
    if (!RUN_ID.test(n)) continue;
    const sig = ['run.json', 'events.jsonl'].map((f) => {
      try { const s = statSync(path.join(storeDir, n, f)); return `${s.mtimeMs}:${s.size}`; } catch { return '-'; }
    }).join('|');
    snap.set(n, sig);
  }
  return snap;
}

/**
 * Calls onChange(runId) when a store file changes. fs.watch (recursive) is only the trigger; the run id comes
 * from diffing store snapshots, because filename reporting differs per platform. Falls back to polling.
 */
function watchStore(storeDir, onChange, { mode = 'auto', pollMs = 1000 } = {}) {
  let watcher = null;
  let timer = null;
  let debounce = null;
  let closed = false;
  let prev = snapshot(storeDir);
  const diff = () => {
    const next = snapshot(storeDir);
    for (const [id, sig] of next) if (prev.get(id) !== sig) onChange(id);
    prev = next;
  };
  if (mode !== 'poll') {
    try {
      watcher = fsWatch(storeDir, { recursive: true }, () => {
        clearTimeout(debounce);
        debounce = setTimeout(diff, 20);
      });
      watcher.on('error', () => { watcher?.close(); watcher = null; if (!closed) startPolling(); });
    } catch { watcher = null; }
  }
  function startPolling() {
    if (timer || closed) return;
    timer = setInterval(diff, pollMs);
    timer.unref?.();
  }
  if (!watcher) startPolling();
  return () => {
    closed = true;
    watcher?.close();
    clearTimeout(debounce);
    if (timer) clearInterval(timer);
  };
}

export function createServer({
  storeDir = resolveStoreDir(), port = resolvePort(HERE),
  publicDir = path.join(HERE, 'public'),
  // The project's own tokens CSS: a fixed absolute path, or a function returning it (or null) per request.
  tokensPath = () => resolveTokensFile(REPO_ROOT, readSettings(HERE).tokensFile),
  project = projectName(REPO_ROOT),
  ghRunner, ciRefreshMs = 15_000, watch = 'auto', pollMs = 1000,
} = {}) {
  const ci = createCiLookup({ ghRunner, refreshMs: ciRefreshMs });
  const sse = new Set();

  /** A batch still `running` whose members have all ended is reported as ended (blocked if any member is blocked/failed). */
  const withBatchStatus = (run, all) => {
    if (run.status !== 'running') return run;
    const members = all.filter((r) => r.parent === run.id);
    if (members.length === 0 || members.some((m) => m.status === 'running')) return run;
    const bad = members.some((m) => m.status === 'blocked' || m.status === 'failed');
    const ended = members.map((m) => m.ended).filter(Boolean).sort().pop() ?? null;
    return { ...run, status: bad ? 'blocked' : 'done', ended };
  };

  const summary = (run) => {
    const timeline = deriveTimeline(run, readEvents(storeDir, run.id));
    return { ...run, totals: timeline.totals };
  };

  function listSummaries() {
    const raw = listRuns(storeDir);
    const all = raw.map((r) => summary(withBatchStatus(r, raw)));
    const newest = (a, b) => (b.started ?? '').localeCompare(a.started ?? '');
    const ids = new Set(all.map((r) => r.id));
    const kids = new Map();
    const top = [];
    for (const r of all) {
      if (r.parent && ids.has(r.parent)) {
        if (!kids.has(r.parent)) kids.set(r.parent, []);
        kids.get(r.parent).push(r);
      } else top.push(r);
    }
    return top.sort(newest).map((r) => ({ ...r, children: (kids.get(r.id) ?? []).sort(newest) }));
  }

  async function runDetail(id) {
    const stored = readRun(storeDir, id);
    if (!stored) return null;
    const run = withBatchStatus(stored, listRuns(storeDir));
    const events = readEvents(storeDir, id);
    const timeline = deriveTimeline(run, events);
    return { run, events, timeline, ci: timeline.sha ? await ci.lookup(timeline.sha) : null };
  }

  async function handle(req, res) {
    const host = req.headers.host ?? '';
    const p = server.address()?.port;
    if (host !== `127.0.0.1:${p}` && host !== `localhost:${p}`) return sendJson(res, 403, { error: 'forbidden host' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
    // Raw path on purpose: new URL() would normalize %2e%2e/.. segments before we can reject them.
    const rawPath = (req.url ?? '/').split('?')[0].split('#')[0];

    // root: the checkout this server runs from, so the SessionStart hook can replace a server whose worktree was deleted.
    if (rawPath === '/api/health') return sendJson(res, 200, { ok: true, root: HERE });
    // project: the repo directory name, shown in the UI title.
    if (rawPath === '/api/info') return sendJson(res, 200, { project });
    if (rawPath === '/api/runs') return sendJson(res, 200, listSummaries());
    if (rawPath === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      sse.add(res);
      res.on('close', () => sse.delete(res));
      return undefined;
    }
    if (rawPath.startsWith('/api/runs/')) {
      let id;
      try { id = decodeURIComponent(rawPath.slice('/api/runs/'.length)); } catch { return sendJson(res, 400, { error: 'invalid run id' }); }
      if (!RUN_ID.test(id)) return sendJson(res, 400, { error: 'invalid run id' });
      const detail = await runDetail(id);
      return detail ? sendJson(res, 200, detail) : sendJson(res, 404, { error: 'run not found' });
    }
    if (rawPath.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });
    if (rawPath === '/tokens.css') {
      // Optional project theme, loaded after the default theme. Nothing configured: an empty stylesheet.
      const file = typeof tokensPath === 'function' ? tokensPath() : tokensPath;
      if (!file) return sendText(res, 200, 'text/css; charset=utf-8', '/* no project tokens configured */\n');
      return sendFile(res, file);
    }
    const r = resolvePublic(publicDir, rawPath);
    if (r.file) return sendFile(res, r.file);
    return sendJson(res, r.status, { error: r.status === 400 ? 'bad request' : 'not found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => { if (!res.headersSent) sendJson(res, 500, { error: 'internal error' }); else res.end(); });
  });
  let stopWatch = null;
  let keepAlive = null;

  return {
    get port() { return server.address()?.port; },
    address: () => server.address(),
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          stopWatch = watchStore(storeDir, (id) => {
            for (const res of sse) res.write(`event: run-changed\ndata: ${JSON.stringify({ id })}\n\n`);
          }, { mode: watch, pollMs });
          keepAlive = setInterval(() => { for (const res of sse) res.write(': ping\n\n'); }, 25_000);
          keepAlive.unref();
          resolve(server.address());
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        stopWatch?.();
        clearInterval(keepAlive);
        for (const res of sse) res.end();
        sse.clear();
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const s = createServer();
  s.listen().then(() => {
    console.log(`pipeline dashboard: http://127.0.0.1:${s.port}`);
  }).catch((e) => { console.error(`pipeline dashboard: ${e.message}`); process.exitCode = 1; });
}

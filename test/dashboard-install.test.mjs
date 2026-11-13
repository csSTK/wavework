// The dashboard as part of init/update: files, hooks, enabling and disabling, and a repo that is not Shipir.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { basename, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CONFIG, cleanup, cli, put, readJson, snapshot, tempDir, writeConfig } from './helpers/repo.mjs';

const BIN = fileURLToPath(new URL('../bin/wavework.mjs', import.meta.url));
const DASH = '.claude/wavework/dashboard';
const SESSION_CMD = 'node "$CLAUDE_PROJECT_DIR/.claude/wavework/dashboard/hooks/session-start.mjs"';
const STOP_CMD = 'node "$CLAUDE_PROJECT_DIR/.claude/wavework/dashboard/hooks/subagent-stop.mjs"';

/** A git repo in a directory with the given name (so the repo name is not "wavework-xxxx"). */
function namedRepo(name, config) {
  const parent = tempDir();
  const repo = join(parent, name);
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeConfig(repo, config);
  tracked.add(repo);
  trackedNames.add(basename(parent));
  return { parent, repo };
}

/** Repos created here; the check below makes sure no dashboard server of theirs outlives the file. */
const tracked = new Set();
const trackedNames = new Set(); // random temp dir names: macOS reports realpath'd paths in `ps`
const killRecorded = (repo) => {
  try { process.kill(JSON.parse(readFileSync(join(repo, '.git/pipeline-runs/server.pid'), 'utf8')).pid); } catch { /* none recorded or gone */ }
};
after(async () => {
  for (const repo of tracked) killRecorded(repo);
  await new Promise((r) => setTimeout(r, 200));
  const ps = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' });
  const leaked = [...trackedNames].filter((name) => ps.split('\n').some((l) => l.includes(name) && l.includes('server.mjs')));
  assert.deepEqual(leaked, [], 'dashboard servers still running after the tests');
});

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const commandsOf = (settings, event) => (settings.hooks?.[event] ?? []).flatMap((e) => e.hooks.map((h) => h.command));
const filesUnder = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }) : []);

async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}
const getJson = async (port, path) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
};

test('init (dashboard on by default): runtime copied, hooks registered, lock lists both', async () => {
  const { parent, repo } = namedRepo('acme-shop', CONFIG);
  try {
    const r = await cli(['init'], repo);
    assert.equal(r.code, 0, r.stderr);
    for (const f of ['record.mjs', 'server.mjs', 'pricing.json', 'config.json', 'hooks/session-start.mjs', 'hooks/subagent-stop.mjs', 'public/default-theme.css']) {
      assert.ok(existsSync(join(repo, DASH, f)), f);
    }
    assert.deepEqual(readJson(repo, `${DASH}/config.json`), { port: 4690, tokensFile: null });
    const settings = readJson(repo, '.claude/settings.json');
    assert.deepEqual(commandsOf(settings, 'SessionStart'), [SESSION_CMD]);
    assert.deepEqual(commandsOf(settings, 'SubagentStop'), [STOP_CMD]);
    const lock = readJson(repo, '.claude/wavework.lock.json');
    assert.ok(Object.keys(lock.files).includes('wavework/dashboard/record.mjs'));
    assert.equal(lock.hooks.length, 2);
    // Record lines in the skills point at the installed recorder
    assert.match(readFileSync(join(repo, '.claude/skills/next-task-test/SKILL.md'), 'utf8'), /node \.claude\/wavework\/dashboard\/record\.mjs tests/);
  } finally { cleanup(parent); }
});

test('init with dashboard.enabled false: no runtime, no hooks, no Record lines', async () => {
  const { parent, repo } = namedRepo('quiet', { ...CONFIG, dashboard: { enabled: false } });
  try {
    assert.equal((await cli(['init'], repo)).code, 0);
    assert.equal(existsSync(join(repo, '.claude/wavework')), false);
    assert.equal(existsSync(join(repo, '.claude/settings.json')), false);
    assert.doesNotMatch(readFileSync(join(repo, '.claude/skills/next-task-test/SKILL.md'), 'utf8'), /record\.mjs/);
  } finally { cleanup(parent); }
});

test('enabled -> disabled -> update removes the hooks and the unedited runtime files, keeps foreign settings', async () => {
  const { parent, repo } = namedRepo('toggle', CONFIG);
  try {
    put(repo, '.claude/settings.json', JSON.stringify({ model: 'x', hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'bd prime' }] }] } }));
    assert.equal((await cli(['init'], repo)).code, 0);
    assert.deepEqual(commandsOf(readJson(repo, '.claude/settings.json'), 'SessionStart'), ['bd prime', SESSION_CMD]);

    writeConfig(repo, { ...CONFIG, dashboard: { enabled: false } });
    const r = await cli(['update'], repo);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const settings = readJson(repo, '.claude/settings.json');
    assert.equal(settings.model, 'x');
    assert.deepEqual(commandsOf(settings, 'SessionStart'), ['bd prime']);
    assert.deepEqual(settings.hooks.SubagentStop, undefined);
    assert.equal(existsSync(join(repo, '.claude/wavework')), false, 'runtime and its empty dirs are gone');
    const lock = readJson(repo, '.claude/wavework.lock.json');
    assert.deepEqual(Object.keys(lock.files).filter((f) => f.startsWith('wavework/')), []);
    assert.deepEqual(lock.hooks, []);
    assert.doesNotMatch(readFileSync(join(repo, '.claude/skills/next-task-test/SKILL.md'), 'utf8'), /record\.mjs/);
  } finally { cleanup(parent); }
});

test('disabling keeps a locally edited runtime file and reports it (exit 2)', async () => {
  const { parent, repo } = namedRepo('edited', CONFIG);
  try {
    assert.equal((await cli(['init'], repo)).code, 0);
    writeFileSync(join(repo, DASH, 'pricing.json'), '{"mine":true}\n');
    writeConfig(repo, { ...CONFIG, dashboard: { enabled: false } });
    const r = await cli(['update'], repo);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /review\s+wavework\/dashboard\/pricing\.json: removed upstream but edited locally, kept/);
    assert.equal(readFileSync(join(repo, DASH, 'pricing.json'), 'utf8'), '{"mine":true}\n');
    assert.equal(existsSync(join(repo, DASH, 'server.mjs')), false);
    assert.deepEqual(commandsOf(readJson(repo, '.claude/settings.json'), 'SessionStart'), []);
  } finally { cleanup(parent); }
});

test('disabled -> enabled -> update adds the runtime and the hooks', async () => {
  const { parent, repo } = namedRepo('later', { ...CONFIG, dashboard: { enabled: false } });
  try {
    assert.equal((await cli(['init'], repo)).code, 0);
    writeConfig(repo, CONFIG);
    const r = await cli(['update'], repo);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(repo, DASH, 'server.mjs')));
    assert.deepEqual(commandsOf(readJson(repo, '.claude/settings.json'), 'SessionStart'), [SESSION_CMD]);
    assert.match(readFileSync(join(repo, '.claude/skills/next-task-test/SKILL.md'), 'utf8'), /record\.mjs/);
    assert.equal(readJson(repo, '.claude/wavework.lock.json').hooks.length, 2);
  } finally { cleanup(parent); }
});

test('changing the port or tokensFile in the config updates config.json on the next update; a second update is a no-op', async () => {
  const { parent, repo } = namedRepo('ports', CONFIG);
  try {
    assert.equal((await cli(['init'], repo)).code, 0);
    writeConfig(repo, { ...CONFIG, dashboard: { port: 5099, tokensFile: 'ui/tokens.css' } });
    assert.equal((await cli(['update'], repo)).code, 0);
    assert.deepEqual(readJson(repo, `${DASH}/config.json`), { port: 5099, tokensFile: 'ui/tokens.css' });
    const before = snapshot(repo);
    const again = await cli(['update'], repo);
    assert.equal(again.code, 0);
    assert.deepEqual(snapshot(repo), before);
  } finally { cleanup(parent); }
});

test('a symlinked .claude/wavework is refused (nothing is written through it)', async () => {
  const { parent, repo } = namedRepo('linked', CONFIG);
  const outside = tempDir();
  try {
    mkdirSync(join(repo, '.claude'), { recursive: true });
    execFileSync('ln', ['-s', outside, join(repo, '.claude/wavework')]);
    const r = await cli(['init'], repo);
    assert.equal(r.code, 1);
    assert.deepEqual(readdirSync(outside), []);
  } finally { cleanup(parent, outside); }
});

test('not Shipir: init -> hooks -> record a run -> server returns it (other repo name, other port, no tokensFile)', async () => {
  const port = await freePort();
  const { parent, repo } = namedRepo('acme-shop', { ...CONFIG, dashboard: { port } });
  let server;
  try {
    assert.equal((await cli(['init'], repo)).code, 0);
    const settings = readJson(repo, '.claude/settings.json');
    assert.deepEqual(commandsOf(settings, 'SessionStart'), [SESSION_CMD]);
    assert.deepEqual(commandsOf(settings, 'SubagentStop'), [STOP_CMD]);

    // Record from a worktree-like cwd that has no node_modules: the runtime needs nothing but node.
    const recorder = join(repo, DASH, 'record.mjs');
    const env = { ...process.env };
    delete env.WAVEWORK_PIPELINE_STORE;
    const rec = (...args) => execFileSync(process.execPath, [recorder, ...args], { cwd: repo, env, encoding: 'utf8' });
    rec('run-start', '--run', 'epic.acme-1', '--kind', 'next-task', '--units', 'acme-1', '--branch', 'epic/acme-1', '--worktree', repo);
    rec('step-start', '--step', 'plan');
    rec('child-start', '--bead', 'acme-1.1', '--model', 'sonnet', '--wave', '1');
    rec('run-end', '--status', 'done');
    // the store lives in the git common dir, shared by all worktrees
    assert.ok(existsSync(join(repo, '.git', 'pipeline-runs', 'epic.acme-1', 'events.jsonl')));

    // The SessionStart hook (as Claude Code runs it) starts the server on the configured port.
    const hookEnv = { ...env, CLAUDE_PROJECT_DIR: repo };
    const hook = join(repo, DASH, 'hooks', 'session-start.mjs');
    const out = execFileSync(process.execPath, [hook], { cwd: repo, env: hookEnv, encoding: 'utf8', input: '{}' });
    assert.equal(JSON.parse(out).systemMessage, `Pipeline dashboard: http://127.0.0.1:${port}`);
    server = readJson(repo, '.git/pipeline-runs/server.pid');
    assert.equal(server.port, port);

    const runs = await until(() => getJson(port, '/api/runs'));
    assert.deepEqual(runs.map((r) => [r.id, r.status, r.units]), [['epic.acme-1', 'done', ['acme-1']]]);
    const detail = await getJson(port, '/api/runs/epic.acme-1');
    assert.equal(detail.timeline.children[0].bead, 'acme-1.1');
    assert.deepEqual(await getJson(port, '/api/info'), { project: 'acme-shop' });
    const tokens = await (await fetch(`http://127.0.0.1:${port}/tokens.css`)).text();
    assert.doesNotMatch(tokens, /--color/);
    const theme = await (await fetch(`http://127.0.0.1:${port}/default-theme.css`)).text();
    assert.match(theme, /--color-bg/);
    assert.doesNotMatch(readFileSync(join(repo, DASH, 'public/app.js'), 'utf8') + theme, /shipir/i);
  } finally {
    killRecorded(repo); // also when an assertion failed before `server` was read
    cleanup(parent);
  }
});

test('tokensFile: the configured CSS is served after the default theme; a file outside the repo is never served', async () => {
  const port = await freePort();
  const { parent, repo } = namedRepo('themed', { ...CONFIG, dashboard: { port, tokensFile: 'ui/tokens.css' } });
  const outside = tempDir();
  let child;
  try {
    put(repo, 'ui/tokens.css', ':root{--color-bg:#123456}\n');
    assert.equal((await cli(['init'], repo)).code, 0);
    child = spawn(process.execPath, [BIN, 'dashboard'], { cwd: repo, stdio: 'ignore' });
    assert.ok(await until(() => getJson(port, '/api/health')), 'server did not come up');
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/tokens.css`)).text(), ':root{--color-bg:#123456}\n');

    // replace the file by a symlink to a file outside the repo: refused, falls back to the empty stylesheet
    writeFileSync(join(outside, 'secret.css'), 'secret');
    rmSync(join(repo, 'ui/tokens.css'));
    execFileSync('ln', ['-s', join(outside, 'secret.css'), join(repo, 'ui/tokens.css')]);
    const body = await (await fetch(`http://127.0.0.1:${port}/tokens.css`)).text();
    assert.doesNotMatch(body, /secret/);
  } finally {
    if (child) {
      const exited = new Promise((r) => child.once('exit', r));
      child.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    }
    cleanup(parent, outside);
  }
});

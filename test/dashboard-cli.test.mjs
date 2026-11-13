import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { CONFIG, cleanup, cli, makeRepo, put, writeConfig } from './helpers/repo.mjs';

/** A fake spawn: records the call, the "process" exits with `code` on the next tick. */
function fakeSpawn(code = 0) {
  const calls = [];
  const spawn = (file, args, options) => {
    calls.push({ file, args, options });
    const child = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => child.emit('exit', code, null));
    return child;
  };
  return { calls, spawn };
}

function installedRepo(config = CONFIG) {
  const repo = makeRepo();
  writeConfig(repo, config);
  put(repo, '.claude/wavework/dashboard/server.mjs', '// server\n');
  return repo;
}

test('usage lists the dashboard command', async () => {
  const r = await cli(['--help'], makeRepo());
  assert.match(r.stdout, /dashboard\s+Start the pipeline dashboard/);
  assert.doesNotMatch(r.stdout, /not yet implemented/);
});

test('dashboard starts the repo\'s installed server with node, in the repo, on the configured port', async () => {
  const repo = installedRepo({ ...CONFIG, dashboard: { port: 5321 } });
  const f = fakeSpawn(0);
  try {
    const r = await cli(['dashboard'], repo, { spawn: f.spawn, env: {} });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].file, process.execPath);
    assert.deepEqual(f.calls[0].args, [join(realpathSync(repo), '.claude/wavework/dashboard/server.mjs')]);
    assert.equal(f.calls[0].options.cwd, realpathSync(repo));
    assert.equal(f.calls[0].options.env.PIPELINE_DASHBOARD_PORT, '5321');
    assert.equal(f.calls[0].options.stdio, 'inherit');
  } finally { cleanup(repo); }
});

test('an explicit PIPELINE_DASHBOARD_PORT wins over the config', async () => {
  const repo = installedRepo();
  const f = fakeSpawn(0);
  try {
    await cli(['dashboard'], repo, { spawn: f.spawn, env: { PIPELINE_DASHBOARD_PORT: '6001' } });
    assert.equal(f.calls[0].options.env.PIPELINE_DASHBOARD_PORT, '6001');
  } finally { cleanup(repo); }
});

test('the exit code of the server is the exit code of the command', async () => {
  const repo = installedRepo();
  try {
    assert.equal((await cli(['dashboard'], repo, { spawn: fakeSpawn(3).spawn, env: {} })).code, 3);
  } finally { cleanup(repo); }
});

test('disabled dashboard: clear error, nothing spawned', async () => {
  const repo = installedRepo({ ...CONFIG, dashboard: { enabled: false } });
  const f = fakeSpawn();
  try {
    const r = await cli(['dashboard'], repo, { spawn: f.spawn, env: {} });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /dashboard is disabled.*dashboard\.enabled.*\.claude\/wavework\.json/);
    assert.equal(f.calls.length, 0);
  } finally { cleanup(repo); }
});

test('not installed: points to wavework update, nothing spawned', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  const f = fakeSpawn();
  try {
    const r = await cli(['dashboard'], repo, { spawn: f.spawn, env: {} });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not installed.*wavework update/);
    assert.equal(f.calls.length, 0);
  } finally { cleanup(repo); }
});

test('no wavework config: error names the missing file; options are rejected', async () => {
  const repo = makeRepo();
  try {
    const r = await cli(['dashboard'], repo, { spawn: fakeSpawn().spawn });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /wavework config not found/);
    const bad = await cli(['dashboard', '--nope'], repo);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /unknown option/);
  } finally { cleanup(repo); }
});

test('a symlinked server.mjs is refused (the installed copy must be a regular file inside .claude)', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  const elsewhere = makeRepo({ 'x.mjs': '//' });
  try {
    mkdirSync(join(repo, '.claude/wavework/dashboard'), { recursive: true });
    writeFileSync(join(elsewhere, 'real.mjs'), '//');
    const { symlinkSync } = await import('node:fs');
    symlinkSync(join(elsewhere, 'real.mjs'), join(repo, '.claude/wavework/dashboard/server.mjs'));
    const f = fakeSpawn();
    const r = await cli(['dashboard'], repo, { spawn: f.spawn, env: {} });
    assert.equal(r.code, 1);
    assert.equal(f.calls.length, 0);
  } finally { cleanup(repo, elsewhere); }
});

test('dashboard from a subdirectory and from a linked worktree runs that checkout\'s own server', async () => {
  const repo = installedRepo();
  const parent = join(repo, '..', `${repo.split('/').pop()}-wt`);
  try {
    mkdirSync(join(repo, 'a/b'), { recursive: true });
    put(repo, 'a/b/.keep', '');
    const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: repo, stdio: 'ignore' });
    git('add', '-A', '-f', '.');
    git('commit', '-q', '-m', 'x');
    git('worktree', 'add', '-q', '-b', 'wt', parent);
    mkdirSync(join(parent, 'a/b'), { recursive: true });
    const main = realpathSync(repo);
    const wt = realpathSync(parent);
    for (const [from, root] of [[join(repo, 'a/b'), main], [parent, wt], [join(parent, 'a/b'), wt]]) {
      const f = fakeSpawn(0);
      const r = await cli(['dashboard'], from, { spawn: f.spawn, env: {} });
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(f.calls[0].args, [join(root, '.claude/wavework/dashboard/server.mjs')]);
      assert.equal(f.calls[0].options.cwd, root);
    }
  } finally { cleanup(repo, parent); }
});

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
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
    assert.deepEqual(f.calls[0].args, [join(repo, '.claude/wavework/dashboard/server.mjs')]);
    assert.equal(f.calls[0].options.cwd, repo);
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

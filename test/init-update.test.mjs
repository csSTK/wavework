import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync, statSync, lstatSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  CONFIG, makeRepo, writeConfig, put, cleanup, cli, defaultFixture, makeFixture, withFixture, snapshot, readJson, tempDir,
} from './helpers/repo.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const A = 'skills/a/SKILL.md';

/** Repo with config, fixture and a completed init. */
async function setup() {
  const repo = makeRepo();
  writeConfig(repo);
  const fx = defaultFixture();
  const res = await cli(['init'], repo, withFixture(fx));
  assert.equal(res.code, 0, res.stderr);
  const run = (argv, extra) => cli(argv, repo, withFixture(fx, extra));
  return { repo, fx, run, read: (rel) => readFileSync(join(repo, '.claude', rel), 'utf8'), done: () => cleanup(repo, fx.dir) };
}

// ---------- init ----------

test('init renders every target, writes the lock with sha256 per file, exits 0', async () => {
  const s = await setup();
  try {
    assert.equal(s.read(A), 'A on main\n');
    assert.equal(s.read('skills/b/SKILL.md'), 'B\n');
    assert.equal(statSync(join(s.repo, '.claude/scripts/run.sh')).mode & 0o777, 0o755);
    const lock = readJson(s.repo, '.claude/wavework.lock.json');
    assert.equal(lock.version, pkg.version);
    assert.deepEqual(lock.files, {
      [A]: sha('A on main\n'),
      'skills/b/SKILL.md': sha('B\n'),
      'scripts/run.sh': sha('#!/bin/sh\necho hi\n'),
    });
    assert.deepEqual(lock.hooks, []);
  } finally { s.done(); }
});

test('init twice is refused, points to update, changes nothing', async () => {
  const s = await setup();
  try {
    const before = snapshot(s.repo);
    const r = await s.run(['init']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /wavework update/);
    assert.deepEqual(snapshot(s.repo), before);
  } finally { s.done(); }
});

test('init --config copies a valid config file to .claude/wavework.json', async () => {
  const repo = makeRepo();
  const fx = defaultFixture();
  const src = join(tempDir(), 'my.json');
  writeFileSync(src, JSON.stringify({ ...CONFIG, baseBranch: 'develop' }));
  try {
    const r = await cli(['init', '--config', src], repo, withFixture(fx));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(readJson(repo, '.claude/wavework.json').baseBranch, 'develop');
    assert.equal(readFileSync(join(repo, A.replace(/^/, '.claude/')), 'utf8'), 'A on develop\n');
  } finally { cleanup(repo, fx.dir); }
});

test('init --config with an invalid config writes nothing and names the problem', async () => {
  const repo = makeRepo();
  const fx = defaultFixture();
  const src = join(tempDir(), 'bad.json');
  writeFileSync(src, JSON.stringify({ baseBranch: 'main' }));
  try {
    const before = snapshot(repo);
    const r = await cli(['init', '--config', src], repo, withFixture(fx));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /checks: required/);
    assert.deepEqual(snapshot(repo), before);
  } finally { cleanup(repo, fx.dir); }
});

test('init with --config and an existing .claude/wavework.json is refused', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  const fx = defaultFixture();
  const src = join(tempDir(), 'my.json');
  writeFileSync(src, JSON.stringify(CONFIG));
  try {
    const r = await cli(['init', '--config', src], repo, withFixture(fx));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /already exists/);
  } finally { cleanup(repo, fx.dir); }
});

test('init without config and without origin/HEAD fails clearly and writes nothing', async () => {
  const repo = makeRepo();
  const fx = defaultFixture();
  try {
    const before = snapshot(repo);
    const r = await cli(['init'], repo, withFixture(fx));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /baseBranch/);
    assert.match(r.stderr, /--config/);
    assert.deepEqual(snapshot(repo), before);
  } finally { cleanup(repo, fx.dir); }
});

test('init without config detects baseBranch from origin/HEAD and writes a starter config', async () => {
  const repo = makeRepo();
  const fx = defaultFixture();
  try {
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x']);
    execFileSync('git', ['-C', repo, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD']);
    execFileSync('git', ['-C', repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']);
    const r = await cli(['init'], repo, withFixture(fx));
    assert.equal(r.code, 0, r.stderr);
    const cfg = readJson(repo, '.claude/wavework.json');
    assert.equal(cfg.baseBranch, 'trunk');
    assert.match(r.stdout, /checks/i);
  } finally { cleanup(repo, fx.dir); }
});

test('init outside a git repository is refused', async () => {
  const dir = tempDir();
  const fx = defaultFixture();
  try {
    writeConfig(dir);
    const r = await cli(['init'], dir, withFixture(fx));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not inside a git repository/);
  } finally { cleanup(dir, fx.dir); }
});

test('init --dry-run writes nothing at all and prints the plan', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  const fx = defaultFixture();
  try {
    const before = snapshot(repo);
    const r = await cli(['init', '--dry-run'], repo, withFixture(fx));
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /dry-run/i);
    assert.match(r.stdout, /skills\/a\/SKILL\.md/);
    assert.deepEqual(snapshot(repo), before);
  } finally { cleanup(repo, fx.dir); }
});

test('init does not overwrite a pre-existing different file: keeps it, writes .wavework-new, exits 2', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  put(repo, `.claude/${A}`, 'mine\n');
  const fx = defaultFixture();
  try {
    const r = await cli(['init'], repo, withFixture(fx));
    assert.equal(r.code, 2, r.stderr);
    assert.equal(readFileSync(join(repo, '.claude', A), 'utf8'), 'mine\n');
    assert.equal(readFileSync(join(repo, '.claude', `${A}.wavework-new`), 'utf8'), 'A on main\n');
    assert.equal(readJson(repo, '.claude/wavework.lock.json').files[A], undefined);
  } finally { cleanup(repo, fx.dir); }
});

test('init failure on one bad target writes nothing (plan is validated first)', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  const fx = defaultFixture();
  fx.targets.push({ template: 'a.md', target: '.claude/../../escape.md' });
  try {
    const before = snapshot(repo);
    const r = await cli(['init'], repo, withFixture(fx));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unsafe path/);
    assert.deepEqual(snapshot(repo), before);
  } finally { cleanup(repo, fx.dir); }
});

// ---------- settings.json merge via init/update ----------

const HOOK = { matcher: 'Bash', hooks: [{ type: 'command', command: 'wavework-x' }] };
const FOREIGN = { matcher: 'Bash', hooks: [{ type: 'command', command: 'theirs' }] };

test('init merges hook definitions into settings.json, keeps foreign hooks and unknown keys, records ownership', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  put(repo, '.claude/settings.json', JSON.stringify({ model: 'opus', hooks: { PreToolUse: [FOREIGN] } }));
  const fx = defaultFixture();
  try {
    const r = await cli(['init'], repo, withFixture(fx, { hooks: { hooks: { PreToolUse: [HOOK] } } }));
    assert.equal(r.code, 0, r.stderr);
    const s = readJson(repo, '.claude/settings.json');
    assert.equal(s.model, 'opus');
    assert.deepEqual(s.hooks.PreToolUse, [FOREIGN, HOOK]);
    assert.deepEqual(readJson(repo, '.claude/wavework.lock.json').hooks, [{ event: 'PreToolUse', entry: HOOK }]);
  } finally { cleanup(repo, fx.dir); }
});

test('update is idempotent for hooks and removes only owned hooks no longer defined', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  put(repo, '.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [FOREIGN] } }));
  const fx = defaultFixture();
  try {
    const defs = { hooks: { PreToolUse: [HOOK] } };
    await cli(['init'], repo, withFixture(fx, { hooks: defs }));
    const after1 = readFileSync(join(repo, '.claude/settings.json'), 'utf8');
    const r = await cli(['update'], repo, withFixture(fx, { hooks: defs }));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(readFileSync(join(repo, '.claude/settings.json'), 'utf8'), after1);
    const r2 = await cli(['update'], repo, withFixture(fx, { hooks: { hooks: {} } }));
    assert.equal(r2.code, 0, r2.stderr);
    assert.deepEqual(readJson(repo, '.claude/settings.json'), { hooks: { PreToolUse: [FOREIGN] } });
    assert.deepEqual(readJson(repo, '.claude/wavework.lock.json').hooks, []);
  } finally { cleanup(repo, fx.dir); }
});

test('invalid settings.json aborts with exit 1 and changes nothing', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  put(repo, '.claude/settings.json', '{ not json');
  const fx = defaultFixture();
  try {
    const before = snapshot(repo);
    const r = await cli(['init'], repo, withFixture(fx, { hooks: { hooks: { Stop: [HOOK] } } }));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /settings\.json/);
    assert.deepEqual(snapshot(repo), before);
  } finally { cleanup(repo, fx.dir); }
});

test('no hook definitions: settings.json is not created', async () => {
  const s = await setup();
  try {
    assert.equal(existsSync(join(s.repo, '.claude/settings.json')), false);
  } finally { s.done(); }
});

// ---------- update ----------

test('update with nothing changed: exit 0, no writes to files', async () => {
  const s = await setup();
  try {
    const before = snapshot(join(s.repo, '.claude'));
    const r = await s.run(['update']);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(snapshot(join(s.repo, '.claude')), before);
  } finally { s.done(); }
});

test('update overwrites an unedited file whose template changed and refreshes the lock hash', async () => {
  const s = await setup();
  try {
    s.fx.set('a.md', 'A v2 on {{baseBranch}}\n');
    const r = await s.run(['update']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(s.read(A), 'A v2 on main\n');
    assert.equal(readJson(s.repo, '.claude/wavework.lock.json').files[A], sha('A v2 on main\n'));
    assert.equal(existsSync(join(s.repo, '.claude', `${A}.wavework-new`)), false);
  } finally { s.done(); }
});

test('update keeps a locally edited file, writes .wavework-new, reports it, exits 2, keeps the old lock hash', async () => {
  const s = await setup();
  try {
    writeFileSync(join(s.repo, '.claude', A), 'my edit\n');
    s.fx.set('a.md', 'A v2 on {{baseBranch}}\n');
    const r = await s.run(['update']);
    assert.equal(r.code, 2);
    assert.equal(s.read(A), 'my edit\n');
    assert.equal(s.read(`${A}.wavework-new`), 'A v2 on main\n');
    assert.match(r.stdout, /skills\/a\/SKILL\.md/);
    assert.equal(readJson(s.repo, '.claude/wavework.lock.json').files[A], sha('A on main\n'));
    // still reported on the next update until resolved
    const again = await s.run(['update']);
    assert.equal(again.code, 2);
  } finally { s.done(); }
});

test('update: edited locally but template unchanged upstream is kept silently (exit 0, no .wavework-new)', async () => {
  const s = await setup();
  try {
    writeFileSync(join(s.repo, '.claude', A), 'my edit\n');
    const r = await s.run(['update']);
    assert.equal(r.code, 0);
    assert.equal(s.read(A), 'my edit\n');
    assert.equal(existsSync(join(s.repo, '.claude', `${A}.wavework-new`)), false);
    assert.equal(readJson(s.repo, '.claude/wavework.lock.json').files[A], sha('A on main\n'));
  } finally { s.done(); }
});

test('update: file edited to exactly the new upstream content is adopted (lock refreshed, exit 0)', async () => {
  const s = await setup();
  try {
    writeFileSync(join(s.repo, '.claude', A), 'A v2 on main\n');
    s.fx.set('a.md', 'A v2 on {{baseBranch}}\n');
    const r = await s.run(['update']);
    assert.equal(r.code, 0);
    assert.equal(readJson(s.repo, '.claude/wavework.lock.json').files[A], sha('A v2 on main\n'));
  } finally { s.done(); }
});

test('update deletes a file removed upstream when unedited, and prunes empty directories', async () => {
  const s = await setup();
  try {
    s.fx.targets = s.fx.targets.filter((t) => t.target !== '.claude/skills/b/SKILL.md');
    const r = await s.run(['update']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(existsSync(join(s.repo, '.claude/skills/b')), false);
    assert.equal(existsSync(join(s.repo, '.claude/skills/a')), true);
    assert.equal(readJson(s.repo, '.claude/wavework.lock.json').files['skills/b/SKILL.md'], undefined);
  } finally { s.done(); }
});

test('update keeps a file removed upstream when edited locally, reports it, exits 2, keeps lock entry', async () => {
  const s = await setup();
  try {
    writeFileSync(join(s.repo, '.claude/skills/b/SKILL.md'), 'edited\n');
    s.fx.targets = s.fx.targets.filter((t) => t.target !== '.claude/skills/b/SKILL.md');
    const r = await s.run(['update']);
    assert.equal(r.code, 2);
    assert.equal(s.read('skills/b/SKILL.md'), 'edited\n');
    assert.match(r.stdout, /skills\/b\/SKILL\.md/);
    assert.equal(readJson(s.repo, '.claude/wavework.lock.json').files['skills/b/SKILL.md'], sha('B\n'));
  } finally { s.done(); }
});

test('update drops the lock entry of a file removed upstream and already deleted locally', async () => {
  const s = await setup();
  try {
    rmSync(join(s.repo, '.claude/skills/b/SKILL.md'));
    s.fx.targets = s.fx.targets.filter((t) => t.target !== '.claude/skills/b/SKILL.md');
    const r = await s.run(['update']);
    assert.equal(r.code, 0);
    assert.equal(readJson(s.repo, '.claude/wavework.lock.json').files['skills/b/SKILL.md'], undefined);
  } finally { s.done(); }
});

test('update writes a new upstream file', async () => {
  const s = await setup();
  try {
    s.fx.set('c.md', 'C\n');
    s.fx.targets.push({ template: 'c.md', target: '.claude/skills/c/SKILL.md' });
    const r = await s.run(['update']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(s.read('skills/c/SKILL.md'), 'C\n');
    assert.equal(readJson(s.repo, '.claude/wavework.lock.json').files['skills/c/SKILL.md'], sha('C\n'));
  } finally { s.done(); }
});

test('update: new upstream file where an untracked, different file already exists is kept + .wavework-new, exit 2', async () => {
  const s = await setup();
  try {
    put(s.repo, '.claude/skills/c/SKILL.md', 'user file\n');
    s.fx.set('c.md', 'C\n');
    s.fx.targets.push({ template: 'c.md', target: '.claude/skills/c/SKILL.md' });
    const r = await s.run(['update']);
    assert.equal(r.code, 2);
    assert.equal(s.read('skills/c/SKILL.md'), 'user file\n');
    assert.equal(s.read('skills/c/SKILL.md.wavework-new'), 'C\n');
  } finally { s.done(); }
});

test('update recreates a file that is in the lock but missing on disk', async () => {
  const s = await setup();
  try {
    rmSync(join(s.repo, '.claude', A));
    const r = await s.run(['update']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(s.read(A), 'A on main\n');
    assert.match(r.stdout, /restore/i);
  } finally { s.done(); }
});

test('update re-renders with changed config values (baseBranch) and restores the mode', async () => {
  const s = await setup();
  try {
    writeConfig(s.repo, { ...CONFIG, baseBranch: 'develop' });
    const r = await s.run(['update']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(s.read(A), 'A on develop\n');
  } finally { s.done(); }
});

test('update never modifies .claude/wavework.json', async () => {
  const s = await setup();
  try {
    const file = join(s.repo, '.claude/wavework.json');
    const before = readFileSync(file);
    const mtime = lstatSync(file).mtimeMs;
    s.fx.set('a.md', 'A v2 on {{baseBranch}}\n');
    await s.run(['update']);
    assert.deepEqual(readFileSync(file), before);
    assert.equal(lstatSync(file).mtimeMs, mtime);
  } finally { s.done(); }
});

test('update without a lock file fails and points to init', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  const fx = defaultFixture();
  try {
    const r = await cli(['update'], repo, withFixture(fx));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /wavework init/);
  } finally { cleanup(repo, fx.dir); }
});

test('update with an invalid config fails with exit 1 and changes nothing', async () => {
  const s = await setup();
  try {
    put(s.repo, '.claude/wavework.json', '{"baseBranch": 5}');
    const before = snapshot(s.repo);
    const r = await s.run(['update']);
    assert.equal(r.code, 1);
    assert.deepEqual(snapshot(s.repo), before);
  } finally { s.done(); }
});

test('update --dry-run prints the plan and leaves the file tree byte-identical', async () => {
  const s = await setup();
  try {
    writeFileSync(join(s.repo, '.claude/skills/b/SKILL.md'), 'edited\n');
    s.fx.set('a.md', 'A v2 on {{baseBranch}}\n');
    s.fx.set('c.md', 'C\n');
    s.fx.targets.push({ template: 'c.md', target: '.claude/skills/c/SKILL.md' });
    s.fx.targets = s.fx.targets.filter((t) => t.target !== '.claude/scripts/run.sh');
    s.fx.set('dir/b.md', 'B v2\n');
    const before = snapshot(s.repo);
    const r = await s.run(['update', '--dry-run']);
    assert.match(r.stdout, /dry-run/i);
    assert.match(r.stdout, /skills\/c\/SKILL\.md/);
    assert.equal(r.code, 2);
    assert.deepEqual(snapshot(s.repo), before);
  } finally { s.done(); }
});

// ---------- path safety ----------

test('a target that escapes via ../ or is absolute is refused on init and nothing is written outside', async () => {
  for (const target of ['.claude/../escape.md', '/tmp/wavework-abs-escape.md', '.claude/a/../../escape.md', '.claude//x.md', 'escape.md', '../escape.md', '.claude/C:/x']) {
    const repo = makeRepo();
    writeConfig(repo);
    const fx = defaultFixture();
    fx.targets = [{ template: 'a.md', target }];
    try {
      const before = snapshot(repo);
      const r = await cli(['init'], repo, withFixture(fx));
      assert.equal(r.code, 1, target);
      assert.deepEqual(snapshot(repo), before);
      assert.equal(existsSync('/tmp/wavework-abs-escape.md'), false);
    } finally { cleanup(repo, fx.dir); }
  }
});

test('a target that would overwrite wavework.json, the lock or settings.json is refused', async () => {
  for (const target of ['.claude/wavework.json', '.claude/wavework.lock.json', '.claude/settings.json']) {
    const repo = makeRepo();
    writeConfig(repo);
    const fx = defaultFixture();
    fx.targets = [{ template: 'a.md', target }];
    try {
      const r = await cli(['init'], repo, withFixture(fx));
      assert.equal(r.code, 1, target);
      assert.match(r.stderr, /reserved/);
    } finally { cleanup(repo, fx.dir); }
  }
});

test('a symlinked directory under .claude pointing outside is never written through (init)', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  const outside = tempDir('wavework-outside-');
  symlinkSync(outside, join(repo, '.claude/skills'));
  const fx = defaultFixture();
  try {
    const before = snapshot(outside);
    const r = await cli(['init'], repo, withFixture(fx));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /symlink/);
    assert.deepEqual(snapshot(outside), before);
  } finally { cleanup(repo, fx.dir, outside); }
});

test('a symlinked target file is not written through, the victim stays untouched', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  const outside = tempDir('wavework-outside-');
  writeFileSync(join(outside, 'victim'), 'precious');
  mkdirSync(join(repo, '.claude/skills/a'), { recursive: true });
  symlinkSync(join(outside, 'victim'), join(repo, '.claude', A));
  const fx = defaultFixture();
  try {
    const r = await cli(['init'], repo, withFixture(fx));
    assert.equal(r.code, 1);
    assert.equal(readFileSync(join(outside, 'victim'), 'utf8'), 'precious');
  } finally { cleanup(repo, fx.dir, outside); }
});

test('a symlink planted after init is refused on update, nothing outside changes', async () => {
  const s = await setup();
  const outside = tempDir('wavework-outside-');
  try {
    writeFileSync(join(outside, 'victim'), 'precious');
    rmSync(join(s.repo, '.claude', A));
    symlinkSync(join(outside, 'victim'), join(s.repo, '.claude', A));
    s.fx.set('a.md', 'A v2 on {{baseBranch}}\n');
    const r = await s.run(['update']);
    assert.equal(r.code, 1);
    assert.equal(readFileSync(join(outside, 'victim'), 'utf8'), 'precious');
  } finally { s.done(); cleanup(outside); }
});

test('a tampered lock cannot make update delete or write outside .claude', async () => {
  const outside = tempDir('wavework-outside-');
  writeFileSync(join(outside, 'victim'), 'precious');
  for (const key of ['../../victim', '/etc/hosts', 'a/../../x', 'wavework.json', 'settings.json']) {
    const s = await setup();
    try {
      put(s.repo, 'sentinel.txt', 'keep');
      const lockPath = join(s.repo, '.claude/wavework.lock.json');
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      // a hash matching the victim would make update want to delete it as "unedited"
      lock.files[key] = sha('precious');
      writeFileSync(lockPath, JSON.stringify(lock));
      const before = snapshot(s.repo);
      const r = await s.run(['update']);
      assert.equal(r.code, 1, key);
      assert.match(r.stderr, /lock/i);
      assert.deepEqual(snapshot(s.repo), before);
      assert.equal(readFileSync(join(outside, 'victim'), 'utf8'), 'precious');
    } finally { s.done(); }
  }
  cleanup(outside);
});

test('a tampered lock with a symlinked ancestor is refused (no delete through the link)', async () => {
  const s = await setup();
  const outside = tempDir('wavework-outside-');
  try {
    writeFileSync(join(outside, 'victim'), 'precious');
    symlinkSync(outside, join(s.repo, '.claude/evil'));
    const lockPath = join(s.repo, '.claude/wavework.lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock.files['evil/victim'] = sha('precious');
    writeFileSync(lockPath, JSON.stringify(lock));
    const r = await s.run(['update']);
    assert.equal(r.code, 1);
    assert.equal(readFileSync(join(outside, 'victim'), 'utf8'), 'precious');
  } finally { s.done(); cleanup(outside); }
});

test('a malformed lock (bad JSON, bad hash, bad hooks) is a clear error', async () => {
  for (const mutate of [
    () => '{ nope',
    (l) => JSON.stringify({ ...l, files: { [A]: 'xyz' } }),
    (l) => JSON.stringify({ ...l, files: [] }),
    (l) => JSON.stringify({ ...l, hooks: 'x' }),
  ]) {
    const s = await setup();
    try {
      const lockPath = join(s.repo, '.claude/wavework.lock.json');
      writeFileSync(lockPath, mutate(JSON.parse(readFileSync(lockPath, 'utf8'))));
      const r = await s.run(['update']);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /lock/i);
    } finally { s.done(); }
  }
});

// ---------- CLI surface ----------

test('unknown options and missing option values are exit 1 with usage', async () => {
  const repo = makeRepo();
  try {
    for (const argv of [['init', '--bogus'], ['update', '--config', 'x'], ['init', '--config'], ['update', 'extra']]) {
      const r = await cli(argv, repo);
      assert.equal(r.code, 1, argv.join(' '));
      assert.match(r.stderr, /Usage: wavework/);
    }
  } finally { cleanup(repo); }
});

test('--help lists init and update with their options', async () => {
  const r = await cli(['--help'], process.cwd());
  assert.match(r.stdout, /init .*--config/);
  assert.match(r.stdout, /--dry-run/);
  assert.doesNotMatch(r.stdout, /init\s+\(not yet implemented\)/);
});

test('bin/wavework.mjs init works end to end in a temp repo', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  const fx = defaultFixture();
  try {
    // the real binary needs the real targets (see the integration test below); this goes through run() with the fixture provider
    const r = await cli(['init'], repo, withFixture(fx));
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(repo, '.claude/wavework.lock.json')));
  } finally { cleanup(repo, fx.dir); }
});

// ---------- integration with the real targets (src/targets.mjs, shipr-p9ge.4) ----------

const realTargets = existsSync(new URL('../src/targets.mjs', import.meta.url));
test('init + update with the real targets: every template lands in .claude, update is a no-op',
  { skip: realTargets ? false : 'src/targets.mjs does not exist yet (shipr-p9ge.4)' },
  async () => {
    const repo = makeRepo();
    writeConfig(repo);
    try {
      const r = await cli(['init'], repo);
      assert.equal(r.code, 0, r.stderr);
      const lock = readJson(repo, '.claude/wavework.lock.json');
      assert.ok(Object.keys(lock.files).length > 0);
      const before = snapshot(repo);
      const u = await cli(['update'], repo);
      assert.equal(u.code, 0, u.stderr);
      assert.deepEqual(snapshot(repo), before);
    } finally { cleanup(repo); }
  });

// ---------- review round 1 ----------

test('templates see the repo directory name: worktree paths use it', async () => {
  const parent = tempDir();
  const repo = join(parent, 'shipir-like');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeConfig(repo);
  const fx = makeFixture({ 'w.md': '{{worktreeExample}}\n' }, [{ template: 'w.md', target: '.claude/w.md' }]);
  try {
    const r = await cli(['init'], repo, withFixture(fx));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(readFileSync(join(repo, '.claude/w.md'), 'utf8'), '../shipir-like-shipr-cxk\n');
  } finally { cleanup(parent, fx.dir); }
});

test('update restores a lost exec bit on a script whose content is unchanged; dry-run only reports it', async () => {
  const s = await setup();
  try {
    const file = join(s.repo, '.claude/scripts/run.sh');
    chmodSync(file, 0o644);
    const dry = await s.run(['update', '--dry-run']);
    assert.match(dry.stdout, /mode\s+scripts\/run\.sh/);
    assert.equal(statSync(file).mode & 0o777, 0o644);
    const r = await s.run(['update']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /mode\s+scripts\/run\.sh/);
    assert.equal(statSync(file).mode & 0o777, 0o755);
  } finally { s.done(); }
});

test('starter config uses "." as whole-repo whenPaths', async () => {
  const repo = makeRepo();
  const fx = defaultFixture();
  try {
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x']);
    execFileSync('git', ['-C', repo, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD']);
    execFileSync('git', ['-C', repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']);
    const r = await cli(['init'], repo, withFixture(fx));
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(readJson(repo, '.claude/wavework.json').checks[0].whenPaths, ['.']);
  } finally { cleanup(repo, fx.dir); }
});

test('update does not re-add a hook entry the user changed; reports it, keeps the user version, exit 0', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  const fx = defaultFixture();
  const defs = { hooks: { PreToolUse: [HOOK] } };
  try {
    await cli(['init'], repo, withFixture(fx, { hooks: defs }));
    const s = readJson(repo, '.claude/settings.json');
    s.hooks.PreToolUse[0].matcher = 'Edit';
    put(repo, '.claude/settings.json', JSON.stringify(s));
    const r = await cli(['update'], repo, withFixture(fx, { hooks: defs }));
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /hook PreToolUse: owned entry changed locally, not re-added/);
    assert.deepEqual(readJson(repo, '.claude/settings.json').hooks.PreToolUse, [{ ...HOOK, matcher: 'Edit' }]);
  } finally { cleanup(repo, fx.dir); }
});

test('an identical hook that existed before init stays foreign (not in the lock)', async () => {
  const repo = makeRepo();
  writeConfig(repo);
  put(repo, '.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [HOOK] } }));
  const fx = defaultFixture();
  try {
    await cli(['init'], repo, withFixture(fx, { hooks: { hooks: { PreToolUse: [HOOK] } } }));
    assert.deepEqual(readJson(repo, '.claude/wavework.lock.json').hooks, []);
  } finally { cleanup(repo, fx.dir); }
});

test('targets differing only by case collide; .wavework-new and .wavework-tmp targets are refused', async () => {
  const cases = [
    [[{ template: 'a.md', target: '.claude/skills/x.md' }, { template: 'a.md', target: '.claude/Skills/X.md' }], /duplicate/],
    [[{ template: 'a.md', target: '.claude/x.md.wavework-new' }], /wavework-new/],
    [[{ template: 'a.md', target: '.claude/.x.md.wavework-tmp' }], /wavework-tmp/],
  ];
  for (const [targets, re] of cases) {
    const repo = makeRepo();
    writeConfig(repo);
    const fx = defaultFixture();
    fx.targets = targets;
    try {
      const before = snapshot(repo);
      const r = await cli(['init'], repo, withFixture(fx));
      assert.equal(r.code, 1);
      assert.match(r.stderr, re);
      assert.deepEqual(snapshot(repo), before);
    } finally { cleanup(repo, fx.dir); }
  }
});

test('a tampered lock listing a .wavework-new path is refused', async () => {
  const s = await setup();
  try {
    const lockPath = join(s.repo, '.claude/wavework.lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock.files[`${A}.wavework-new`] = sha('x');
    writeFileSync(lockPath, JSON.stringify(lock));
    assert.equal((await s.run(['update'])).code, 1);
  } finally { s.done(); }
});

test('a no-op update prints the repository line and a single result line', async () => {
  const s = await setup();
  try {
    const r = await s.run(['update']);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 2, r.stdout);
    assert.match(lines[0], /^wavework: repository /);
  } finally { s.done(); }
});

// ---------- code map layouts (0.2.0), real templates ----------

const MAP_CONFIG = (codeMap) => ({ ...CONFIG, dashboard: { enabled: false }, codeMap });
const CHECKER_REL = '.claude/scripts/code-map-check.mjs';

test('init with the folder layout and an index.md installs the checker and renders the folder text', async () => {
  const repo = makeRepo({ 'docs/code-map/index.md': '# Code map\n' });
  try {
    writeConfig(repo, MAP_CONFIG({ path: 'docs/code-map' }));
    const r = await cli(['init'], repo);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /create\s+scripts\/code-map-check\.mjs/);
    assert.ok(existsSync(join(repo, CHECKER_REL)));
    assert.match(readFileSync(join(repo, '.claude/skills/next-task-finish/SKILL.md'), 'utf8'), /code-map-check\.mjs docs\/code-map --max 160/);
    assert.ok(readJson(repo, '.claude/wavework.lock.json').files['scripts/code-map-check.mjs']);
  } finally { cleanup(repo); }
});

test('init with the folder layout fails clearly and writes nothing when the folder or its index.md is missing', async () => {
  const noFolder = makeRepo();
  const noIndex = makeRepo({ 'docs/code-map/root.md': '- a: b\n' });
  try {
    for (const [repo, re] of [[noFolder, /folder does not exist/], [noIndex, /must contain index\.md/]]) {
      writeConfig(repo, MAP_CONFIG({ path: 'docs/code-map' }));
      const before = snapshot(repo);
      const r = await cli(['init'], repo);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /codeMap\.path "docs\/code-map"/);
      assert.match(r.stderr, re);
      assert.deepEqual(snapshot(repo), before, 'repo must be untouched');
    }
    // dry-run validates too
    assert.equal((await cli(['init', '--dry-run'], noFolder)).code, 1);
  } finally { cleanup(noFolder, noIndex); }
});

test('init with the file layout needs no folder and installs no checker', async () => {
  const repo = makeRepo();
  try {
    writeConfig(repo, MAP_CONFIG({ path: 'docs/CODE_MAP.md' }));
    const r = await cli(['init'], repo);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!existsSync(join(repo, CHECKER_REL)));
    assert.match(readFileSync(join(repo, '.claude/skills/next-task-code/SKILL.md'), 'utf8'), /docs\/CODE_MAP\.md/);
  } finally { cleanup(repo); }
});

test('update validates the folder layout too, and switching layouts adds / removes the checker', async () => {
  const repo = makeRepo({ 'docs/CODE_MAP.md': '# map\n' });
  try {
    writeConfig(repo, MAP_CONFIG({ path: 'docs/CODE_MAP.md' }));
    assert.equal((await cli(['init'], repo)).code, 0);
    assert.ok(!existsSync(join(repo, CHECKER_REL)));

    writeConfig(repo, MAP_CONFIG({ path: 'docs/code-map' }));
    const failed = await cli(['update'], repo);
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, /folder does not exist/);
    assert.ok(!existsSync(join(repo, CHECKER_REL)), 'a failed update changes nothing');

    put(repo, 'docs/code-map/index.md', '# Code map\n');
    const added = await cli(['update'], repo);
    assert.equal(added.code, 0, added.stderr);
    assert.match(added.stdout, /create\s+scripts\/code-map-check\.mjs/);
    assert.ok(existsSync(join(repo, CHECKER_REL)));

    writeConfig(repo, MAP_CONFIG({ path: 'docs/CODE_MAP.md' }));
    const removed = await cli(['update'], repo);
    assert.equal(removed.code, 0, removed.stderr);
    assert.match(removed.stdout, /delete\s+scripts\/code-map-check\.mjs/);
    assert.ok(!existsSync(join(repo, CHECKER_REL)));
    assert.equal(readJson(repo, '.claude/wavework.lock.json').files['scripts/code-map-check.mjs'], undefined);
  } finally { cleanup(repo); }
});

test('a locally edited checker is kept for review when the layout is switched away', async () => {
  const repo = makeRepo({ 'docs/code-map/index.md': '# Code map\n' });
  try {
    writeConfig(repo, MAP_CONFIG({ path: 'docs/code-map' }));
    assert.equal((await cli(['init'], repo)).code, 0);
    writeFileSync(join(repo, CHECKER_REL), '// mine\n');
    writeConfig(repo, MAP_CONFIG({ path: 'docs/CODE_MAP.md' }));
    const r = await cli(['update'], repo);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /review\s+scripts\/code-map-check\.mjs: removed upstream but edited locally, kept/);
    assert.equal(readFileSync(join(repo, CHECKER_REL), 'utf8'), '// mine\n');
  } finally { cleanup(repo); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, statSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONFIG, makeRepo, writeConfig, put, cleanup, cli, defaultFixture, withFixture, snapshot, readJson,
} from './helpers/repo.mjs';
import { lineDiffStat } from '../src/cli/diff-stat.mjs';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const A = 'skills/a/SKILL.md';
const B = 'skills/b/SKILL.md';
const RUN = 'scripts/run.sh';

/** Repo with config and the default fixture; `existing` maps .claude-relative path to content (or [content, mode]). */
function setup(existing = {}, { config = true } = {}) {
  const repo = makeRepo();
  if (config) writeConfig(repo);
  for (const [rel, v] of Object.entries(existing)) {
    const [content, mode] = Array.isArray(v) ? v : [v];
    put(repo, `.claude/${rel}`, content, mode);
    if (mode !== undefined) chmodSync(join(repo, '.claude', rel), mode);
  }
  const fx = defaultFixture();
  return {
    repo, fx,
    run: (argv, extra) => cli(argv, repo, withFixture(fx, extra)),
    read: (rel) => readFileSync(join(repo, '.claude', rel), 'utf8'),
    lock: () => readJson(repo, '.claude/wavework.lock.json'),
    done: () => cleanup(repo, fx.dir),
  };
}

test('lineDiffStat counts added and removed lines', () => {
  assert.deepEqual(lineDiffStat('a\nb\nc\n', 'a\nb\nc\n'), { added: 0, removed: 0 });
  assert.deepEqual(lineDiffStat('a\nb\nc\n', 'a\nX\nc\nd\n'), { added: 2, removed: 1 });
  assert.deepEqual(lineDiffStat('', 'a\nb\n'), { added: 2, removed: 0 });
  assert.deepEqual(lineDiffStat('a\nb\n', ''), { added: 0, removed: 2 });
  assert.deepEqual(lineDiffStat('a\nb', 'a\nb\n'), { added: 0, removed: 0, whitespaceOnly: true }); // trailing newline alone is not a line
  assert.equal(lineDiffStat('a\n', 'a\n').whitespaceOnly, undefined);
});

test('lineDiffStat over the cell cap returns an upper bound flagged approx', () => {
  const from = 'a\nb\nc\nd\n';
  const to = 'a\nX\nY\nd\n';
  assert.deepEqual(lineDiffStat(from, to), { added: 2, removed: 2 });
  assert.deepEqual(lineDiffStat(from, to, { maxCells: 3 }), { added: 2, removed: 2, approx: true });
  const big = lineDiffStat('a\nb\nc\nd\ne\n', 'a\nc\nd\nz\ne\n', { maxCells: 1 });
  assert.equal(big.approx, true);
});

test('adopt lists a trailing-newline-only difference truthfully', async () => {
  const s = setup({ [A]: 'A on main', [B]: 'B\n' });
  try {
    const r = await s.run(['init', '--adopt']);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /\(\+0 -0, whitespace\/newline only\)/);
  } finally { s.done(); }
});

test('update refuses when a symlink sits at a .wavework-new path', async () => {
  const s = setup({ [A]: 'mine\n' });
  try {
    assert.equal((await s.run(['init', '--adopt'])).code, 2);
    rmSync(join(s.repo, '.claude', `${A}.wavework-new`));
    symlinkSync(join(s.repo, 'elsewhere'), join(s.repo, '.claude', `${A}.wavework-new`));
    const r = await s.run(['update']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /symlink/);
  } finally { s.done(); }
});

test('adopt with identical files keeps and locks them, exit 0', async () => {
  const s = setup({ [A]: 'A on main\n', [B]: 'B\n', [RUN]: ['#!/bin/sh\necho hi\n', 0o755] });
  try {
    const r = await s.run(['init', '--adopt']);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /3 identical/);
    assert.deepEqual(s.lock().files, { [A]: sha('A on main\n'), [B]: sha('B\n'), [RUN]: sha('#!/bin/sh\necho hi\n') });
    assert.equal(existsSync(join(s.repo, '.claude', `${A}.wavework-new`)), false);
  } finally { s.done(); }
});

test('adopt with differing files keeps them byte-identical, writes .wavework-new, lists with stats, exit 2', async () => {
  const mine = 'my A\nline2\n';
  const s = setup({ [A]: mine, [B]: 'B\n' });
  try {
    const r = await s.run(['init', '--adopt']);
    assert.equal(r.code, 2, r.stderr + r.stdout);
    assert.equal(s.read(A), mine);
    assert.equal(s.read(`${A}.wavework-new`), 'A on main\n');
    assert.match(r.stdout, /skills\/a\/SKILL\.md.*\+1 -2/);
    assert.match(r.stdout, /1 identical, 1 differing, 1 new/);
    assert.equal((r.stdout.match(/for a full diff/g) ?? []).length, 1);
    // Lock records the RENDERED hash for the differing file
    assert.equal(s.lock().files[A], sha('A on main\n'));
    assert.equal(s.lock().files[B], sha('B\n'));
  } finally { s.done(); }
});

test('adopt creates missing files, with the right mode', async () => {
  const s = setup({ [A]: 'A on main\n' });
  try {
    const r = await s.run(['init', '--adopt']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(s.read(B), 'B\n');
    assert.equal(statSync(join(s.repo, '.claude', RUN)).mode & 0o777, 0o755);
    assert.match(r.stdout, /1 identical, 0 differing, 2 new/);
  } finally { s.done(); }
});

test('adopt fixes the exec bit of an identical script and reports it', async () => {
  const s = setup({ [A]: 'A on main\n', [B]: 'B\n', [RUN]: ['#!/bin/sh\necho hi\n', 0o644] });
  try {
    const r = await s.run(['init', '--adopt']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(statSync(join(s.repo, '.claude', RUN)).mode & 0o111, 0o111);
    assert.match(r.stdout, /mode\s+scripts\/run\.sh/);
  } finally { s.done(); }
});

test('adopt is refused when a lock exists, nothing changes', async () => {
  const s = setup();
  try {
    assert.equal((await s.run(['init'])).code, 0);
    const before = snapshot(s.repo);
    const r = await s.run(['init', '--adopt']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /already set up/);
    assert.deepEqual(snapshot(s.repo), before);
  } finally { s.done(); }
});

test('adopt without .claude/wavework.json requires --config and explains why', async () => {
  const s = setup({ [A]: 'x\n' }, { config: false });
  try {
    const before = snapshot(s.repo);
    const r = await s.run(['init', '--adopt']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /--adopt requires --config/);
    assert.match(r.stderr, /starter config/);
    assert.deepEqual(snapshot(s.repo), before);
    put(s.repo, 'cfg.json', JSON.stringify(CONFIG));
    const ok = await s.run(['init', '--adopt', '--config', 'cfg.json']);
    assert.equal(ok.code, 2, ok.stderr);
    assert.equal(readJson(s.repo, '.claude/wavework.json').baseBranch, 'main');
  } finally { s.done(); }
});

test('adopt --dry-run writes nothing and prints the full plan with stats', async () => {
  const s = setup({ [A]: 'mine\n', [B]: 'B\n' });
  try {
    const before = snapshot(s.repo);
    const r = await s.run(['init', '--adopt', '--dry-run']);
    assert.equal(r.code, 2);
    assert.deepEqual(snapshot(s.repo), before);
    assert.match(r.stdout, /dry-run: .*skills\/a\/SKILL\.md.*\+1 -1/);
    assert.match(r.stdout, /dry-run: create\s+scripts\/run\.sh/);
    assert.match(r.stdout, /1 identical, 1 differing, 1 new/);
  } finally { s.done(); }
});

test('adopt refuses path escapes and symlinks, repo untouched', async () => {
  const s = setup({ [B]: 'B\n' });
  try {
    s.fx.targets.push({ template: 'a.md', target: '.claude/../evil.md' });
    const before = snapshot(s.repo);
    const r = await s.run(['init', '--adopt']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unsafe path/);
    assert.deepEqual(snapshot(s.repo), before);
    s.fx.targets.pop();

    const outside = join(s.repo, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(s.repo, '.claude/skills/a'));
    const before2 = snapshot(s.repo);
    const r2 = await s.run(['init', '--adopt']);
    assert.equal(r2.code, 1);
    assert.match(r2.stderr, /symlink/);
    assert.deepEqual(snapshot(s.repo), before2);

  } finally { s.done(); }
});

test('adopt refuses a symlinked target file even when it points inside .claude', async () => {
  const s = setup({ [B]: 'B\n', 'real.md': 'A on main\n' });
  try {
    mkdirSync(join(s.repo, '.claude/skills/a'), { recursive: true });
    symlinkSync(join(s.repo, '.claude/real.md'), join(s.repo, '.claude', A));
    const before = snapshot(s.repo);
    const r = await s.run(['init', '--adopt']);
    assert.equal(r.code, 1);
    assert.deepEqual(snapshot(s.repo), before);
  } finally { s.done(); }
});

test('adopt keeps foreign hooks and merges settings', async () => {
  const hooks = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'mine.sh' }] }] } };
  const defs = { hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'ours.sh' }] }] } };
  const s = setup({ 'settings.json': `${JSON.stringify({ ...hooks, permissions: { allow: ['x'] } })}\n`, [A]: 'A on main\n' });
  try {
    const r = await s.run(['init', '--adopt'], { hooks: defs });
    assert.equal(r.code, 0, r.stderr);
    const settings = readJson(s.repo, '.claude/settings.json');
    assert.deepEqual(settings.permissions, { allow: ['x'] });
    assert.equal(settings.hooks.PreToolUse.length, 2);
    assert.deepEqual(settings.hooks.PreToolUse[0], hooks.hooks.PreToolUse[0]);
    assert.equal(s.lock().hooks.length, 1);
  } finally { s.done(); }
});

test('update after adopt keeps reporting unresolved files and stops once resolved', async () => {
  const s = setup({ [A]: 'mine\n', [B]: 'B\n', [RUN]: ['#!/bin/sh\necho hi\n', 0o755] });
  try {
    assert.equal((await s.run(['init', '--adopt'])).code, 2);
    for (let i = 0; i < 2; i++) {
      const r = await s.run(['update']);
      assert.equal(r.code, 2, `run ${i}: ${r.stdout}`);
      assert.match(r.stdout, /skills\/a\/SKILL\.md/);
      assert.equal(s.read(A), 'mine\n');
    }
    // resolve: make the file equal to the rendered version
    writeFileSync(join(s.repo, '.claude', A), 'A on main\n');
    const ok = await s.run(['update']);
    assert.equal(ok.code, 0, ok.stdout);
    assert.doesNotMatch(ok.stdout, /review/);
  } finally { s.done(); }
});

test('update after adopt stops when the user merges and deletes the .wavework-new file', async () => {
  const s = setup({ [A]: 'mine\n' });
  try {
    assert.equal((await s.run(['init', '--adopt'])).code, 2);
    rmSync(join(s.repo, '.claude', `${A}.wavework-new`));
    const r = await s.run(['update']);
    assert.equal(r.code, 0, r.stdout);
    assert.equal(s.read(A), 'mine\n');
  } finally { s.done(); }
});

test('init --adopt is usage-listed and --adopt is not accepted by update', async () => {
  const s = setup();
  try {
    const h = await s.run(['--help']);
    assert.match(h.stdout, /--adopt/);
    const r = await s.run(['update', '--adopt']);
    assert.equal(r.code, 1);
  } finally { s.done(); }
});

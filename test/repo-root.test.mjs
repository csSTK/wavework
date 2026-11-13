import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { resolveRepo } from '../src/cli/repo.mjs';
import {
  CONFIG, makeRepo, writeConfig, put, cleanup, cli, tempDir, makeFixture, withFixture, snapshot,
} from './helpers/repo.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const COMMIT = ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q'];

/** Main checkout with a commit (so worktrees can be added) and a config; the linked worktree has a different name. */
function repoWithWorktree() {
  const repo = makeRepo({ 'README.md': 'x\n' });
  writeConfig(repo);
  git(repo, 'add', '.');
  git(repo, ...COMMIT, '-m', 'init');
  const parent = tempDir('wavework-wt-');
  const worktree = join(parent, 'acme-feature-x');
  git(repo, 'worktree', 'add', '-q', '-b', 'task/x', worktree);
  return { repo, worktree, parent, done: () => cleanup(repo, parent) };
}

// Template that shows what repoName the CLI passed (worktree example uses the real context variable).
const probe = () => makeFixture(
  { 'p.md': 'name={{repoName}} wt={{worktreeExample}}\n' },
  [{ template: 'p.md', target: '.claude/skills/p/SKILL.md' }],
);
const rendered = (root) => readFileSync(join(root, '.claude/skills/p/SKILL.md'), 'utf8');

test('resolveRepo: main checkout, subdirectory, linked worktree and its subdirectory', () => {
  const w = repoWithWorktree();
  try {
    const main = realpathSync(w.repo);
    const wt = realpathSync(w.worktree);
    const name = basename(main);
    mkdirSync(join(w.repo, 'src/deep'), { recursive: true });
    mkdirSync(join(w.worktree, 'src'), { recursive: true });
    assert.deepEqual(resolveRepo(w.repo), { root: main, repoName: name });
    assert.deepEqual(resolveRepo(join(w.repo, 'src/deep')), { root: main, repoName: name });
    assert.deepEqual(resolveRepo(w.worktree), { root: wt, repoName: name });
    assert.deepEqual(resolveRepo(join(w.worktree, 'src')), { root: wt, repoName: name });
  } finally { w.done(); }
});

test('resolveRepo: outside a git repository and in a bare repository gives a clear error', () => {
  const dir = tempDir();
  const bare = tempDir();
  try {
    execFileSync('git', ['init', '-q', '--bare', bare]);
    assert.throws(() => resolveRepo(dir), /not inside a git repository/);
    assert.throws(() => resolveRepo(bare), /not inside a git working tree|not inside a git repository/);
  } finally { cleanup(dir, bare); }
});

test('init and update in a linked worktree with another name render the main checkout name', async () => {
  const w = repoWithWorktree();
  const fx = probe();
  try {
    const name = basename(realpathSync(w.repo));
    let r = await cli(['init'], w.worktree, withFixture(fx));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(rendered(w.worktree), `name=${name} wt=../${name}-shipr-cxk\n`);
    assert.ok(!existsSync(join(w.repo, '.claude/skills')), 'nothing is written to the main checkout');
    fx.set('p.md', 'name={{repoName}} wt={{worktreeExample}} v2\n');
    r = await cli(['update'], w.worktree, withFixture(fx));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(rendered(w.worktree), `name=${name} wt=../${name}-shipr-cxk v2\n`);
  } finally { w.done(); cleanup(fx.dir); }
});

test('init and update from a subdirectory operate on the repository root', async () => {
  const repo = makeRepo({ 'sub/dir/.keep': '' });
  writeConfig(repo);
  const fx = probe();
  try {
    const sub = join(repo, 'sub/dir');
    const name = basename(realpathSync(repo));
    let r = await cli(['init'], sub, withFixture(fx));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(rendered(repo), `name=${name} wt=../${name}-shipr-cxk\n`);
    assert.ok(!existsSync(join(sub, '.claude')), 'no .claude in the subdirectory');
    fx.set('p.md', 'v2 {{repoName}}\n');
    r = await cli(['update'], sub, withFixture(fx));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(rendered(repo), `v2 ${name}\n`);
  } finally { cleanup(repo, fx.dir); }
});

test('init --adopt in a worktree subdirectory adopts identical files and locks them', async () => {
  const w = repoWithWorktree();
  const fx = probe();
  try {
    const name = basename(realpathSync(w.repo));
    put(w.worktree, '.claude/skills/p/SKILL.md', `name=${name} wt=../${name}-shipr-cxk\n`);
    mkdirSync(join(w.worktree, 'pkg'), { recursive: true });
    const r = await cli(['init', '--adopt'], join(w.worktree, 'pkg'), withFixture(fx));
    assert.equal(r.code, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /wavework-new/);
    assert.ok(existsSync(join(w.worktree, '.claude/wavework.lock.json')));
  } finally { w.done(); cleanup(fx.dir); }
});

test('path safety is unchanged: a symlinked .claude at the root is refused when run from a subdirectory', async () => {
  const repo = makeRepo({ 'sub/.keep': '' });
  const elsewhere = tempDir();
  const fx = probe();
  try {
    symlinkSync(elsewhere, join(repo, '.claude'));
    put(elsewhere, 'wavework.json', JSON.stringify(CONFIG));
    const before = snapshot(elsewhere);
    const r = await cli(['init'], join(repo, 'sub'), withFixture(fx));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /symlink/);
    assert.deepEqual(snapshot(elsewhere), before);
  } finally { cleanup(repo, elsewhere, fx.dir); }
});

test('init and update outside a git repository fail clearly and write nothing', async () => {
  const dir = tempDir();
  const fx = probe();
  try {
    writeConfig(dir);
    for (const argv of [['init'], ['update']]) {
      const r = await cli(argv, dir, withFixture(fx));
      assert.equal(r.code, 1);
      assert.match(r.stderr, /not inside a git repository/);
    }
    assert.equal(existsSync(join(dir, '.claude/wavework.lock.json')), false);
  } finally { cleanup(dir, fx.dir); }
});

test('next-task-branch renders identically from the main checkout and a differently named worktree', async () => {
  const w = repoWithWorktree();
  const sub = tempDir('wavework-sub-');
  try {
    // real templates, real targets: the same config rendered in three places
    const read = (root) => readFileSync(join(root, '.claude/skills/next-task-branch/SKILL.md'), 'utf8');
    for (const root of [w.repo, w.worktree]) {
      const r = await cli(['init'], root);
      assert.equal(r.code, 0, r.stderr);
    }
    assert.equal(read(w.worktree), read(w.repo));
    assert.doesNotMatch(read(w.worktree), /acme-feature-x/);
    const example = read(w.worktree).match(/\.\.\/(\S+)-shipr-cxk/);
    assert.equal(example?.[1], basename(realpathSync(w.repo)), 'the worktree example names the main checkout');
  } finally { w.done(); cleanup(sub); }
});

test('resolveRepo ignores inherited GIT_* variables (GIT_WORK_TREE, GIT_DIR, ...)', () => {
  const w = repoWithWorktree();
  const elsewhere = tempDir();
  try {
    mkdirSync(join(w.worktree, 'src'), { recursive: true });
    const wt = realpathSync(w.worktree);
    const name = basename(realpathSync(w.repo));
    const hostile = [
      { GIT_WORK_TREE: elsewhere },
      { GIT_DIR: join(w.repo, '.git') },
      { GIT_DIR: elsewhere, GIT_COMMON_DIR: elsewhere, GIT_INDEX_FILE: join(elsewhere, 'idx'), GIT_PREFIX: 'x/', GIT_CEILING_DIRECTORIES: wt },
    ];
    for (const extra of hostile) {
      const env = { ...process.env, ...extra };
      assert.deepEqual(resolveRepo(join(w.worktree, 'src'), env), { root: wt, repoName: name }, JSON.stringify(Object.keys(extra)));
    }
  } finally { w.done(); cleanup(elsewhere); }
});

test('init does not write outside the repository when GIT_WORK_TREE points elsewhere', async () => {
  const repo = makeRepo();
  const elsewhere = tempDir();
  const fx = probe();
  try {
    writeConfig(repo);
    const r = await cli(['init'], repo, withFixture(fx, { env: { ...process.env, GIT_WORK_TREE: elsewhere } }));
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(repo, '.claude/wavework.lock.json')));
    assert.equal(existsSync(join(elsewhere, '.claude')), false);
  } finally { cleanup(repo, elsewhere, fx.dir); }
});

test('init and update print the repository root and name first, also from a subdirectory and with --dry-run / --adopt', async () => {
  const repo = makeRepo({ 'sub/.keep': '' });
  writeConfig(repo);
  const fx = probe();
  try {
    const root = realpathSync(repo);
    const line = `wavework: repository ${root} (${basename(root)})\n`;
    const sub = join(repo, 'sub');
    let r = await cli(['init', '--dry-run'], sub, withFixture(fx));
    assert.ok(r.stdout.startsWith(line), r.stdout);
    r = await cli(['init'], sub, withFixture(fx));
    assert.ok(r.stdout.startsWith(line), r.stdout);
    r = await cli(['update'], sub, withFixture(fx));
    assert.ok(r.stdout.startsWith(line), r.stdout);
    r = await cli(['update', '--dry-run'], sub, withFixture(fx));
    assert.ok(r.stdout.startsWith(line), r.stdout);
    const adopt = makeRepo();
    writeConfig(adopt);
    r = await cli(['init', '--adopt'], adopt, withFixture(fx));
    assert.ok(r.stdout.startsWith(`wavework: repository ${realpathSync(adopt)} (`), r.stdout);
    cleanup(adopt);
  } finally { cleanup(repo, fx.dir); }
});

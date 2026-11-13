import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, lstatSync, readlinkSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { run } from '../../src/cli.mjs';

export const CONFIG = {
  baseBranch: 'main',
  checks: [{ name: 'app', dir: '.', whenPaths: ['src/'], focused: 'npm test', full: 'npm test' }],
};

export function tempDir(prefix = 'wavework-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

/** A temp git repo; `files` maps relative path to content. */
export function makeRepo(files = {}) {
  const dir = tempDir();
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  for (const [rel, content] of Object.entries(files)) put(dir, rel, content);
  return dir;
}

export function put(root, rel, content, mode) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, mode === undefined ? undefined : { mode });
  return file;
}

export function writeConfig(repo, config = CONFIG) {
  put(repo, '.claude/wavework.json', `${JSON.stringify(config, null, 2)}\n`);
}

/** Templates dir plus a mutable target list (targets are repo-relative, `.claude/...`, as src/targets.mjs returns them); `templates` maps template path to content. */
export function makeFixture(templates, targets) {
  const dir = tempDir('wavework-tpl-');
  const fixture = {
    dir,
    targets,
    set(rel, content) { put(dir, rel, content); },
    provider: () => fixture.targets.map((t) => ({ vars: {}, mode: 0o644, ...t })),
  };
  for (const [rel, content] of Object.entries(templates)) put(dir, rel, content);
  return fixture;
}

export const DEFAULT_TEMPLATES = {
  'a.md': 'A on {{baseBranch}}\n',
  'dir/b.md': 'B\n',
  'run.sh': '#!/bin/sh\necho hi\n',
};
export const DEFAULT_TARGETS = [
  { template: 'a.md', target: '.claude/skills/a/SKILL.md' },
  { template: 'dir/b.md', target: '.claude/skills/b/SKILL.md' },
  { template: 'run.sh', target: '.claude/scripts/run.sh', mode: 0o755 },
];

export function defaultFixture() {
  return makeFixture(DEFAULT_TEMPLATES, DEFAULT_TARGETS.map((t) => ({ ...t })));
}

/** Runs the CLI in `cwd`; returns { code, stdout, stderr }. */
export async function cli(argv, cwd, extra = {}) {
  const out = { stdout: '', stderr: '' };
  const code = await run(argv, {
    stdout: { write: (s) => { out.stdout += s; } },
    stderr: { write: (s) => { out.stderr += s; } },
    cwd,
    ...extra,
  });
  return { code, ...out };
}

export const withFixture = (fixture, extra = {}) => ({
  targets: fixture.provider,
  templatesDir: fixture.dir,
  hooks: { hooks: {} },
  ...extra,
});

/** Full snapshot of a tree: path -> description (file content+mode, symlink target, dir). */
export function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const rel = p.slice(root.length + 1);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out[rel] = `symlink -> ${readlinkSync(p)}`;
      else if (st.isDirectory()) { out[rel] = 'dir'; walk(p); }
      else out[rel] = `file ${(st.mode & 0o777).toString(8)} ${readFileSync(p, 'utf8')}`;
    }
  };
  walk(root);
  return out;
}

export const readJson = (repo, rel) => JSON.parse(readFileSync(join(repo, rel), 'utf8'));

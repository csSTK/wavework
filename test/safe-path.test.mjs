import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeResolve } from '../src/cli/safe-path.mjs';
import { tempDir, cleanup } from './helpers/repo.mjs';

function setup() {
  const repo = tempDir();
  const outside = tempDir('wavework-outside-');
  const claude = join(repo, '.claude');
  mkdirSync(claude);
  return { repo, outside, claude, done: () => cleanup(repo, outside) };
}

test('accepts a plain nested relative path, also when it does not exist yet', () => {
  const s = setup();
  try {
    assert.equal(safeResolve(s.claude, 'skills/a/SKILL.md'), join(s.claude, 'skills', 'a', 'SKILL.md'));
  } finally { s.done(); }
});

for (const bad of [
  '../evil', 'a/../../evil', 'a/..', '..', '/etc/passwd', 'C:\\x', 'C:/x', 'a\\..\\b', 'a/./b', './a', 'a//b', 'a/', '', '.',
  'a\0b', '.claude/../../x',
]) {
  test(`rejects hostile path ${JSON.stringify(bad)}`, () => {
    const s = setup();
    try {
      assert.throws(() => safeResolve(s.claude, bad), /unsafe path|invalid path/i);
    } finally { s.done(); }
  });
}

test('rejects non-strings', () => {
  const s = setup();
  try {
    for (const v of [undefined, null, 5, {}, ['a']]) assert.throws(() => safeResolve(s.claude, v), /invalid path/i);
  } finally { s.done(); }
});

test('URL-encoded traversal is a literal name and stays inside', () => {
  const s = setup();
  try {
    assert.equal(safeResolve(s.claude, '%2e%2e/evil'), join(s.claude, '%2e%2e', 'evil'));
  } finally { s.done(); }
});

test('rejects wavework-owned files unless explicitly allowed (case-insensitive)', () => {
  const s = setup();
  try {
    for (const name of ['wavework.json', 'wavework.lock.json', 'settings.json', 'Wavework.JSON']) {
      assert.throws(() => safeResolve(s.claude, name), /reserved/i);
    }
    assert.equal(safeResolve(s.claude, 'wavework.lock.json', { allowReserved: true }), join(s.claude, 'wavework.lock.json'));
  } finally { s.done(); }
});

test('rejects a symlinked directory on the path that points outside', () => {
  const s = setup();
  try {
    symlinkSync(s.outside, join(s.claude, 'skills'));
    assert.throws(() => safeResolve(s.claude, 'skills/a/SKILL.md'), /symlink/i);
  } finally { s.done(); }
});

test('rejects a symlinked directory even when it points inside .claude', () => {
  const s = setup();
  try {
    mkdirSync(join(s.claude, 'real'));
    symlinkSync(join(s.claude, 'real'), join(s.claude, 'link'));
    assert.throws(() => safeResolve(s.claude, 'link/x.md'), /symlink/i);
  } finally { s.done(); }
});

test('rejects a symlinked target file (no writing through it)', () => {
  const s = setup();
  try {
    writeFileSync(join(s.outside, 'victim'), 'x');
    mkdirSync(join(s.claude, 'skills'));
    symlinkSync(join(s.outside, 'victim'), join(s.claude, 'skills', 'f.md'));
    assert.throws(() => safeResolve(s.claude, 'skills/f.md'), /symlink/i);
  } finally { s.done(); }
});

test('rejects a dangling symlink', () => {
  const s = setup();
  try {
    symlinkSync(join(s.outside, 'nope'), join(s.claude, 'dangling'));
    assert.throws(() => safeResolve(s.claude, 'dangling'), /symlink/i);
  } finally { s.done(); }
});

test('rejects when .claude itself is a symlink', () => {
  const repo = tempDir();
  const outside = tempDir('wavework-outside-');
  try {
    symlinkSync(outside, join(repo, '.claude'));
    assert.throws(() => safeResolve(join(repo, '.claude'), 'a.md'), /symlink/i);
  } finally { cleanup(repo, outside); }
});

test('rejects a regular file used as a directory component', () => {
  const s = setup();
  try {
    writeFileSync(join(s.claude, 'file'), 'x');
    assert.throws(() => safeResolve(s.claude, 'file/child'), /not a directory/i);
  } finally { s.done(); }
});

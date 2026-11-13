import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveTokensFile } from '../../templates/dashboard/lib/tokens.mjs';

const tmp = () => realpathSync(mkdtempSync(path.join(tmpdir(), 'dash-tokens-')));

function repo() {
  const root = tmp();
  mkdirSync(path.join(root, 'ui'));
  writeFileSync(path.join(root, 'ui', 'tokens.css'), ':root{--a:1}');
  return root;
}

test('resolves a plain repo-relative CSS file to its real path', () => {
  const root = repo();
  assert.equal(resolveTokensFile(root, 'ui/tokens.css'), path.join(root, 'ui', 'tokens.css'));
});

test('missing file, directory and non-string input resolve to null', () => {
  const root = repo();
  for (const rel of ['ui/nope.css', 'ui', undefined, null, 5, '']) assert.equal(resolveTokensFile(root, rel), null, String(rel));
});

test('malicious paths are refused: traversal, absolute, encoded, backslash, NUL, empty and dot segments', () => {
  const root = repo();
  const outside = path.join(tmp(), 'secret.css');
  writeFileSync(outside, 'secret');
  for (const rel of ['../x.css', 'ui/../../x.css', 'ui/../tokens.css', outside, '/etc/passwd', 'ui//tokens.css', './ui/tokens.css', 'ui/./tokens.css',
    'ui\\tokens.css', 'ui/tokens.css\0', 'C:/x.css', '%2e%2e/x.css']) {
    assert.equal(resolveTokensFile(root, rel), null, JSON.stringify(rel));
  }
});

test('a symlink that leaves the repo is refused, file link and directory link', () => {
  const root = repo();
  const outsideDir = tmp();
  writeFileSync(path.join(outsideDir, 'secret.css'), 'secret');
  symlinkSync(path.join(outsideDir, 'secret.css'), path.join(root, 'ui', 'link.css'));
  symlinkSync(outsideDir, path.join(root, 'linked-dir'));
  assert.equal(resolveTokensFile(root, 'ui/link.css'), null);
  assert.equal(resolveTokensFile(root, 'linked-dir/secret.css'), null);
});

test('a symlink that stays inside the repo is allowed and resolves to the real file', () => {
  const root = repo();
  symlinkSync(path.join(root, 'ui', 'tokens.css'), path.join(root, 'ui', 'alias.css'));
  assert.equal(resolveTokensFile(root, 'ui/alias.css'), path.join(root, 'ui', 'tokens.css'));
});

test('only .css files are served, whatever config.json says', () => {
  const root = repo();
  writeFileSync(path.join(root, 'ui', 'notes.txt'), 'x');
  writeFileSync(path.join(root, '.env'), 'SECRET=1');
  for (const rel of ['ui/notes.txt', '.env', 'ui/tokens.css.bak', 'ui/tokens']) assert.equal(resolveTokensFile(root, rel), null, rel);
});

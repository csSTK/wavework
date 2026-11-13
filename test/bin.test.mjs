import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('bin/wavework.mjs --version prints the package version', () => {
  const stdout = execFileSync(process.execPath, ['bin/wavework.mjs', '--version'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(stdout, `${pkg.version}\n`);
});

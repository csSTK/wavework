import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const ALLOWED_PREFIXES = ['bin/', 'src/', 'templates/'];
const ALLOWED_FILES = ['README.md', 'LICENSE', 'CHANGELOG.md', 'package.json'];

test('npm pack --dry-run only includes the whitelisted paths', () => {
  const json = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const [result] = JSON.parse(json);
  const paths = result.files.map((f) => f.path);
  assert.ok(paths.includes('bin/wavework.mjs'), 'bin/wavework.mjs must be packed');
  for (const p of paths) {
    const ok = ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix)) || ALLOWED_FILES.includes(p);
    assert.ok(ok, `unexpected file in package: ${p}`);
  }
});

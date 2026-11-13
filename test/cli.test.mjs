import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.mjs';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);

function capture() {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    io: {
      stdout: { write: (s) => { out.stdout += s; } },
      stderr: { write: (s) => { out.stderr += s; } },
    },
  };
}

test('--version prints the package.json version and exits 0', async () => {
  const { out, io } = capture();
  assert.equal(await run(['--version'], io), 0);
  assert.equal(out.stdout, `${pkg.version}\n`);
  assert.equal(out.stderr, '');
});

test('-v is an alias for --version', async () => {
  const { out, io } = capture();
  assert.equal(await run(['-v'], io), 0);
  assert.equal(out.stdout, `${pkg.version}\n`);
});

test('--help prints usage and exits 0', async () => {
  const { out, io } = capture();
  assert.equal(await run(['--help'], io), 0);
  assert.match(out.stdout, /^Usage: wavework/m);
  assert.match(out.stdout, /init/);
  assert.match(out.stdout, /update/);
  assert.match(out.stdout, /dashboard/);
  assert.equal(out.stderr, '');
});

test('no arguments prints usage and exits 0', async () => {
  const { out, io } = capture();
  assert.equal(await run([], io), 0);
  assert.match(out.stdout, /^Usage: wavework/m);
});

test('unknown command prints usage to stderr and exits 1', async () => {
  const { out, io } = capture();
  assert.equal(await run(['frobnicate'], io), 1);
  assert.equal(out.stdout, '');
  assert.match(out.stderr, /unknown command: frobnicate/);
  assert.match(out.stderr, /Usage: wavework/);
});

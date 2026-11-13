import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig } from '../src/config.mjs';
import { renderTargets } from '../src/targets.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Runs the rendered scripts/red-green-check.test.sh (throwaway git repo, stubbed mvnw/pnpm, no Maven, pnpm
// or Docker needed) so CI covers argument parsing, test discovery and the RED / GREEN-ON-OLD classification.

const at = (...p) => fileURLToPath(new URL(`../${p.join('/')}`, import.meta.url));
const shipir = validateConfig(JSON.parse(readFileSync(at('examples', 'shipir.wavework.json'), 'utf8')));
const hasBash = spawnSync('bash', ['--version']).status === 0;
const opts = { skip: !hasBash && 'bash not available' };

function renderScripts(config) {
  const dir = mkdtempSync(join(tmpdir(), 'wavework-rg-'));
  for (const t of renderTargets(config)) {
    if (!t.target.startsWith('.claude/scripts/')) continue;
    const file = join(dir, t.target.split('/').pop());
    writeFileSync(file, t.content);
    chmodSync(file, t.mode);
  }
  return dir;
}

test('rendered red-green-check.test.sh passes against the rendered red-green-check.sh', opts, () => {
  const dir = renderScripts(shipir);
  try {
    const r = spawnSync('bash', [join(dir, 'red-green-check.test.sh')], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /all passed/);
    assert.doesNotMatch(r.stdout, /^FAIL/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rendered scripts are executable and syntactically valid bash', opts, () => {
  const dir = renderScripts(shipir);
  try {
    for (const name of ['red-green-check.sh', 'red-green-check.test.sh']) {
      assert.ok(statSync(join(dir, name)).mode & 0o100, `${name} not executable`);
      const r = spawnSync('bash', ['-n', join(dir, name)], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rendered script carries the area table of the config and needs no python', opts, () => {
  const dir = renderScripts(shipir);
  try {
    const script = readFileSync(join(dir, 'red-green-check.sh'), 'utf8');
    assert.match(script, /'backend\|maven\|backend'/);
    assert.match(script, /'frontend\|vitest\|frontend'/);
    assert.doesNotMatch(script, /python/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

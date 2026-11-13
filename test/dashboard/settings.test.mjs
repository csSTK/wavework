import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_PORT, projectName, readSettings, resolvePort } from '../../templates/dashboard/lib/settings.mjs';

const tmp = () => realpathSync(mkdtempSync(path.join(tmpdir(), 'dash-settings-')));
const withConfig = (text) => {
  const dir = tmp();
  if (text !== undefined) writeFileSync(path.join(dir, 'config.json'), text);
  return dir;
};

test('no config.json: defaults', () => {
  assert.deepEqual(readSettings(withConfig()), { port: DEFAULT_PORT, tokensFile: null });
  assert.equal(DEFAULT_PORT, 4690);
});

test('config.json supplies port and tokensFile', () => {
  assert.deepEqual(readSettings(withConfig('{"port":5123,"tokensFile":"ui/t.css"}')), { port: 5123, tokensFile: 'ui/t.css' });
  assert.deepEqual(readSettings(withConfig('{"port":5123,"tokensFile":null}')), { port: 5123, tokensFile: null });
});

test('broken or out-of-range config.json falls back to defaults per field', () => {
  assert.deepEqual(readSettings(withConfig('{nope')), { port: 4690, tokensFile: null });
  assert.deepEqual(readSettings(withConfig('{"port":80,"tokensFile":7}')), { port: 4690, tokensFile: null });
  assert.deepEqual(readSettings(withConfig('null')), { port: 4690, tokensFile: null });
});

test('PIPELINE_DASHBOARD_PORT overrides config.json; port 0 passes through for tests', () => {
  const dir = withConfig('{"port":5123}');
  assert.equal(resolvePort(dir, {}), 5123);
  assert.equal(resolvePort(dir, { PIPELINE_DASHBOARD_PORT: '6000' }), 6000);
  assert.equal(resolvePort(dir, { PIPELINE_DASHBOARD_PORT: '0' }), 0);
  assert.ok(Number.isNaN(resolvePort(dir, { PIPELINE_DASHBOARD_PORT: 'x' })));
});

test('projectName is the main checkout directory, also from a worktree; non-git falls back to the folder name', () => {
  const main = path.join(tmp(), 'my-app');
  mkdirSync(main);
  execFileSync('git', ['init', '-q', '-b', 'main', main]);
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: main });
  assert.equal(projectName(main), 'my-app');
  const wt = path.join(tmp(), 'my-app-feature');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'f', wt], { cwd: main });
  assert.equal(projectName(wt), 'my-app');
  const plain = path.join(tmp(), 'plain-dir');
  mkdirSync(plain);
  assert.equal(projectName(plain), 'plain-dir');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(root + rel, 'utf8');

/**
 * Every `npx wavework ...` and `npm ...` line inside a fenced code block of the README.
 * @param {string} markdown
 * @returns {string[]}
 */
export function extractCommands(markdown) {
  const commands = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    const cmd = line.trim();
    if (inFence && /^(npx wavework|npm) /.test(cmd)) commands.push(cmd);
  }
  return commands;
}

/**
 * How each README command is covered. Either `smoke`: the label, in double quotes, is a step of
 * scripts/smoke.sh (the CI smoke run of the packed CLI); or `test`: a test file under test/ that
 * exercises the command. A smoke label may stand for a README command that differs only in its
 * arguments (the upgrade line installs the same way as the first install).
 */
export const COVERAGE = {
  'npm i -D wavework': { smoke: 'npm i -D <tarball>' },
  'npm i -D wavework@latest': { smoke: 'npm i -D <tarball>' },
  'npx wavework --version': { smoke: 'npx wavework --version' },
  'npx wavework init': { smoke: 'npx wavework init' },
  'npx wavework init --config <file>': { smoke: 'npx wavework init --config <file>' },
  'npx wavework init --adopt --dry-run --config <file>': { smoke: 'npx wavework init --adopt --dry-run' },
  'npx wavework init --adopt --config <file>': { smoke: 'npx wavework init --adopt' },
  'npx wavework update --dry-run': { smoke: 'npx wavework update --dry-run' },
  'npx wavework update': { smoke: 'npx wavework update' },
  'npx wavework dashboard': { test: 'test/dashboard-cli.test.mjs' },
};

const readme = read('README.md');
const smoke = read('scripts/smoke.sh');
const commands = extractCommands(readme);

test('README has code-block commands to check', () => {
  assert.ok(commands.length >= 5, `expected several npx/npm commands in the README, found ${commands.length}`);
});

for (const cmd of [...new Set(commands)]) {
  test(`README command "${cmd}" is covered by the smoke run or a test`, () => {
    const entry = COVERAGE[cmd];
    assert.ok(entry, `README command "${cmd}" has no entry in COVERAGE (test/readme.test.mjs): add a smoke step or a test`);
    if (entry.smoke !== undefined) {
      assert.ok(
        smoke.includes(`"${entry.smoke}"`),
        `scripts/smoke.sh has no step labelled "${entry.smoke}" (for README command "${cmd}")`,
      );
    } else {
      assert.ok(entry.test?.startsWith('test/') && entry.test.endsWith('.test.mjs'), `"${cmd}": test must be a test/*.test.mjs file`);
      assert.ok(statSync(root + entry.test).isFile(), `"${cmd}": test file ${entry.test} does not exist`);
    }
  });
}

test('COVERAGE has no entries for commands the README no longer has', () => {
  const stale = Object.keys(COVERAGE).filter((cmd) => !commands.includes(cmd));
  assert.deepEqual(stale, []);
});

test('scripts/smoke.sh is valid bash', () => {
  execFileSync('bash', ['-n', root + 'scripts/smoke.sh'], { stdio: 'pipe' });
});

test('extractCommands reads only fenced npx wavework and npm lines', () => {
  const md = [
    'npx wavework outside',
    '```bash',
    'npm i -D wavework',
    '  npx wavework init  ',
    'git add .claude/',
    '```',
    '```',
    'npm test',
    '```',
  ].join('\n');
  assert.deepEqual(extractCommands(md), ['npm i -D wavework', 'npx wavework init', 'npm test']);
});

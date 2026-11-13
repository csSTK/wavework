import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, loadConfig, DEFAULTS } from '../src/config.mjs';

const area = (over = {}) => ({
  name: 'backend',
  dir: 'backend',
  whenPaths: ['backend/'],
  focused: 'mvn test',
  full: 'mvn verify',
  ...over,
});
const minimal = (over = {}) => ({ baseBranch: 'main', checks: [area()], ...over });

function errorOf(raw) {
  try {
    validateConfig(raw);
  } catch (e) {
    return e.message;
  }
  assert.fail('expected validateConfig to throw');
}

test('minimal config gets all defaults', () => {
  const c = validateConfig(minimal());
  assert.equal(c.baseBranch, 'main');
  assert.deepEqual(c.worktree, DEFAULTS.worktree);
  assert.equal(c.worktree.pathPattern, '../{repo}-{unit}');
  assert.equal(c.worktree.branchPattern, '{prefix}/{unit}-{slug}');
  assert.equal(c.models.planning, 'opus');
  assert.equal(c.models.orchestration, 'opus');
  assert.equal(c.models.implementers.default, 'sonnet');
  assert.deepEqual(c.tracker, { kind: 'beads' });
  assert.equal(c.attribution.allowAiTrailer, false);
  assert.equal(c.codeMap, undefined);
  assert.equal(c.uiSkill, undefined);
  assert.ok(c.findings.epicTitles.security);
});

test('defaults are not shared between results', () => {
  const a = validateConfig(minimal());
  a.worktree.pathPattern = 'x/{unit}';
  assert.equal(validateConfig(minimal()).worktree.pathPattern, '../{repo}-{unit}');
});

test('full config round-trips unchanged', () => {
  const full = JSON.parse(
    readFileSync(fileURLToPath(new URL('../examples/shipir.wavework.json', import.meta.url)), 'utf8'),
  );
  assert.deepEqual(validateConfig(full), full);
});

test('partial nested objects get their missing fields filled', () => {
  const c = validateConfig(minimal({ worktree: { pathPattern: '../wt-{unit}' } }));
  assert.equal(c.worktree.pathPattern, '../wt-{unit}');
  assert.equal(c.worktree.branchPattern, '{prefix}/{unit}-{slug}');
});

test('non-object config is rejected', () => {
  assert.match(errorOf([]), /\(root\): expected an object/);
  assert.match(errorOf(null), /\(root\): expected an object/);
});

test('missing baseBranch', () => {
  assert.match(errorOf({ checks: [area()] }), /baseBranch: required/);
});

test('unknown placeholder in a pattern', () => {
  assert.match(
    errorOf(minimal({ worktree: { pathPattern: '../{repo}-{unit}-{slug}' } })),
    /worktree\.pathPattern: unknown placeholder \{slug\} \(allowed: \{repo\}, \{unit\}\)/,
  );
  assert.match(
    errorOf(minimal({ worktree: { branchPattern: '{prefix}/{unit}-{nope}' } })),
    /worktree\.branchPattern: unknown placeholder \{nope\}/,
  );
});

test('pattern without {unit}', () => {
  assert.match(
    errorOf(minimal({ worktree: { pathPattern: '../{repo}' } })),
    /worktree\.pathPattern: must contain \{unit\}/,
  );
  assert.match(
    errorOf(minimal({ worktree: { branchPattern: '{prefix}/{slug}' } })),
    /worktree\.branchPattern: must contain \{unit\}/,
  );
});

test('unknown keys at top level and nested', () => {
  assert.match(errorOf(minimal({ extra: 1 })), /extra: unknown key/);
  assert.match(errorOf(minimal({ worktree: { foo: 1 } })), /worktree\.foo: unknown key/);
  assert.match(
    errorOf(minimal({ checks: [area({ bogus: 'x' })] })),
    /checks\[0\]\.bogus: unknown key/,
  );
  assert.match(
    errorOf(minimal({ models: { implementers: { nope: 1 } } })),
    /models\.implementers\.nope: unknown key/,
  );
});

test('wrong types give precise errors', () => {
  assert.match(errorOf(minimal({ baseBranch: 5 })), /baseBranch: expected a non-empty string, got number/);
  assert.match(errorOf(minimal({ baseBranch: '' })), /baseBranch: expected a non-empty string/);
  assert.match(errorOf(minimal({ checks: 'x' })), /checks: expected an array, got string/);
  assert.match(errorOf(minimal({ checks: [] })), /checks: must contain at least one area/);
  assert.match(errorOf(minimal({ checks: [area({ whenPaths: 'backend/' })] })), /checks\[0\]\.whenPaths: expected an array, got string/);
  assert.match(errorOf(minimal({ checks: [area({ whenPaths: ['a', 3] })] })), /checks\[0\]\.whenPaths\[1\]: expected a non-empty string, got number/);
  assert.match(errorOf(minimal({ checks: [area({ lint: 1 })] })), /checks\[0\]\.lint: expected a non-empty string, got number/);
  assert.match(errorOf(minimal({ attribution: { allowAiTrailer: 'no' } })), /attribution\.allowAiTrailer: expected a boolean, got string/);
  assert.match(errorOf(minimal({ worktree: 'x' })), /worktree: expected an object, got string/);
  assert.match(errorOf(minimal({ models: { implementers: { rules: { haiku: 1 } } } })), /models\.implementers\.rules\.haiku: expected a non-empty string, got number/);
  assert.match(errorOf(minimal({ uiSkill: { name: 'x' } })), /uiSkill\.appliesTo: required/);
  assert.match(errorOf(minimal({ codeMap: {} })), /codeMap\.path: required/);
});

test('missing required area fields', () => {
  const { focused, ...rest } = area();
  assert.match(errorOf(minimal({ checks: [rest] })), /checks\[0\]\.focused: required/);
});

test('duplicate area names', () => {
  assert.match(
    errorOf(minimal({ checks: [area(), area({ dir: 'other' })] })),
    /checks\[1\]\.name: duplicate area name "backend"/,
  );
});

test('tracker kind must be beads', () => {
  assert.match(errorOf(minimal({ tracker: { kind: 'jira' } })), /tracker\.kind: must be "beads", got "jira"/);
});

test('findings epicTitles must map to non-empty strings', () => {
  assert.match(errorOf(minimal({ findings: { epicTitles: { bugs: 1 } } })), /findings\.epicTitles\.bugs: expected a non-empty string, got number/);
});

test('all problems are reported together', () => {
  const msg = errorOf({ extra: true, worktree: { pathPattern: '../x' }, tracker: { kind: 'x' } });
  assert.match(msg, /baseBranch: required/);
  assert.match(msg, /checks: required/);
  assert.match(msg, /extra: unknown key/);
  assert.match(msg, /worktree\.pathPattern: must contain \{unit\}/);
  assert.match(msg, /tracker\.kind/);
  assert.match(msg, /\(5 problems\)/);
});

test('loadConfig reads .claude/wavework.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wavework-'));
  try {
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'wavework.json'), JSON.stringify(minimal()));
    assert.equal(loadConfig(dir).baseBranch, 'main');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig: missing file names the path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wavework-'));
  try {
    assert.throws(() => loadConfig(dir), (e) => e.message.includes(join(dir, '.claude', 'wavework.json')) && /not found/.test(e.message));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig: invalid JSON names the path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wavework-'));
  try {
    mkdirSync(join(dir, '.claude'));
    const file = join(dir, '.claude', 'wavework.json');
    writeFileSync(file, '{ nope');
    assert.throws(() => loadConfig(dir), (e) => e.message.includes(file) && /not valid JSON/.test(e.message));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig: invalid config names the path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wavework-'));
  try {
    mkdirSync(join(dir, '.claude'));
    const file = join(dir, '.claude', 'wavework.json');
    writeFileSync(file, '{}');
    assert.throws(() => loadConfig(dir), (e) => e.message.includes(file) && /baseBranch: required/.test(e.message));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('examples/shipir.wavework.json validates', () => {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL('../examples/shipir.wavework.json', import.meta.url)), 'utf8'),
  );
  assert.doesNotThrow(() => validateConfig(raw));
});

test('stray or unbalanced braces in a pattern', () => {
  for (const bad of ['{unit{', '{unit}}', '{{unit}}']) {
    assert.match(
      errorOf(minimal({ worktree: { pathPattern: bad } })),
      /worktree\.pathPattern: unbalanced or stray brace/,
      bad,
    );
  }
});

test('__proto__ key is rejected in string maps', () => {
  const raw = JSON.parse('{"baseBranch":"main","checks":[],"findings":{"epicTitles":{"__proto__":"x"}},"models":{"implementers":{"rules":{"__proto__":"x"}}}}');
  raw.checks = [area()];
  const msg = errorOf(raw);
  assert.match(msg, /findings\.epicTitles\.__proto__: reserved key/);
  assert.match(msg, /models\.implementers\.rules\.__proto__: reserved key/);
});

test('whenPaths must be relative prefixes without ..', () => {
  assert.match(errorOf(minimal({ checks: [area({ whenPaths: ['/etc'] })] })), /checks\[0\]\.whenPaths\[0\]: must be relative to the repo root \(no leading \/\)/);
  assert.match(errorOf(minimal({ checks: [area({ whenPaths: ['a/../b'] })] })), /checks\[0\]\.whenPaths\[0\]: must not contain \.\. segments/);
  assert.match(errorOf(minimal({ checks: [area({ whenPaths: ['..'] })] })), /must not contain \.\. segments/);
});

test('checks[].dir, codeMap.path and uiSkill.appliesTo must be repo-relative (no leading /, no .. segments)', () => {
  const bad = [
    [{ checks: [area({ dir: '/etc' })] }, /checks\[0\]\.dir: .*relative/],
    [{ checks: [area({ dir: '../x' })] }, /checks\[0\]\.dir: .*\.\./],
    [{ codeMap: { path: '/abs/MAP.md' } }, /codeMap\.path: .*relative/],
    [{ codeMap: { path: 'a/../../MAP.md' } }, /codeMap\.path: .*\.\./],
    [{ uiSkill: { name: 'x', appliesTo: ['../ui/'] } }, /uiSkill\.appliesTo\[0\]: .*\.\./],
    [{ uiSkill: { name: 'x', appliesTo: ['/ui/'] } }, /uiSkill\.appliesTo\[0\]: .*relative/],
  ];
  for (const [patch, re] of bad) assert.match(errorOf(minimal(patch)), re);
  assert.doesNotThrow(() => validateConfig(minimal({ codeMap: { path: 'docs/CODE_MAP.md' }, uiSkill: { name: 'x', appliesTo: ['frontend/'] }, checks: [area({ dir: '.' })] })));
});

test('"." means the whole repo; "./" and "." segments are rejected consistently', () => {
  assert.doesNotThrow(() => validateConfig(minimal({ checks: [area({ dir: '.', whenPaths: ['.'] })] })));
  assert.doesNotThrow(() => validateConfig(minimal({ checks: [area({ whenPaths: ['frontend/', 'a/b'] })] })));
  for (const bad of ['./', './a', 'a/./b']) {
    assert.match(errorOf(minimal({ checks: [area({ whenPaths: [bad] })] })), /whenPaths\[0\]: .*"\."/);
  }
});

// ---------- dashboard ----------

test('dashboard defaults: enabled, port 4690, no tokensFile', () => {
  const c = validateConfig(minimal());
  assert.deepEqual(c.dashboard, { enabled: true, port: 4690 });
  assert.deepEqual(c.dashboard, DEFAULTS.dashboard);
  assert.deepEqual(validateConfig(minimal({ dashboard: {} })).dashboard, { enabled: true, port: 4690 });
});

test('dashboard accepts enabled, port and tokensFile', () => {
  const c = validateConfig(minimal({ dashboard: { enabled: false, port: 5000, tokensFile: 'frontend/src/tokens.css' } }));
  assert.deepEqual(c.dashboard, { enabled: false, port: 5000, tokensFile: 'frontend/src/tokens.css' });
});

test('dashboard rejects unknown keys, wrong types and bad ports', () => {
  assert.match(errorOf(minimal({ dashboard: { theme: 'x' } })), /dashboard\.theme: unknown key/);
  assert.match(errorOf(minimal({ dashboard: 'on' })), /dashboard: expected an object, got string/);
  assert.match(errorOf(minimal({ dashboard: { enabled: 'yes' } })), /dashboard\.enabled: expected a boolean/);
  for (const bad of [80, 1023, 65536, 4690.5, '4690', null]) {
    assert.match(errorOf(minimal({ dashboard: { port: bad } })), /dashboard\.port: expected an integer from 1024 to 65535/, String(bad));
  }
  for (const ok of [1024, 4690, 65535]) assert.doesNotThrow(() => validateConfig(minimal({ dashboard: { port: ok } })));
});

test('dashboard.tokensFile must be a repo-relative path to a .css file', () => {
  assert.match(errorOf(minimal({ dashboard: { tokensFile: '/etc/x.css' } })), /dashboard\.tokensFile: .*relative/);
  assert.match(errorOf(minimal({ dashboard: { tokensFile: '../x.css' } })), /dashboard\.tokensFile: .*\.\./);
  assert.match(errorOf(minimal({ dashboard: { tokensFile: 'a/./x.css' } })), /dashboard\.tokensFile: .*"\."/);
  assert.match(errorOf(minimal({ dashboard: { tokensFile: 'styles/tokens.txt' } })), /dashboard\.tokensFile: must end in \.css/);
  assert.match(errorOf(minimal({ dashboard: { tokensFile: 'a\\b.css' } })), /dashboard\.tokensFile: .*backslash/);
  assert.match(errorOf(minimal({ dashboard: { tokensFile: 5 } })), /dashboard\.tokensFile: expected a non-empty string/);
});

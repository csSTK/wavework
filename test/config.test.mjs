import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, loadConfig, DEFAULTS, codeMapLayout, assertCodeMapOnDisk } from '../src/config.mjs';

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

// ---------- codeMap layouts (0.2.0) ----------

const withMap = (codeMap, extra = {}) => minimal({ codeMap, ...extra });

test('codeMap.path ending in .md is the single-file layout and stays exactly as before', () => {
  assert.deepEqual(validateConfig(withMap({ path: 'docs/CODE_MAP.md' })).codeMap, { path: 'docs/CODE_MAP.md' });
  assert.equal(codeMapLayout('docs/CODE_MAP.md'), 'file');
  assert.equal(codeMapLayout('MAP.MD'), 'file');
});

test('codeMap.path without .md is the folder layout; maxDescription defaults to 160', () => {
  assert.deepEqual(validateConfig(withMap({ path: 'docs/code-map' })).codeMap, { path: 'docs/code-map', maxDescription: 160 });
  assert.equal(codeMapLayout('docs/code-map'), 'folder');
  assert.equal(validateConfig(withMap({ path: 'docs/code-map', maxDescription: 80 })).codeMap.maxDescription, 80);
});

test('codeMap folder path: trailing slash is stripped, "." (whole repo) and unsafe paths are rejected', () => {
  assert.equal(validateConfig(withMap({ path: 'docs/code-map/' })).codeMap.path, 'docs/code-map');
  assert.match(errorOf(withMap({ path: '.' })), /codeMap\.path: .*folder.*not "\."/);
  assert.match(errorOf(withMap({ path: '../map' })), /codeMap\.path: .*\.\./);
  assert.match(errorOf(withMap({ path: '/abs/map' })), /codeMap\.path: .*relative/);
  assert.match(errorOf(withMap({ path: 'docs/./map' })), /codeMap\.path: .*"\."/);
  assert.match(errorOf(withMap({ path: 'docs\\..\\map' })), /codeMap\.path: .*\.\./);
});

test('codeMap.maxDescription must be an integer from 20 to 1000 and only applies to the folder layout', () => {
  for (const bad of [0, 19, 1001, 1.5, '160', null, true]) {
    assert.match(errorOf(withMap({ path: 'docs/code-map', maxDescription: bad })), /codeMap\.maxDescription: expected an integer from 20 to 1000/, String(bad));
  }
  assert.match(errorOf(withMap({ path: 'docs/MAP.md', maxDescription: 100 })), /codeMap\.maxDescription: only applies to the folder layout/);
  assert.match(errorOf(withMap({ path: 'docs/code-map', bogus: 1 })), /codeMap\.bogus: unknown key/);
});

test('tracker.idPrefix is optional, normalised to end in "-", and must look like a bead ID prefix', () => {
  assert.equal(validateConfig(minimal()).tracker.idPrefix, undefined);
  assert.deepEqual(validateConfig(minimal({ tracker: { kind: 'beads' } })).tracker, { kind: 'beads' });
  assert.equal(validateConfig(minimal({ tracker: { idPrefix: 'shipr' } })).tracker.idPrefix, 'shipr-');
  assert.equal(validateConfig(minimal({ tracker: { idPrefix: 'my-proj-' } })).tracker.idPrefix, 'my-proj-');
  for (const bad of ['', 'a b', '-x', 'x/y', 'a.b', 5]) {
    assert.match(errorOf(minimal({ tracker: { idPrefix: bad } })), /tracker\.idPrefix/, String(bad));
  }
});

function mapRepo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wavework-map-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}
const mapProblem = (root, codeMap) => {
  try {
    assertCodeMapOnDisk(root, validateConfig(withMap(codeMap)));
  } catch (e) {
    return e.message;
  }
  return null;
};

test('assertCodeMapOnDisk: folder with index.md passes; no codeMap and the file layout are not checked', () => {
  const root = mapRepo({ 'docs/code-map/index.md': '# Code map\n' });
  try {
    assert.equal(mapProblem(root, { path: 'docs/code-map' }), null);
    assert.equal(mapProblem(root, { path: 'docs/code-map/' }), null);
    assert.equal(mapProblem(root, { path: 'docs/NOT_THERE.md' }), null);
    assert.doesNotThrow(() => assertCodeMapOnDisk(root, validateConfig(minimal())));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('assertCodeMapOnDisk: missing folder, missing index.md, file or directory in the wrong place fail with a clear error', () => {
  const root = mapRepo({ 'docs/code-map/root.md': '- x: y\n', 'docs/file': 'x', 'idx/code-map/index.md/inner.md': 'x' });
  try {
    assert.match(mapProblem(root, { path: 'docs/nowhere' }), /codeMap\.path "docs\/nowhere": folder does not exist.*index\.md/);
    assert.match(mapProblem(root, { path: 'docs/code-map' }), /codeMap\.path "docs\/code-map": must contain index\.md/);
    for (const p of ['docs/nowhere', 'docs/code-map']) assert.match(mapProblem(root, { path: p }), /a codeMap\.path without \.md is a folder; for a single file add the \.md suffix/, p);
    assert.match(mapProblem(root, { path: 'docs/file' }), /codeMap\.path "docs\/file": must be a folder/);
    assert.match(mapProblem(root, { path: 'idx/code-map' }), /index\.md must be a regular file/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('assertCodeMapOnDisk: a symlinked folder or index.md (also one leaving the repo) is refused', () => {
  const root = mapRepo({ 'real/index.md': '# x\n' });
  const outside = mapRepo({ 'index.md': '# outside\n' });
  try {
    mkdirSync(join(root, 'docs'));
    symlinkSync(outside, join(root, 'docs/linked'));
    symlinkSync(join(root, 'real'), join(root, 'docs/inside'));
    mkdirSync(join(root, 'docs/sub'));
    symlinkSync(join(outside, 'index.md'), join(root, 'docs/sub/index.md'));
    assert.match(mapProblem(root, { path: 'docs/linked' }), /symlink/);
    assert.match(mapProblem(root, { path: 'docs/inside' }), /symlink/);
    assert.match(mapProblem(root, { path: 'docs/sub' }), /symlink/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('codeMap folder path may only contain letters, digits and . _ - / (it ends up in a command line)', () => {
  for (const bad of ['docs/code map', 'docs/code;map', 'docs/$x', 'docs/"x"']) {
    assert.match(errorOf(withMap({ path: bad })), /codeMap\.path: .*may only contain/, bad);
  }
});

test('codeMap folder path must not start with "-" (the checker would read it as an option)', () => {
  for (const bad of ['-docs/map', '--max']) assert.match(errorOf(withMap({ path: bad })), /codeMap\.path: .*must not start with "-"/, bad);
  assert.doesNotThrow(() => validateConfig(withMap({ path: 'docs/-map' })));
});

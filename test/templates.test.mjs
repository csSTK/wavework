import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../src/config.mjs';
import { buildContext } from '../src/context.mjs';
import { render } from '../src/render.mjs';
import { lineDiff } from './helpers/linediff.mjs';

const at = (...p) => fileURLToPath(new URL(`../${p.join('/')}`, import.meta.url));

const SKILLS = [
  'next-task', 'next-task-batch', 'next-task-beads', 'next-task-branch', 'next-task-code',
  'next-task-deps', 'next-task-e2e', 'next-task-findings', 'next-task-finish', 'next-task-implement',
  'next-task-plan', 'next-task-review', 'next-task-test', 'next-task-write-tests',
  'text-to-task', 'watch-ci',
];
const template = (skill) => readFileSync(at('templates', 'skills', skill, 'SKILL.md'), 'utf8');

const shipirConfig = validateConfig(JSON.parse(readFileSync(at('examples', 'shipir.wavework.json'), 'utf8')));
// Golden runs keep Shipir's dashboard Record lines and its repo name so the diff only shows real generalisations.
const shipirContext = buildContext(shipirConfig, { repoName: 'shipir', dashboard: true });
const minimalContext = buildContext(validateConfig({
  baseBranch: 'main',
  checks: [{ name: 'app', dir: '.', whenPaths: ['src/'], focused: 'npm test', full: 'npm test' }],
}));
const UPDATE = process.env.UPDATE_GOLDEN === '1';

test('every skill has a template and no unknown skill sneaks in', () => {
  const dirs = readdirSync(at('templates', 'skills')).sort();
  assert.deepEqual(dirs, [...SKILLS].sort());
  assert.equal(existsSync(at('templates', '.gitkeep')), false);
});

test('templates and golden sources use LF line endings', () => {
  for (const s of SKILLS) {
    assert.ok(!template(s).includes('\r'), `${s} template has CR`);
    assert.ok(!readFileSync(at('test', 'golden', 'shipir-source', `${s}.md`), 'utf8').includes('\r'), `${s} source has CR`);
  }
});

for (const skill of SKILLS) {
  test(`golden: ${skill} rendered with the Shipir config differs from the Shipir skill only as recorded`, () => {
    const rendered = render(template(skill), shipirContext, skill);
    assert.ok(!rendered.includes('\r'));
    const source = readFileSync(at('test', 'golden', 'shipir-source', `${skill}.md`), 'utf8');
    const diff = lineDiff(source, rendered);
    const file = at('test', 'golden', 'shipir-diff', `${skill}.diff`);
    if (UPDATE) writeFileSync(file, diff);
    assert.equal(diff, readFileSync(file, 'utf8'), `${skill}: rendered output drifted from test/golden/shipir-diff/${skill}.diff (review, then UPDATE_GOLDEN=1)`);
  });
}

test('porting.md documents every skill whose output differs from Shipir', () => {
  const doc = readFileSync(at('docs', 'porting.md'), 'utf8');
  for (const skill of SKILLS) {
    const diff = readFileSync(at('test', 'golden', 'shipir-diff', `${skill}.diff`), 'utf8');
    if (diff !== '') assert.match(doc, new RegExp(`^## ${skill}$`, 'm'), `docs/porting.md lacks "## ${skill}"`);
  }
});

for (const skill of SKILLS) {
  test(`minimal config: ${skill} leaves no placeholders, empty sections or bad values`, () => {
    const out = render(template(skill), minimalContext, skill);
    assert.doesNotMatch(out, /\{\{|\}\}/, 'leftover braces');
    assert.doesNotMatch(out, /\bundefined\b|\bnull\b|\[object Object\]/, 'undefined/null value');
    assert.doesNotMatch(out, /(^|[^`])``([^`]|$)/, 'empty inline code (a command is missing)');
    assert.doesNotMatch(out, /(^|\n)\s*(Run|Focused|Full|Lint|Build|E2E)[:*\s]*$/m, 'label without a command');
    assert.doesNotMatch(out, /record\.mjs|pipeline-dashboard/, 'dashboard text without dashboard');
    assert.doesNotMatch(out, /CODE_MAP|apple-design/, 'optional section leaked');
    const lines = out.split('\n');
    lines.forEach((line, i) => {
      if (!/^#{1,6} /.test(line)) return;
      const next = lines.slice(i + 1).find((l) => l.trim() !== '');
      assert.ok(next !== undefined && !/^#{1,6} /.test(next), `empty heading "${line}"`);
    });
    assert.match(out, /^---\nname: [\w-]+\ndescription: \S[^\n]*\n---\n/, 'frontmatter intact (name, non-empty description, closing ---)');
  });
}

test('minimal config still renders the main branch and model names', () => {
  const out = render(template('next-task-branch'), minimalContext, 'next-task-branch');
  assert.match(out, /origin\/main/);
  assert.doesNotMatch(out, /origin\/dev/);
});

test('Shipir config keeps the optional sections', () => {
  const out = render(template('next-task-code'), shipirContext, 'next-task-code');
  assert.match(out, /docs\/CODE_MAP\.md/);
  assert.match(out, /apple-design/);
});

test('skills whose Shipir guidance moved to CLAUDE.md point the agent there', () => {
  const expected = {
    'next-task-write-tests': /test conventions[^\n]*CLAUDE\.md/,
    'next-task-e2e': /e2e conventions[^\n]*CLAUDE\.md/,
    'next-task-test': /CLAUDE\.md.*force the \*\*Full\*\* command/,
    'next-task-deps': /CLAUDE\.md.*dependency-update commands/,
  };
  for (const [skill, re] of Object.entries(expected)) {
    // the e2e skill only has conventions when an area configures e2e
    for (const ctx of skill === 'next-task-e2e' ? [shipirContext] : [minimalContext, shipirContext]) {
      assert.match(render(template(skill), ctx, skill), re, `${skill} lacks the CLAUDE.md pointer`);
    }
  }
});

test('next-task-test runs the lint command of an area only when one is configured', () => {
  const withoutLint = render(template('next-task-test'), minimalContext, 'next-task-test');
  assert.doesNotMatch(withoutLint, /Lint/);
  const withLint = render(template('next-task-test'), shipirContext, 'next-task-test');
  assert.match(withLint, /also run its \*\*Lint\*\* command/);
  assert.match(withLint, /- \*\*Lint:\*\* `pnpm lint`/);
});

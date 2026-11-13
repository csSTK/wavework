import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../src/config.mjs';
import { buildContext } from '../src/context.mjs';
import { render } from '../src/render.mjs';
import { templateTargets, renderTargets } from '../src/targets.mjs';
import { lineDiff } from './helpers/linediff.mjs';

const at = (...p) => fileURLToPath(new URL(`../${p.join('/')}`, import.meta.url));
const shipirConfig = validateConfig(JSON.parse(readFileSync(at('examples', 'shipir.wavework.json'), 'utf8')));
const minimalConfig = validateConfig({
  baseBranch: 'main',
  checks: [{ name: 'app', dir: '.', whenPaths: ['src/'], focused: 'npm test', full: 'npm test' }],
});
const UPDATE = process.env.UPDATE_GOLDEN === '1';

// Agents and scripts added in shipr-p9ge.4; all skills (also text-to-task, watch-ci) are covered by templates.test.mjs.
const NEW = ['implementer-sonnet.md', 'implementer-haiku.md', 'red-green-check.sh', 'red-green-check.test.sh'];
const skill = (targets, name) => targets.find((t) => t.target === `.claude/skills/${name}/SKILL.md`);
const base = (target) => target.split('/').pop();
const byBase = (targets) => Object.fromEntries(targets.map((t) => [base(t.target), t]));

test('templateTargets covers every template file exactly once', () => {
  const targets = templateTargets(shipirConfig);
  const listed = targets.map((t) => t.template).sort();
  const onDisk = [];
  const walk = (dir) => {
    for (const e of readdirSync(at('templates', dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`);
      else if (e.name !== '.gitkeep') onDisk.push(`${dir}/${e.name}`);
    }
  };
  for (const top of ['skills', 'agents', 'scripts']) walk(top);
  // the agent template appears once per implementer model, so compare as sets
  assert.deepEqual([...new Set(listed)], onDisk.sort());
  for (const t of targets) assert.ok(existsSync(at('templates', t.template)), t.template);
});

test('templateTargets: targets, modes and vars for the Shipir config', () => {
  const targets = templateTargets(shipirConfig);
  const targetsOf = targets.map((t) => t.target);
  assert.equal(new Set(targetsOf).size, targetsOf.length, 'targets are unique');
  assert.ok(targetsOf.every((t) => t.startsWith('.claude/') && !t.includes('..')));
  const m = Object.fromEntries(targets.map((t) => [t.target, t]));
  assert.equal(m['.claude/skills/next-task/SKILL.md'].mode, 0o644);
  assert.equal(m['.claude/skills/text-to-task/SKILL.md'].template, 'skills/text-to-task/SKILL.md');
  assert.equal(m['.claude/scripts/red-green-check.sh'].mode, 0o755);
  assert.equal(m['.claude/scripts/red-green-check.test.sh'].mode, 0o755);
  assert.equal(m['.claude/agents/implementer-sonnet.md'].mode, 0o644);
  assert.deepEqual(m['.claude/agents/implementer-haiku.md'].vars.agent.model, 'haiku');
  assert.equal(m['.claude/agents/implementer-haiku.md'].template, m['.claude/agents/implementer-sonnet.md'].template);
  assert.deepEqual(m['.claude/skills/next-task/SKILL.md'].vars, {});
});

test('templateTargets: one agent per implementer model, default included even without a rule', () => {
  const cfg = validateConfig({
    baseBranch: 'main',
    checks: minimalConfig.checks,
    models: { implementers: { default: 'opus-lite', rules: { fast: 'Quick fixes only.', deep: 'Hard problems.' } } },
  });
  const agents = templateTargets(cfg).filter((t) => t.target.startsWith('.claude/agents/')).map((t) => t.target);
  assert.deepEqual(agents.sort(), ['.claude/agents/implementer-deep.md', '.claude/agents/implementer-fast.md', '.claude/agents/implementer-opus-lite.md']);
});

test('templateTargets rejects model names that are unsafe as file names', () => {
  for (const bad of ['../evil', 'a/b', 'a b', '.hidden', 'x\\y']) {
    const cfg = validateConfig({ baseBranch: 'main', checks: minimalConfig.checks, models: { implementers: { default: 'sonnet', rules: { [bad]: 'x' } } } });
    assert.throws(() => templateTargets(cfg), /implementer model/, bad);
  }
});

test('renderTargets renders every target without leftovers (minimal config)', () => {
  const rendered = renderTargets(minimalConfig);
  assert.equal(rendered.length, templateTargets(minimalConfig).length);
  for (const r of rendered) {
    assert.doesNotMatch(r.content, /\{\{|\}\}/, r.target);
    if (!r.target.endsWith('.sh')) assert.doesNotMatch(r.content, /\bundefined\b|\[object Object\]/, r.target); // scripts contain JS
    assert.ok(!r.content.includes('\r'), r.target);
  }
});

for (const name of NEW) {
  test(`golden: ${name} rendered with the Shipir config differs from the Shipir original only as recorded`, () => {
    const t = byBase(templateTargets(shipirConfig))[name];
    assert.ok(t, `no target for ${name}`);
    const ctx = buildContext(shipirConfig, { repoName: 'shipir', dashboard: true });
    const rendered = render(readFileSync(at('templates', t.template), 'utf8'), { ...ctx, ...t.vars }, t.template);
    const source = readFileSync(at('test', 'golden', 'shipir-source', name), 'utf8');
    assert.ok(!source.includes('\r'));
    const diff = lineDiff(source, rendered);
    const file = at('test', 'golden', 'shipir-diff', `${name}.diff`);
    if (UPDATE) writeFileSync(file, diff);
    assert.equal(diff, readFileSync(file, 'utf8'), `${name}: drifted from test/golden/shipir-diff/${name}.diff (review, then UPDATE_GOLDEN=1)`);
  });
}

test('porting.md has a section for every new template whose output differs from Shipir', () => {
  const doc = readFileSync(at('docs', 'porting.md'), 'utf8');
  for (const name of NEW) {
    const diff = readFileSync(at('test', 'golden', 'shipir-diff', `${name}.diff`), 'utf8');
    const heading = name.replace(/\.md$/, '');
    if (diff !== '') assert.match(doc, new RegExp(`^## ${heading.replace(/\./g, '\\.')}$`, 'm'), `docs/porting.md lacks "## ${heading}"`);
  }
});

test('minimal config: text-to-task and watch-ci have intact frontmatter and no Shipir leftovers', () => {
  const rendered = renderTargets(minimalConfig);
  for (const name of ['text-to-task', 'watch-ci']) {
    const out = skill(rendered, name).content;
    assert.match(out, /^---\nname: [\w-]+\ndescription: \S[^\n]*\n---\n/, name);
    assert.doesNotMatch(out, /HANDOFF|CODE_MAP|apple-design|Flyway|ADMIN|OPERATOR|docker\/|compose\/|Shipir/, `${name} leaks Shipir/optional text`);
    assert.doesNotMatch(out, /(^|[^`])``([^`]|$)/, 'empty inline code');
  }
});

test('Shipir config keeps the optional UI and code-map hints in text-to-task', () => {
  const out = skill(renderTargets(shipirConfig, { repoName: 'shipir' }), 'text-to-task').content;
  assert.match(out, /apple-design/);
  assert.match(out, /docs\/CODE_MAP\.md/);
  assert.match(out, /model:haiku` or `model:sonnet`/);
});

test('agent files: frontmatter is valid YAML-ish, model and escalation come from config', () => {
  const agents = byBase(renderTargets(shipirConfig));
  const haiku = agents['implementer-haiku.md'].content;
  const sonnet = agents['implementer-sonnet.md'].content;
  assert.match(haiku, /^---\nname: implementer-haiku\ndescription: ".*"\nmodel: haiku\n---\n/);
  assert.match(sonnet, /^---\nname: implementer-sonnet\ndescription: ".*"\nmodel: sonnet\n---\n/);
  assert.match(haiku, /go to implementer-sonnet/);
  assert.doesNotMatch(sonnet, /go to implementer/);
  // a rule text with a colon and quotes must not break the frontmatter
  const cfg = validateConfig({ baseBranch: 'main', checks: minimalConfig.checks, models: { implementers: { default: 'sonnet', rules: { haiku: 'Small: "easy" things # only.', sonnet: 'Rest.' } } } });
  const out = byBase(renderTargets(cfg))['implementer-haiku.md'].content;
  const desc = out.match(/^description: (.*)$/m)[1];
  assert.equal(typeof JSON.parse(desc), 'string');
  assert.match(JSON.parse(desc), /Small: "easy" things # only\./);
});

test('agent files without a code map or tracker words in a minimal config', () => {
  const out = byBase(renderTargets(minimalConfig))['implementer-sonnet.md'].content;
  assert.doesNotMatch(out, /CODE_MAP/);
  assert.match(out, /next-task-implement\/SKILL\.md/);
});

test('red-green-check area table lists supported areas and marks others unsupported', () => {
  const cfg = validateConfig({
    baseBranch: 'main',
    checks: [
      { name: 'backend', dir: 'backend', whenPaths: ['backend/'], focused: "./backend/mvnw -f backend/pom.xml test -Dtest='x'", full: './backend/mvnw verify' },
      { name: 'frontend', dir: 'frontend', whenPaths: ['frontend/'], focused: 'pnpm vitest run <dirs>', full: 'pnpm test' },
      { name: 'tools', dir: 'tools', whenPaths: ['tools/'], focused: 'pytest', full: 'pytest' },
    ],
  });
  const ctx = buildContext(cfg);
  assert.deepEqual(ctx.redGreenAreas.split('\n').map((l) => l.trim()), ["'backend|maven|backend'", "'frontend|vitest|frontend'", "'tools|unsupported|tools'"]);
});

test('red-green-check area table rejects names or dirs it cannot represent', () => {
  for (const name of ['a|b', "it's"]) {
    const cfg = validateConfig({ baseBranch: 'main', checks: [{ name, dir: '.', whenPaths: ['src/'], focused: 'x', full: 'x' }] });
    assert.throws(() => buildContext(cfg), /area/, name);
  }
});

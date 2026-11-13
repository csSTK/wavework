import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../src/config.mjs';
import { buildContext } from '../src/context.mjs';

const shipirRaw = JSON.parse(
  readFileSync(fileURLToPath(new URL('../examples/shipir.wavework.json', import.meta.url)), 'utf8'),
);
const minimalRaw = {
  baseBranch: 'main',
  checks: [{ name: 'app', dir: '.', whenPaths: ['src/'], focused: 'npm test', full: 'npm test' }],
};
const shipir = (opts) => buildContext(validateConfig(shipirRaw), opts);
const minimal = (opts) => buildContext(validateConfig(minimalRaw), opts);

test('base branch and worktree expressions follow the patterns', () => {
  const c = shipir({ repoName: 'shipir' });
  assert.equal(c.baseBranch, 'dev');
  assert.equal(c.worktreeExpr, '$(dirname "$MAIN")/shipir-<unit-id>');
  assert.equal(c.worktreeExample, '../shipir-shipr-cxk');
  assert.equal(c.branchExpr, '<prefix>/<unit-id>-<slug>');
  assert.equal(c.epicBranch, 'epic/<epic-id>-<slug>');
  assert.equal(c.branchGlob, '<prefix>/<unit-id>-*');
  assert.equal(c.taskBranchExample, 'task/shipr-hae-event-worker-interrupt');
});

test('without a repo name the worktree expression asks the shell for it', () => {
  assert.equal(minimal().worktreeExpr, '$(dirname "$MAIN")/$(basename "$MAIN")-<unit-id>');
});

test('a pattern outside the parent directory is anchored at the main checkout', () => {
  const c = buildContext(validateConfig({ ...minimalRaw, worktree: { pathPattern: '.wt/{unit}' } }));
  assert.equal(c.worktreeExpr, '$MAIN/.wt/<unit-id>');
});

test('model labels, agents and rules derive from implementers.rules', () => {
  const c = shipir();
  assert.equal(c.modelLabelsOr, '`model:haiku` or `model:sonnet`');
  assert.equal(c.modelLabelPipe, 'haiku|sonnet');
  assert.equal(c.implementerAgentsOr, '`implementer-sonnet` or `implementer-haiku`');
  assert.equal(c.implementerAgentsPlain, 'implementer-sonnet and implementer-haiku');
  assert.equal(c.implementerModelPipe, 'sonnet|haiku');
  assert.equal(c.orchestrationModelName, 'Opus');
  assert.match(c.modelRules, /^- `haiku`: Small, well-specified/m);
  assert.match(c.modelRules, /^- `sonnet`: Everything else/m);
});

test('a single rule yields a single label and agent', () => {
  const c = buildContext(validateConfig({
    ...minimalRaw,
    models: { implementers: { default: 'sonnet', rules: { sonnet: 'All of it.' } } },
  }));
  assert.equal(c.modelLabelsOr, '`model:sonnet`');
  assert.equal(c.implementerAgentsOr, '`implementer-sonnet`');
});

test('optional sections are false when absent and objects when present', () => {
  assert.equal(minimal().codeMap, false);
  assert.equal(minimal().uiSkill, false);
  assert.equal(shipir().codeMap.path, 'docs/code-map');
  assert.equal(shipir().uiSkill.name, 'apple-design');
  assert.equal(shipir().uiPaths, '`frontend/`');
});

test('dashboard follows the config (enabled by default); AI trailer follows the config', () => {
  assert.equal(minimal().dashboard, true);
  assert.equal(shipir().dashboard, true);
  const off = buildContext(validateConfig({ ...minimalRaw, dashboard: { enabled: false } }));
  assert.equal(off.dashboard, false);
  assert.equal(minimal({ dashboard: false }).dashboard, true, 'the old option is gone; the config is the only switch');
  assert.equal(minimal().noAttribution, true);
  const c = buildContext(validateConfig({ ...minimalRaw, attribution: { allowAiTrailer: true } }));
  assert.equal(c.noAttribution, false);
});

test('checks derive per-area sections and command lists', () => {
  const c = shipir();
  assert.equal(c.areaNamesPipe, 'backend|frontend');
  assert.equal(c.hasE2e, true);
  assert.equal(minimal().hasE2e, false);
  assert.match(c.checksSection, /^## backend: files under `backend\/`$/m);
  assert.match(c.checksSection, /^- \*\*Focused:\*\* `\.\/backend\/mvnw/m);
  assert.match(c.checksSection, /^- \*\*E2E:\*\* `pnpm e2e`$/m);
  assert.doesNotMatch(minimal().checksSection, /E2E|Lint|Build/);
  assert.equal(c.fullChecksList, '- `backend`: `./backend/mvnw -f backend/pom.xml verify`\n- `frontend`: `pnpm lint && pnpm test && pnpm build`');
});

test('findings epics become a table row per category with its configured title', () => {
  const c = shipir();
  assert.match(c.findingsEpics, /^\| Real \| Security & authorization \| `security` \|/m);
  assert.match(c.findingsEpics, /^\| Quality \| Tests & CI stability \| `tests` \|/m);
  assert.equal(c.findingsEpicCount, 'four');
  const custom = buildContext(validateConfig({ ...minimalRaw, findings: { epicTitles: { security: 'Sec backlog', infra: 'Infra backlog' } } }));
  assert.match(custom.findingsEpics, /\| Real \| Sec backlog \| `security` \|/);
  assert.match(custom.findingsEpics, /\| Quality \| Infra backlog \| `infra` \|/);
  assert.equal(custom.findingsEpicCount, 'five');
});

test('every value a template needs is defined for the minimal config', () => {
  for (const v of Object.values(minimal())) assert.notEqual(v, undefined);
});

test('hasLint reflects whether any area configures lint', () => {
  assert.equal(shipir().hasLint, true);
  assert.equal(minimal().hasLint, false);
});

test('codeMap context: file layout keeps the path, folder layout adds index path, limit and checker command', () => {
  const file = buildContext(validateConfig({ ...minimalRaw, codeMap: { path: 'docs/CODE_MAP.md' } })).codeMap;
  assert.equal(file.path, 'docs/CODE_MAP.md');
  assert.equal(file.layout, 'file');
  assert.equal(file.folder, false);
  const folder = buildContext(validateConfig({ ...minimalRaw, codeMap: { path: 'docs/code-map/' } })).codeMap;
  assert.deepEqual(folder, {
    path: 'docs/code-map',
    layout: 'folder',
    folder: true,
    indexPath: 'docs/code-map/index.md',
    maxDescription: 160,
    checkCommand: 'node .claude/scripts/code-map-check.mjs docs/code-map --max 160',
  });
});

test('codeMap context: the checker command carries a configured bead ID prefix and the configured limit', () => {
  const c = buildContext(validateConfig({
    ...minimalRaw, tracker: { idPrefix: 'shipr' }, codeMap: { path: 'docs/code-map', maxDescription: 120 },
  })).codeMap;
  assert.equal(c.checkCommand, 'node .claude/scripts/code-map-check.mjs docs/code-map --id-prefix shipr- --max 120');
  assert.equal(c.maxDescription, 120);
});

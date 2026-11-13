/**
 * Turns a validated wavework config (src/config.mjs) into the variables the skill templates use
 * (src/render.mjs). Repeated structures (check areas, model rules, findings epics) are computed here
 * as Markdown, so the template engine needs no loops.
 */

import { codeMapLayout } from './config.mjs';

const FINDING_CLASSES = {
  security: { kind: 'Real', typical: 'auth, permission, token, egress, path, subprocess, secret handling, missing re-authorization' },
  bugs: { kind: 'Real', typical: 'wrong behaviour, data loss, races, broken UX flows' },
  tests: { kind: 'Quality', typical: 'flaky tests, missing malicious-case or edge tests, CI gaps' },
  quality: { kind: 'Quality', typical: 'duplication, dead code, naming, design-system gaps, stale docs' },
};
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

const code = (s) => `\`${s}\``;
const orList = (items) => items.map(code).join(' or ');
const fill = (pattern, values) => pattern.replace(/\{(\w+)\}/g, (_, key) => values[key]);

function worktreeExpression(pattern, repoName) {
  const values = { repo: repoName ?? '$(basename "$MAIN")', unit: '<unit-id>' };
  // `../x` is a sibling of the main checkout; anything else is anchored at the main checkout itself.
  return pattern.startsWith('../')
    ? `$(dirname "$MAIN")/${fill(pattern.slice(3), values)}`
    : `$MAIN/${fill(pattern, values)}`;
}

function areaSection(area) {
  const lines = [
    `## ${area.name}: files under ${area.whenPaths.map(code).join(', ')}`,
    '',
    `- **Focused:** ${code(area.focused)}`,
    `- **Full:** ${code(area.full)}`,
  ];
  if (area.lint) lines.push(`- **Lint:** ${code(area.lint)}`);
  if (area.build) lines.push(`- **Build:** ${code(area.build)}`);
  if (area.e2e) lines.push(`- **E2E:** ${code(area.e2e)}`);
  return lines.join('\n');
}

function findingsRows(epicTitles) {
  return Object.entries(epicTitles)
    .map(([slug, title]) => {
      const { kind, typical } = FINDING_CLASSES[slug] ?? { kind: 'Quality', typical: '' };
      return `| ${kind} | ${title.replace(/^Findings:\s*/, '')} | ${code(slug)} | ${typical} |`;
    })
    .join('\n');
}

/**
 * Implementer models in agent order: the default first, then the other rule keys. The default is included
 * even without a rule of its own (rule is then null).
 *
 * @param {object} config validated config
 * @returns {{model: string, rule: string|null, isDefault: boolean}[]}
 */
export function implementerAgents(config) {
  const { default: fallback, rules } = config.models.implementers;
  return [fallback, ...Object.keys(rules).filter((m) => m !== fallback)].map((model) => ({
    model,
    rule: Object.hasOwn(rules, model) ? rules[model] : null,
    isDefault: model === fallback,
  }));
}

/** Where `init` installs the code map checker (src/targets.mjs) and how the skills call it. */
export const CODE_MAP_CHECKER = '.claude/scripts/code-map-check.mjs';

/**
 * Code map variables for the templates. File layout: the path as configured (templates render exactly the pre-0.2 text).
 * Folder layout: the index, the description limit and the checker command; the bead ID prefix is passed only when the
 * config names one (the checker derives it from `.beads/` otherwise).
 */
function codeMapContext(config) {
  const map = config.codeMap;
  if (!map) return false;
  if (codeMapLayout(map.path) === 'file') return { ...map, layout: 'file', folder: false };
  const prefix = config.tracker.idPrefix ? ` --id-prefix ${config.tracker.idPrefix}` : '';
  return {
    ...map,
    layout: 'folder',
    folder: true,
    indexPath: `${map.path}/index.md`,
    checkCommand: `node ${CODE_MAP_CHECKER} ${map.path}${prefix} --max ${map.maxDescription}`,
  };
}

const AREA_KINDS = [['maven', /\bmvnw?\b/], ['vitest', /\bvitest\b/]];

/**
 * One line per check area for the `AREAS` table of scripts/red-green-check.sh: `'name|kind|dir'`. The kind
 * (maven, vitest) is guessed from the area's focused command; anything else is `unsupported` and the script
 * prints `SKIP <name>: unsupported` for it.
 */
function redGreenAreas(checks) {
  return checks.map((a) => {
    for (const field of [a.name, a.dir]) {
      if (/[|'\n]/.test(field)) throw new Error(`area "${a.name}": name and dir must not contain "|", "'" or newlines (red-green-check.sh area table)`);
    }
    const kind = AREA_KINDS.find(([, re]) => re.test(a.focused))?.[0] ?? 'unsupported';
    return `'${a.name}|${kind}|${a.dir.replace(/\/+$/, '') || '.'}'`;
  }).join('\n');
}

/**
 * @param {object} config validated config (see validateConfig)
 * @param {object} [options]
 * @param {string} [options.repoName] repository directory name for the worktree path; the skill asks the shell when absent
 * @returns {object} template variables
 */
export function buildContext(config, options = {}) {
  const { repoName } = options;
  const { worktree, models, checks } = config;
  const rules = models.implementers.rules;
  const labels = Object.keys(rules);
  if (!labels.includes(models.implementers.default)) labels.push(models.implementers.default);
  const agents = implementerAgents(config).map((a) => a.model);
  const branch = (values) => fill(worktree.branchPattern, values);
  const withE2e = checks.filter((a) => a.e2e);
  const titles = config.findings.epicTitles;
  const count = Object.keys(titles).length;

  return {
    baseBranch: config.baseBranch,
    repoName: repoName ?? '',
    worktreeExpr: worktreeExpression(worktree.pathPattern, repoName),
    worktreeExample: fill(worktree.pathPattern, { repo: repoName ?? 'repo', unit: 'shipr-cxk' }),
    branchExpr: branch({ prefix: '<prefix>', unit: '<unit-id>', slug: '<slug>' }),
    epicBranch: branch({ prefix: 'epic', unit: '<epic-id>', slug: '<slug>' }),
    branchGlob: branch({ prefix: '<prefix>', unit: '<unit-id>', slug: '*' }),
    taskBranchExample: branch({ prefix: 'task', unit: 'shipr-hae', slug: 'event-worker-interrupt' }),
    models,
    orchestrationModelName: models.orchestration.charAt(0).toUpperCase() + models.orchestration.slice(1),
    modelLabelsOr: orList(labels.map((l) => `model:${l}`)),
    modelLabelPipe: labels.join('|'),
    implementerModelPipe: agents.join('|'),
    implementerAgentsPlain: agents.map((a) => `implementer-${a}`).join(' and '),
    implementerAgentsOr: orList(agents.map((a) => `implementer-${a}`)),
    modelRules: Object.entries(rules).map(([model, text]) => `- ${code(model)}: ${text}`).join('\n'),
    areaNamesPipe: checks.map((a) => a.name).join('|'),
    checksSection: checks.map(areaSection).join('\n\n'),
    depsSection: checks.map((a) => `- ${code(a.name)} (${code(a.dir)}, only if it exists)`).join('\n'),
    fullChecksList: checks.map((a) => `- ${code(a.name)}: ${code(a.full)}`).join('\n'),
    hasLint: checks.some((a) => a.lint),
    hasE2e: withE2e.length > 0,
    e2eList: withE2e.map((a) => `- ${code(a.name)}: ${code(a.e2e)}`).join('\n'),
    codeMap: codeMapContext(config),
    uiSkill: config.uiSkill ?? false,
    uiPaths: config.uiSkill ? config.uiSkill.appliesTo.map(code).join(', ') : '',
    findingsEpics: findingsRows(titles),
    findingsEpicCount: NUMBER_WORDS[count] ?? String(count),
    redGreenAreas: redGreenAreas(checks),
    noAttribution: !config.attribution.allowAiTrailer,
    dashboard: config.dashboard.enabled,
  };
}

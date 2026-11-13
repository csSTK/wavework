/**
 * Turns a validated wavework config (src/config.mjs) into the variables the skill templates use
 * (src/render.mjs). Repeated structures (check areas, model rules, findings epics) are computed here
 * as Markdown, so the template engine needs no loops.
 */

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
 * @param {object} config validated config (see validateConfig)
 * @param {object} [options]
 * @param {string} [options.repoName] repository directory name for the worktree path; the skill asks the shell when absent
 * @param {boolean} [options.dashboard] keep the pipeline-dashboard `Record:` lines (the dashboard is not part of the config yet; default off)
 * @returns {object} template variables
 */
export function buildContext(config, options = {}) {
  const { repoName, dashboard = false } = options;
  const { worktree, models, checks } = config;
  const rules = models.implementers.rules;
  const labels = Object.keys(rules);
  if (!labels.includes(models.implementers.default)) labels.push(models.implementers.default);
  const agents = [models.implementers.default, ...labels.filter((l) => l !== models.implementers.default)];
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
    codeMap: config.codeMap ?? false,
    uiSkill: config.uiSkill ?? false,
    uiPaths: config.uiSkill ? config.uiSkill.appliesTo.map(code).join(', ') : '',
    findingsEpics: findingsRows(titles),
    findingsEpicCount: NUMBER_WORDS[count] ?? String(count),
    noAttribution: !config.attribution.allowAiTrailer,
    dashboard,
  };
}

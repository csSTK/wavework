/**
 * Which template becomes which file in a target repository. Pure: no file system access.
 *
 * Contract (consumed by the init/update CLI):
 *
 *   templateTargets(config) -> [{ template, target, vars, mode }]
 *     template  path below `templates/` (always `/`-separated), e.g. `skills/next-task/SKILL.md`
 *     target    path relative to the repository root, e.g. `.claude/skills/next-task/SKILL.md`
 *     vars      extra template variables, merged OVER buildContext(config, options); `{}` for most templates
 *     mode      file mode: 0o644 for text, 0o755 for scripts
 *
 *   One entry per file to write, for ALL templates (skills, agents, scripts). The agent template
 *   `agents/implementer.md` appears once per implementer model (the keys of `models.implementers.rules`
 *   plus `models.implementers.default`), each with `vars.agent = { model, name, description, rule, isDefault, defaultName }` (`description` is a quoted YAML scalar).
 *   Targets are unique. A model name that is not safe as a file name throws.
 *
 *   renderTargets(config, options) -> [{ target, content, mode }]
 *     Renders every entry with buildContext(config, options) (same `options` as buildContext) plus `vars`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildContext, implementerAgents } from './context.mjs';
import { render } from './render.mjs';

export const SKILLS = [
  'next-task', 'next-task-batch', 'next-task-beads', 'next-task-branch', 'next-task-code',
  'next-task-deps', 'next-task-e2e', 'next-task-findings', 'next-task-finish', 'next-task-implement',
  'next-task-plan', 'next-task-review', 'next-task-test', 'next-task-write-tests',
  'text-to-task', 'watch-ci',
];

const SCRIPTS = ['red-green-check.sh', 'red-green-check.test.sh'];
const AGENT_TEMPLATE = 'agents/implementer.md';
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A JSON string is a valid YAML double-quoted scalar, so rule texts with ": ", quotes or "#" cannot break the frontmatter. */
function agentDescription(rule) {
  return JSON.stringify(rule
    ? `Implements a planned beads task. Scope: ${rule} Pass the bead ID.`
    : 'Implements a planned beads task. Default implementer for work that no other model rule covers. Pass the bead ID.');
}

export function templateTargets(config) {
  const entries = SKILLS.map((name) => ({
    template: `skills/${name}/SKILL.md`,
    target: `.claude/skills/${name}/SKILL.md`,
    vars: {},
    mode: 0o644,
  }));
  const agents = implementerAgents(config);
  const defaultName = `implementer-${config.models.implementers.default}`;
  for (const { model, rule, isDefault } of agents) {
    if (!SAFE_MODEL.test(model)) throw new Error(`implementer model "${model}" cannot be used as an agent file name (allowed: letters, digits, ".", "_", "-")`);
    entries.push({
      template: AGENT_TEMPLATE,
      target: `.claude/agents/implementer-${model}.md`,
      vars: { agent: { model, name: `implementer-${model}`, description: agentDescription(rule), rule: rule ?? '', isDefault, defaultName } },
      mode: 0o644,
    });
  }
  for (const name of SCRIPTS) {
    entries.push({ template: `scripts/${name}`, target: `.claude/scripts/${name}`, vars: {}, mode: 0o755 });
  }
  return entries;
}

export function renderTargets(config, options = {}) {
  const context = buildContext(config, options);
  return templateTargets(config).map(({ template, target, vars, mode }) => {
    const text = readFileSync(fileURLToPath(new URL(`../templates/${template}`, import.meta.url)), 'utf8');
    return { target, content: render(text, { ...context, ...vars }, template), mode };
  });
}

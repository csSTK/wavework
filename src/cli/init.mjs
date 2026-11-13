import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig, validateConfig, CONFIG_PATH } from '../config.mjs';
import {
  apply, defaultTargets, loadHookDefs, PACKAGE_TEMPLATES, plan, readLock, renderTargets, report,
} from './sync.mjs';
import { safeResolve } from './safe-path.mjs';
import { git, resolveRepo } from './repo.mjs';

/** Default branch from `refs/remotes/origin/HEAD`, or undefined when there is no such ref. */
function detectBaseBranch(cwd, env) {
  try {
    const ref = git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], env);
    return ref.replace(/^origin\//, '') || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The config has no usable default for `checks`, so a starter config only exists to be edited:
 * one area whose commands fail loudly until the user fills them in (or `npm test` when package.json has it).
 */
function starterConfig(cwd, baseBranch) {
  let command = 'echo "wavework: set the checks in .claude/wavework.json" >&2; exit 1';
  try {
    if (JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))?.scripts?.test) command = 'npm test';
  } catch { /* no package.json */ }
  return { baseBranch, checks: [{ name: 'project', dir: '.', whenPaths: ['.'], focused: command, full: command }] };
}

/** Resolves where the config comes from; returns it plus the text to write (null when it already exists). */
function resolveConfig(args, ctx, root, out, adopt) {
  const existing = existsSync(join(root, CONFIG_PATH));
  const from = args['--config'];
  if (existing) {
    if (from) throw new Error(`${CONFIG_PATH} already exists; drop --config to use it (it is never overwritten)`);
    return { config: loadConfig(root), text: null };
  }
  if (from) {
    let text;
    try {
      text = readFileSync(resolve(ctx.cwd, from), 'utf8');
    } catch (e) {
      throw new Error(`cannot read --config file ${from}: ${e.message}`);
    }
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new Error(`--config file ${from} is not valid JSON: ${e.message}`);
    }
    return { config: validateConfig(raw), text: text.endsWith('\n') ? text : `${text}\n` };
  }
  if (adopt) {
    throw new Error(
      `--adopt requires --config <file> when ${CONFIG_PATH} does not exist: adopting existing hand-written files only makes sense `
      + 'against a config that describes your repository (checks, models); a starter config would be a guess, and every file '
      + `rendered from it would differ. Create ${CONFIG_PATH} (see docs/config.md) or pass --config <file>.`,
    );
  }
  const baseBranch = detectBaseBranch(root, ctx.env);
  if (!baseBranch) {
    throw new Error(
      `no ${CONFIG_PATH} and no default branch to take baseBranch from (git has no refs/remotes/origin/HEAD). `
      + `Create ${CONFIG_PATH} (see docs/config.md) or pass --config <file>.`,
    );
  }
  const raw = starterConfig(root, baseBranch);
  out.write(`no ${CONFIG_PATH}: writing a starter config (baseBranch "${baseBranch}" from origin/HEAD); edit "checks" in it\n`);
  return { config: validateConfig(raw), text: `${JSON.stringify(raw, null, 2)}\n` };
}

/**
 * `wavework init [--config <file>] [--adopt] [--dry-run]`: first-time setup of `.claude/` at the root of the repository containing `ctx.cwd` (a subdirectory or linked worktree works, see resolveRepo).
 * `--config <file>` is relative to `ctx.cwd`.
 * With `--adopt`, existing files are kept: identical ones are locked, differing ones get a `.wavework-new` next to them.
 *
 * @returns {Promise<number>} exit code
 */
export async function init(args, ctx) {
  const { root, repoName } = resolveRepo(ctx.cwd, ctx.env);
  ctx.stdout.write(`wavework: repository ${root} (${repoName})\n`);
  const claudeDir = join(root, '.claude');
  if (readLock(claudeDir)) throw new Error('.claude/wavework.lock.json exists: wavework is already set up here; run `wavework update`');

  const dryRun = args['--dry-run'] === true;
  const adopt = args['--adopt'] === true;
  const { config, text } = resolveConfig(args, ctx, root, ctx.stdout, adopt);
  const provider = ctx.targets ?? await defaultTargets();
  const rendered = renderTargets(config, provider, ctx.templatesDir ?? PACKAGE_TEMPLATES, repoName);
  const result = plan({ claudeDir, rendered, lock: { files: {}, hooks: [] }, defs: loadHookDefs(ctx.hooks, config), adopt });

  if (!dryRun) {
    if (text !== null) {
      const configPath = safeResolve(claudeDir, 'wavework.json', { allowReserved: true });
      result.actions.unshift({ kind: 'create', target: 'wavework.json', abs: configPath, content: text, mode: 0o644 });
    }
    apply(claudeDir, result, ctx.version);
  } else if (text !== null) {
    result.actions.unshift({ kind: 'create', target: 'wavework.json' });
  }
  return report(result, ctx.stdout, { dryRun, adopt, done: `wavework ${ctx.version}: ${adopt ? 'adopted' : 'initialized'} .claude/` });
}

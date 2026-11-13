import { join } from 'node:path';
import { loadConfig } from '../config.mjs';
import {
  apply, defaultTargets, loadHookDefs, PACKAGE_TEMPLATES, plan, readLock, renderTargets, report,
} from './sync.mjs';
import { resolveRepo } from './repo.mjs';

/**
 * `wavework update [--dry-run]`: re-renders with the installed version and the current config and
 * syncs `.claude/` at the repository root (also from a subdirectory or linked worktree) per the lock (see docs/lock.md). Never modifies `.claude/wavework.json`.
 *
 * @returns {Promise<number>} exit code
 */
export async function update(args, ctx) {
  const { root, repoName } = resolveRepo(ctx.cwd, ctx.env);
  ctx.stdout.write(`wavework: repository ${root} (${repoName})\n`);
  const claudeDir = join(root, '.claude');
  const lock = readLock(claudeDir);
  if (!lock) throw new Error('no .claude/wavework.lock.json: run `wavework init` first');
  const config = loadConfig(root);
  const provider = ctx.targets ?? await defaultTargets();
  const rendered = renderTargets(config, provider, ctx.templatesDir ?? PACKAGE_TEMPLATES, repoName);
  const result = plan({ claudeDir, rendered, lock, defs: loadHookDefs(ctx.hooks, config) });
  const dryRun = args['--dry-run'] === true;
  if (!dryRun) apply(claudeDir, result, ctx.version);
  return report(result, ctx.stdout, { dryRun, done: `wavework ${ctx.version}: updated .claude/` });
}

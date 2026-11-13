import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { loadConfig, validateConfig, CONFIG_PATH } from '../config.mjs';
import {
  apply, defaultTargets, loadHookDefs, PACKAGE_TEMPLATES, plan, readLock, renderTargets, report,
} from './sync.mjs';
import { safeResolve } from './safe-path.mjs';

/** Default branch from `refs/remotes/origin/HEAD`, or undefined when there is no such ref. */
function detectBaseBranch(cwd) {
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
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
function resolveConfig(args, ctx, out) {
  const existing = existsSync(join(ctx.cwd, CONFIG_PATH));
  const from = args['--config'];
  if (existing) {
    if (from) throw new Error(`${CONFIG_PATH} already exists; drop --config to use it (it is never overwritten)`);
    return { config: loadConfig(ctx.cwd), text: null };
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
  const baseBranch = detectBaseBranch(ctx.cwd);
  if (!baseBranch) {
    throw new Error(
      `no ${CONFIG_PATH} and no default branch to take baseBranch from (git has no refs/remotes/origin/HEAD). `
      + `Create ${CONFIG_PATH} (see docs/config.md) or pass --config <file>.`,
    );
  }
  const raw = starterConfig(ctx.cwd, baseBranch);
  out.write(`no ${CONFIG_PATH}: writing a starter config (baseBranch "${baseBranch}" from origin/HEAD); edit "checks" in it\n`);
  return { config: validateConfig(raw), text: `${JSON.stringify(raw, null, 2)}\n` };
}

/**
 * `wavework init [--config <file>] [--dry-run]`: first-time setup of `.claude/` in the repo at `ctx.cwd`.
 *
 * @returns {Promise<number>} exit code
 */
export async function init(args, ctx) {
  if (!existsSync(join(ctx.cwd, '.git'))) throw new Error('not at a git repository root (no .git here): run wavework from the repository root');
  const claudeDir = join(ctx.cwd, '.claude');
  if (readLock(claudeDir)) throw new Error('.claude/wavework.lock.json exists: wavework is already set up here; run `wavework update`');

  const dryRun = args['--dry-run'] === true;
  const { config, text } = resolveConfig(args, ctx, ctx.stdout);
  const provider = ctx.targets ?? await defaultTargets();
  const rendered = renderTargets(config, provider, ctx.templatesDir ?? PACKAGE_TEMPLATES, basename(resolve(ctx.cwd)));
  const result = plan({ claudeDir, rendered, lock: { files: {}, hooks: [] }, defs: loadHookDefs(ctx.hooks) });

  if (!dryRun) {
    if (text !== null) {
      const configPath = safeResolve(claudeDir, 'wavework.json', { allowReserved: true });
      result.actions.unshift({ kind: 'create', target: 'wavework.json', abs: configPath, content: text, mode: 0o644 });
    }
    apply(claudeDir, result, ctx.version);
  } else if (text !== null) {
    result.actions.unshift({ kind: 'create', target: 'wavework.json' });
  }
  return report(result, ctx.stdout, { dryRun, done: `wavework ${ctx.version}: initialized .claude/` });
}

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

/** Variables that make git look somewhere other than the current directory; never inherited by wavework's git calls. */
const GIT_LOCATION_VARS = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES',
];

/** Environment for git child processes: `env` (default process.env) without the variables that relocate the repository. */
export function gitEnv(env = process.env) {
  const clean = { ...env };
  for (const name of GIT_LOCATION_VARS) delete clean[name];
  return clean;
}

/** Runs git with an argument list (no shell) in `cwd` with a sanitized environment; returns trimmed stdout, throws on failure. */
export function git(cwd, args, env) {
  return execFileSync('git', args, { cwd, env: gitEnv(env), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Finds the repository that contains `cwd`: the root of the working tree (where `.claude/` lives) and the
 * name of the main checkout.
 *
 * `root` is `git rev-parse --show-toplevel`, so wavework also works from a subdirectory; in a linked worktree
 * it is the worktree itself (`.claude/` is committed per checkout). `repoName` is the directory name of the
 * MAIN checkout, derived like the skills do (`dirname` of the git common dir), so a worktree called
 * `acme-feature-x` still renders `../acme-<unit>`. Git is called with an argument list, never through a shell.
 * `--git-common-dir` is resolved against `cwd` because it is printed relative on git older than 2.31
 * (no `--path-format=absolute`) and in some other cases.
 *
 * @param {string} cwd
 * @param {object} [env] environment the git calls start from (default process.env); GIT_DIR, GIT_WORK_TREE and similar are always removed
 * @returns {{ root: string, repoName: string }}
 */
export function resolveRepo(cwd, env) {
  let root;
  let commonDir;
  try {
    root = realpathSync(git(cwd, ['rev-parse', '--show-toplevel'], env));
    commonDir = realpathSync(resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir'], env)));
  } catch (e) {
    const detail = String(e.stderr ?? e.message).trim().split('\n')[0];
    throw new Error(`not inside a git repository working tree (${detail}): run wavework inside the repository, not in a bare repository or outside git`);
  }
  return { root, repoName: basename(dirname(commonDir)) };
}

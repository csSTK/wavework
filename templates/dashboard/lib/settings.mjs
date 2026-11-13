// Dashboard settings written by `wavework init/update` into ../config.json: { port, tokensFile }.
// The runtime never reads .claude/wavework.json, so it works in any checkout that has this folder.
// Without config.json (or with an unreadable one) the defaults apply.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const DEFAULT_PORT = 4690;

/** `{ port, tokensFile }` from `<dashboardDir>/config.json`; defaults for anything missing or invalid. */
export function readSettings(dashboardDir) {
  let raw = {};
  try { raw = JSON.parse(readFileSync(path.join(dashboardDir, 'config.json'), 'utf8')); } catch { /* defaults */ }
  const port = Number.isInteger(raw?.port) && raw.port >= 1024 && raw.port <= 65535 ? raw.port : DEFAULT_PORT;
  const tokensFile = typeof raw?.tokensFile === 'string' && raw.tokensFile !== '' ? raw.tokensFile : null;
  return { port, tokensFile };
}

/** PIPELINE_DASHBOARD_PORT wins over config.json. Port 0 (ephemeral) is only meant for tests. */
export function resolvePort(dashboardDir, env = process.env) {
  if (env.PIPELINE_DASHBOARD_PORT !== undefined) return Number(env.PIPELINE_DASHBOARD_PORT);
  return readSettings(dashboardDir).port;
}

/** Repo directory name for the UI title: the main checkout (parent of the git common dir), else the checkout root. */
export function projectName(root) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (common) return path.basename(path.dirname(common));
  } catch { /* not a git checkout */ }
  return path.basename(path.resolve(root));
}

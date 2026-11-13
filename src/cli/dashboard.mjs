import { spawn as nodeSpawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.mjs';
import { safeResolve } from './safe-path.mjs';

/**
 * `wavework dashboard`: runs this repository's installed dashboard server (`.claude/wavework/dashboard/server.mjs`)
 * in the foreground until it is stopped. The server is the repo's own copy, versioned with the lock like every
 * other file, so it needs no node_modules and no installed wavework.
 *
 * @param {object} _args
 * @param {{ cwd: string, env?: object, spawn?: Function }} ctx `spawn` and `env` replace child_process.spawn and process.env (tests)
 * @returns {Promise<number>} the server's exit code
 */
export async function dashboard(_args, ctx) {
  const claudeDir = join(ctx.cwd, '.claude');
  const config = loadConfig(ctx.cwd);
  if (!config.dashboard.enabled) {
    throw new Error('the dashboard is disabled ("dashboard.enabled": false in .claude/wavework.json); enable it and run `wavework update`');
  }
  const server = safeResolve(claudeDir, 'wavework/dashboard/server.mjs');
  let isFile = false;
  try { isFile = statSync(server).isFile(); } catch { /* missing */ }
  if (!isFile) throw new Error('the dashboard is not installed in this repository (.claude/wavework/dashboard/server.mjs is missing); run `wavework update`');

  const env = { ...(ctx.env ?? process.env) };
  env.PIPELINE_DASHBOARD_PORT ??= String(config.dashboard.port);
  const child = (ctx.spawn ?? nodeSpawn)(process.execPath, [server], { cwd: ctx.cwd, env, stdio: 'inherit' });
  const forward = (signal) => () => child.kill?.(signal);
  const handlers = ctx.spawn ? [] : ['SIGINT', 'SIGTERM'].map((sig) => [sig, forward(sig)]);
  for (const [sig, fn] of handlers) process.once(sig, fn);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
  } finally {
    for (const [sig, fn] of handlers) process.removeListener(sig, fn);
  }
}

// Safe lookup of the project's own tokens CSS (config `dashboard.tokensFile`).
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Absolute real path of `rel` inside `root`, or null. Refuses anything that is not a plain repo-relative
 * path (absolute, `..`, `.` or empty segments, backslash, NUL) and anything whose real path (symlinks
 * resolved, also in parent directories) leaves the real repo root or is not a regular file.
 */
export function resolveTokensFile(root, rel) {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0') || rel.includes('\\')) return null;
  if (!rel.endsWith('.css')) return null; // config.json can be edited by hand: the suffix is enforced here too
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return null;
  if (rel.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  try {
    const realRoot = realpathSync(root);
    const real = realpathSync(path.join(realRoot, ...rel.split('/')));
    if (!real.startsWith(realRoot + path.sep) || !statSync(real).isFile()) return null;
    return real;
  } catch { return null; }
}

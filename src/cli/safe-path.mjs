import { lstatSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** Files inside .claude/ that wavework manages itself; no template or lock entry may name them. */
const RESERVED = new Set(['wavework.json', 'wavework.lock.json', 'settings.json']);

function unsafe(rel, why) {
  return new Error(`unsafe path ${JSON.stringify(rel)}: ${why}`);
}

/**
 * Checks a path that must stay inside `<repo>/.claude/` and returns its absolute form.
 *
 * Lexical rules (strict, no normalization): a non-empty POSIX-style relative path whose segments
 * are all real names (no "", ".", ".."), no backslash, no drive letter, no NUL.
 * File system rules: `.claude` and every existing component on the way (also the final one) must
 * not be a symlink, even when it points inside `.claude`; intermediate components must be directories.
 * Nothing is ever followed or created here.
 *
 * @param {string} claudeDir absolute path of `<repo>/.claude`
 * @param {unknown} rel path relative to `claudeDir`
 * @param {{ allowReserved?: boolean }} [options]
 * @returns {string} absolute path
 */
export function safeResolve(claudeDir, rel, { allowReserved = false } = {}) {
  if (typeof rel !== 'string' || rel === '') throw new Error(`invalid path: ${JSON.stringify(rel)} (expected a non-empty string)`);
  if (rel.includes('\0')) throw unsafe(rel, 'contains a NUL byte');
  if (rel.includes('\\')) throw unsafe(rel, 'contains a backslash');
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) throw unsafe(rel, 'must be relative to .claude/');
  const segments = rel.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw unsafe(rel, 'empty, "." or ".." segment');
  }
  if (!allowReserved && RESERVED.has(rel.toLowerCase())) {
    throw unsafe(rel, 'reserved file (managed by wavework itself)');
  }

  const abs = join(claudeDir, ...segments);
  if (!resolve(abs).startsWith(resolve(claudeDir) + sep)) throw unsafe(rel, 'resolves outside .claude/');

  refuseSymlinks(claudeDir, rel, '.claude');
  let current = claudeDir;
  segments.forEach((segment, i) => {
    current = join(current, segment);
    const last = i === segments.length - 1;
    const st = refuseSymlinks(current, rel, segment);
    if (st && !last && !st.isDirectory()) throw unsafe(rel, `"${segment}" exists and is not a directory`);
  });
  return abs;
}

/** lstat without following; throws on a symlink, returns the stats (or undefined when missing). */
function refuseSymlinks(path, rel, name) {
  let st;
  try {
    st = lstatSync(path);
  } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw unsafe(rel, `cannot inspect "${name}": ${e.code ?? e.message}`);
  }
  if (st.isSymbolicLink()) throw unsafe(rel, `"${name}" is a symlink`);
  return st;
}

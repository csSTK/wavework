import { createHash } from 'node:crypto';
import {
  chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext } from '../context.mjs';
import { render } from '../render.mjs';
import { safeResolve } from './safe-path.mjs';
import { mergeHooks, parseHookDefs } from './hooks.mjs';
import { lineDiffStat } from './diff-stat.mjs';

export const LOCK_PATH = 'wavework.lock.json';
export const SETTINGS_PATH = 'settings.json';
export const NEW_SUFFIX = '.wavework-new';
export const PACKAGE_TEMPLATES = fileURLToPath(new URL('../../templates/', import.meta.url));
const LOCK_FORMAT = 1;

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Optional features whose hooks (`features.<name>` in hooks.json) the config switches on. */
export const enabledFeatures = (config) => (config.dashboard?.enabled ? ['dashboard'] : []);

/** Hook definitions: injected object, or templates/settings/hooks.json of the package; feature hooks only when the config enables them. */
export function loadHookDefs(injected, config) {
  const json = injected ?? JSON.parse(readFileSync(join(PACKAGE_TEMPLATES, 'settings', 'hooks.json'), 'utf8'));
  return parseHookDefs(json, config ? enabledFeatures(config) : []);
}

/** The default target provider is src/targets.mjs, imported lazily so init/update can be tested without it. */
export async function defaultTargets() {
  try {
    return (await import('../targets.mjs')).templateTargets;
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && /targets\.mjs/.test(e.message)) {
      throw new Error('this wavework installation is missing src/targets.mjs');
    }
    throw e;
  }
}

const TARGET_PREFIX = '.claude/';
const TMP_SUFFIX = '.wavework-tmp';

/** `<file>.wavework-new` and the temp files are wavework's own; no target or lock entry may use those names. */
function refuseInternalSuffix(rel) {
  if (rel.endsWith(NEW_SUFFIX) || rel.endsWith(TMP_SUFFIX)) {
    throw new Error(`unsafe path ${JSON.stringify(rel)}: names ending in ${NEW_SUFFIX} or ${TMP_SUFFIX} are reserved`);
  }
}

/**
 * Renders every target. Does not touch `.claude/`. The provider's `target` is relative to the repo root
 * and must start with `.claude/`; it is stored (lock, reports) relative to `.claude/`. `vars` are merged
 * over buildContext(config) (src/targets.mjs contract); `verbatim: true` skips rendering.
 * @returns {{ target: string, content: string, hash: string, mode: number }[]}
 */
export function renderTargets(config, provider, templatesDir, repoName) {
  const seen = new Set();
  const root = resolve(templatesDir);
  const context = buildContext(config, { repoName });
  return provider(config).map((t) => {
    if (typeof t?.template !== 'string' || typeof t?.target !== 'string') throw new Error('invalid target definition (template and target must be strings)');
    if (!t.target.startsWith(TARGET_PREFIX)) throw new Error(`unsafe path ${JSON.stringify(t.target)}: targets must be inside ${TARGET_PREFIX}`);
    const target = t.target.slice(TARGET_PREFIX.length);
    refuseInternalSuffix(target);
    if (seen.has(target.toLowerCase())) throw new Error(`duplicate target ${JSON.stringify(t.target)} (names are compared case-insensitively)`);
    seen.add(target.toLowerCase());
    const file = resolve(root, t.template);
    if (!file.startsWith(root + sep)) throw new Error(`unsafe template path ${JSON.stringify(t.template)}`);
    // `verbatim` targets (the dashboard runtime) are copied byte for byte: they are JavaScript and CSS, not templates.
    const text = readFileSync(file, 'utf8');
    const content = t.verbatim === true ? text : render(text, { ...context, ...(t.vars ?? {}) }, t.template);
    return { target, content, hash: sha256(content), mode: t.mode ?? 0o644 };
  });
}

/**
 * Reads and validates the lock. Every path in it is checked like a template target: a tampered lock
 * must not make update touch anything outside `.claude/`.
 * @returns {{ version: string, files: Record<string, string>, hooks: { event: string, entry: object }[] } | null} null when absent
 */
export function readLock(claudeDir) {
  const file = safeResolve(claudeDir, LOCK_PATH, { allowReserved: true });
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`cannot read lock file ${file}: ${e.message}`);
  }
  const bad = (why) => new Error(`invalid lock file ${file}: ${why}`);
  let lock;
  try {
    lock = JSON.parse(text);
  } catch (e) {
    throw bad(`not valid JSON (${e.message})`);
  }
  if (!isObject(lock)) throw bad('expected an object');
  if (lock.lockVersion !== LOCK_FORMAT) throw bad(`unsupported lockVersion ${JSON.stringify(lock.lockVersion)}`);
  if (typeof lock.version !== 'string') throw bad('"version" must be a string');
  if (!isObject(lock.files)) throw bad('"files" must be an object');
  for (const [rel, hash] of Object.entries(lock.files)) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw bad(`files.${rel}: expected a sha256 hex digest`);
    try {
      refuseInternalSuffix(rel);
      safeResolve(claudeDir, rel);
    } catch (e) {
      throw bad(e.message);
    }
  }
  if (!Array.isArray(lock.hooks)) throw bad('"hooks" must be an array');
  lock.hooks.forEach((h, i) => {
    if (!isObject(h) || typeof h.event !== 'string' || !isObject(h.entry)) throw bad(`hooks[${i}]: expected { event, entry }`);
  });
  return lock;
}

/** sha256 of the regular file at `abs`, undefined when missing. */
function diskHash(abs, rel) {
  let st;
  try {
    st = lstatSync(abs);
  } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  }
  if (!st.isFile()) throw new Error(`${rel} exists but is not a regular file`);
  return sha256(readFileSync(abs));
}

const exists = (abs) => {
  try {
    lstatSync(abs);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
};

/**
 * Decides what to do for every file and for settings.json. Reads, never writes.
 * Throws on any unsafe path or invalid input, so a failing plan leaves the repo untouched.
 *
 * @param {object} p
 * @param {string} p.claudeDir
 * @param {ReturnType<typeof renderTargets>} p.rendered
 * @param {{ files: Record<string, string>, hooks: object[] }} p.lock `{ files: {}, hooks: [] }` for init
 * @param {{ event: string, entry: object }[]} p.defs
 * @param {boolean} [p.adopt] `init --adopt`: existing files that differ are kept, their lock entry is the RENDERED hash,
 *   and the result carries `adoption` (identical / differing with diff stats / created). Nothing else changes.
 */
export function plan({ claudeDir, rendered, lock, defs, adopt = false }) {
  const actions = [];
  const adoption = { identical: [], differing: [], created: [] };
  const files = {};
  const wanted = new Set(rendered.map((t) => t.target));

  for (const t of rendered) {
    const abs = safeResolve(claudeDir, t.target);
    const disk = diskHash(abs, t.target);
    const locked = lock.files[t.target];
    const write = (kind) => { actions.push({ kind, target: t.target, abs, content: t.content, mode: t.mode }); files[t.target] = t.hash; };
    if (disk === undefined) {
      write(locked === undefined ? 'create' : 'restore');
      adoption.created.push(t.target);
    } else if (disk === t.hash) {
      files[t.target] = t.hash; // already what we would write: adopt
      adoption.identical.push(t.target);
      if ((lstatSync(abs).mode & 0o111) !== (t.mode & 0o111)) actions.push({ kind: 'mode', target: t.target, abs, mode: t.mode });
    } else if (locked !== undefined && disk === locked) {
      write('update'); // untouched since the last run
    } else {
      // Edited locally (or an unknown file sits there). The old lock hash stays, so it is reported until resolved.
      if (locked !== undefined) files[t.target] = locked;
      const newAbs = safeResolve(claudeDir, `${t.target}${NEW_SUFFIX}`);
      const review = { kind: 'review', target: t.target, newTarget: `${t.target}${NEW_SUFFIX}`, newAbs, content: t.content };
      if (adopt) {
        // Adopted: the lock records the rendered hash, so `update` reports the file for as long as its .wavework-new exists.
        files[t.target] = t.hash;
        review.stat = lineDiffStat(readFileSync(abs, 'utf8'), t.content);
        adoption.differing.push({ target: t.target, ...review.stat });
      } else if (locked !== undefined && t.hash === locked && !exists(newAbs)) {
        continue; // nothing new upstream, nothing to merge (a still existing .wavework-new means it is not resolved yet)
      }
      actions.push(review);
    }
  }

  for (const [rel, locked] of Object.entries(lock.files)) {
    if (wanted.has(rel)) continue;
    const abs = safeResolve(claudeDir, rel);
    const disk = diskHash(abs, rel);
    if (disk === undefined) continue; // gone already
    if (disk === locked) {
      actions.push({ kind: 'delete', target: rel, abs });
    } else {
      files[rel] = locked;
      actions.push({ kind: 'review-removed', target: rel });
    }
  }

  const settingsAbs = safeResolve(claudeDir, SETTINGS_PATH, { allowReserved: true });
  let current = {};
  let existed = true;
  try {
    const text = readFileSync(settingsAbs, 'utf8');
    try {
      current = JSON.parse(text);
    } catch (e) {
      throw new Error(`${settingsAbs} is not valid JSON (${e.message}); fix it or remove it, nothing was changed`);
    }
    if (!isObject(current)) throw new Error(`${settingsAbs}: expected a JSON object`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    existed = false;
  }
  const merged = mergeHooks(current, defs, lock.hooks);
  const notes = merged.lost.map((h) => `hook ${h.event}: owned entry changed locally, not re-added`);
  const changed = JSON.stringify(merged.settings) !== JSON.stringify(current) || (!existed && Object.keys(merged.settings).length > 0);
  if (changed) actions.push({ kind: 'settings', abs: settingsAbs, content: `${JSON.stringify(merged.settings, null, 2)}\n` });

  return { actions, notes, files, adoption, hooks: merged.owned, review: actions.filter((a) => a.kind.startsWith('review')).length };
}

/** Writes via a temp file and rename, so a symlink that appeared meanwhile is replaced, never written through. */
function writeAtomic(abs, content, mode) {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = join(dirname(abs), `.${basename(abs)}${TMP_SUFFIX}`);
  try {
    unlinkSync(tmp);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  writeFileSync(tmp, content, { flag: 'wx', mode });
  chmodSync(tmp, mode);
  renameSync(tmp, abs);
}

function pruneEmptyDirs(claudeDir, from) {
  let dir = dirname(from);
  while (dir.startsWith(resolve(claudeDir) + sep)) {
    try {
      rmdirSync(dir);
    } catch {
      return; // not empty (or gone): stop
    }
    dir = dirname(dir);
  }
}

/** Executes a plan and writes the lock last. */
export function apply(claudeDir, result, version) {
  for (const a of result.actions) {
    if (a.kind === 'create' || a.kind === 'update' || a.kind === 'restore') writeAtomic(a.abs, a.content, a.mode);
    else if (a.kind === 'mode') chmodSync(a.abs, a.mode);
    else if (a.kind === 'review') writeAtomic(a.newAbs, a.content, 0o644);
    else if (a.kind === 'delete') {
      unlinkSync(a.abs);
      pruneEmptyDirs(claudeDir, a.abs);
    } else if (a.kind === 'settings') writeAtomic(a.abs, a.content, 0o644);
  }
  const files = Object.fromEntries(Object.entries(result.files).sort(([a], [b]) => (a < b ? -1 : 1)));
  const lock = { lockVersion: LOCK_FORMAT, version, files, hooks: result.hooks };
  writeAtomic(safeResolve(claudeDir, LOCK_PATH, { allowReserved: true }), `${JSON.stringify(lock, null, 2)}\n`, 0o644);
}

const LABEL = {
  create: 'create ', update: 'update ', restore: 'restore', delete: 'delete ', settings: 'update ', mode: 'mode   ',
};

/** Prints one short line per change; returns the exit code (2 when files need review). */
export function report(result, stdout, { dryRun, done, adopt = false }) {
  const prefix = dryRun ? 'dry-run: ' : '';
  const counts = {};
  for (const a of result.actions) {
    counts[a.kind] = (counts[a.kind] ?? 0) + 1;
    if (a.kind === 'review') {
      const st = a.stat;
      const note = st?.approx ? ', upper bound' : st?.whitespaceOnly ? ', whitespace/newline only' : '';
      const stat = st ? ` (+${st.added} -${st.removed}${note})` : '';
      const why = a.stat ? 'differs from the rendered version, kept untouched; rendered version in' : 'edited locally, kept; new version in';
      stdout.write(`${prefix}review  ${a.target}: ${why} ${a.newTarget}${stat}\n`);
    } else if (a.kind === 'review-removed') {
      stdout.write(`${prefix}review  ${a.target}: removed upstream but edited locally, kept\n`);
    } else {
      stdout.write(`${prefix}${LABEL[a.kind]} ${a.kind === 'settings' ? 'settings.json (hooks)' : a.target}\n`);
    }
  }
  for (const note of result.notes) stdout.write(`${prefix}${note}\n`);
  if (adopt) {
    const { identical, differing, created } = result.adoption;
    stdout.write(`${prefix}adopt: ${identical.length} identical, ${differing.length} differing, ${created.length} new\n`);
    if (differing.length > 0) stdout.write(`${prefix}for a full diff run: diff <file> <file>${NEW_SUFFIX}  (+N -M = lines the rendered version adds / the kept file has extra)\n`);
  }
  if (result.review > 0) stdout.write(`${prefix}${result.review} file(s) edited locally need review: merge the .wavework-new files, then delete them\n`);
  if (result.actions.length === 0 && result.notes.length === 0) stdout.write(`${prefix}nothing to do\n`);
  else if (!dryRun) stdout.write(`${done}\n`);
  return result.review > 0 ? 2 : 0;
}

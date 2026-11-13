import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Location of the config file, relative to the repository root. */
export const CONFIG_PATH = '.claude/wavework.json';

/** Defaults for every optional field with a default. Never mutated; results get deep copies. */
export const DEFAULTS = Object.freeze({
  worktree: Object.freeze({
    pathPattern: '../{repo}-{unit}',
    branchPattern: '{prefix}/{unit}-{slug}',
  }),
  models: Object.freeze({
    planning: 'opus',
    orchestration: 'opus',
    implementers: Object.freeze({
      default: 'sonnet',
      rules: Object.freeze({
        haiku: 'Small, well-specified, low-risk changes: boilerplate, renames, config tweaks, docs, straightforward tests.',
        sonnet: 'Everything else: multi-file features, non-trivial logic, debugging, refactors. When unsure, use sonnet.',
      }),
    }),
  }),
  tracker: Object.freeze({ kind: 'beads' }),
  findings: Object.freeze({
    epicTitles: Object.freeze({
      security: 'Findings: Security & authorization',
      bugs: 'Findings: Bugs & correctness',
      tests: 'Findings: Tests & CI stability',
      quality: 'Findings: Code quality, UI & docs',
    }),
  }),
  codeMap: Object.freeze({ maxDescription: 160 }),
  attribution: Object.freeze({ allowAiTrailer: false }),
  dashboard: Object.freeze({ enabled: true, port: 4690 }),
});

const PATH_PLACEHOLDERS = ['repo', 'unit'];
const BRANCH_PLACEHOLDERS = ['prefix', 'unit', 'slug'];
const TRACKER_KINDS = ['beads'];

const clone = (v) => structuredClone(v);

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

const isObject = (v) => typeName(v) === 'object';
const join_ = (base, key) => (base ? `${base}.${key}` : key);

// Each helper returns the validated value (or undefined when invalid/absent) and pushes problems.

function str(v, path, errs) {
  if (typeof v === 'string' && v.trim() !== '') return v;
  errs.push(`${path}: expected a non-empty string, got ${typeName(v)}`);
  return undefined;
}

function bool(v, path, errs) {
  if (typeof v === 'boolean') return v;
  errs.push(`${path}: expected a boolean, got ${typeName(v)}`);
  return undefined;
}

function strArray(v, path, errs, { minItems = 0, item = str } = {}) {
  if (!Array.isArray(v)) {
    errs.push(`${path}: expected an array, got ${typeName(v)}`);
    return undefined;
  }
  if (v.length < minItems) errs.push(`${path}: must contain at least ${minItems} item(s)`);
  return v.map((entry, i) => item(entry, `${path}[${i}]`, errs));
}

function port(v, path, errs) {
  if (Number.isInteger(v) && v >= 1024 && v <= 65535) return v;
  errs.push(`${path}: expected an integer from 1024 to 65535, got ${JSON.stringify(v)}`);
  return undefined;
}

/** Path prefix relative to the repo root: no leading slash, no `..` segments, no `.` segments; `.` alone means the whole repo. */
function relativePrefix(v, path, errs) {
  if (str(v, path, errs) === undefined) return undefined;
  if (v.startsWith('/')) errs.push(`${path}: must be relative to the repo root (no leading /)`);
  const segments = v.split(/[\\/]/);
  if (segments.includes('..')) errs.push(`${path}: must not contain .. segments`);
  if (v !== '.' && segments.includes('.')) errs.push(`${path}: must not contain "." segments (use "." alone for the whole repo)`);
  return v;
}

/** Checks that `v` is an object with only `allowed` keys; returns it or undefined. */
function obj(v, path, errs, allowed) {
  if (!isObject(v)) {
    errs.push(`${path || '(root)'}: expected an object, got ${typeName(v)}`);
    return undefined;
  }
  for (const key of Object.keys(v)) {
    if (!allowed.includes(key)) errs.push(`${join_(path, key)}: unknown key (allowed: ${allowed.join(', ')})`);
  }
  return v;
}

function pattern(v, path, errs, allowed) {
  if (str(v, path, errs) === undefined) return undefined;
  for (const [, name] of v.matchAll(/\{([^{}]*)\}/g)) {
    if (!allowed.includes(name)) {
      errs.push(`${path}: unknown placeholder {${name}} (allowed: ${allowed.map((p) => `{${p}}`).join(', ')})`);
    }
  }
  if (/[{}]/.test(v.replace(/\{[^{}]*\}/g, ''))) errs.push(`${path}: unbalanced or stray brace`);
  if (!v.includes('{unit}')) errs.push(`${path}: must contain {unit}`);
  return v;
}

/** Reads `key` of `o`: calls `check` when present, otherwise the default (or "required" error). */
function field(o, key, path, errs, check, { fallback, required = false } = {}) {
  if (!(key in o)) {
    if (required) errs.push(`${join_(path, key)}: required`);
    return fallback === undefined ? undefined : clone(fallback);
  }
  const value = check(o[key], join_(path, key), errs);
  return value === undefined ? fallback && clone(fallback) : value;
}

function stringMap(v, path, errs) {
  if (!obj(v, path, errs, Object.keys(v ?? {}))) return undefined;
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === '__proto__') {
      errs.push(`${path}.${k}: reserved key`);
      continue;
    }
    out[k] = str(val, `${path}.${k}`, errs);
  }
  return out;
}

function worktree(v, path, errs) {
  if (!obj(v, path, errs, ['pathPattern', 'branchPattern'])) return undefined;
  return {
    pathPattern: field(v, 'pathPattern', path, errs, (x, p, e) => pattern(x, p, e, PATH_PLACEHOLDERS), { fallback: DEFAULTS.worktree.pathPattern }),
    branchPattern: field(v, 'branchPattern', path, errs, (x, p, e) => pattern(x, p, e, BRANCH_PLACEHOLDERS), { fallback: DEFAULTS.worktree.branchPattern }),
  };
}

function area(v, path, errs) {
  const keys = ['name', 'dir', 'whenPaths', 'focused', 'full', 'lint', 'build', 'e2e'];
  if (!obj(v, path, errs, keys)) return undefined;
  const out = {
    name: field(v, 'name', path, errs, str, { required: true }),
    dir: field(v, 'dir', path, errs, relativePrefix, { required: true }),
    whenPaths: field(v, 'whenPaths', path, errs, (x, p, e) => strArray(x, p, e, { minItems: 1, item: relativePrefix }), { required: true }),
    focused: field(v, 'focused', path, errs, str, { required: true }),
    full: field(v, 'full', path, errs, str, { required: true }),
  };
  for (const optional of ['lint', 'build', 'e2e']) {
    if (optional in v) out[optional] = str(v[optional], join_(path, optional), errs);
  }
  return out;
}

function checks(v, path, errs) {
  if (!Array.isArray(v)) {
    errs.push(`${path}: expected an array, got ${typeName(v)}`);
    return undefined;
  }
  if (v.length === 0) errs.push(`${path}: must contain at least one area`);
  const seen = new Set();
  return v.map((item, i) => {
    const result = area(item, `${path}[${i}]`, errs);
    if (result?.name !== undefined) {
      if (seen.has(result.name)) errs.push(`${path}[${i}].name: duplicate area name "${result.name}"`);
      seen.add(result.name);
    }
    return result;
  });
}

function models(v, path, errs) {
  if (!obj(v, path, errs, ['planning', 'orchestration', 'implementers'])) return undefined;
  const impl = (x, p, e) => {
    if (!obj(x, p, e, ['default', 'rules'])) return undefined;
    return {
      default: field(x, 'default', p, e, str, { fallback: DEFAULTS.models.implementers.default }),
      rules: field(x, 'rules', p, e, stringMap, { fallback: DEFAULTS.models.implementers.rules }),
    };
  };
  return {
    planning: field(v, 'planning', path, errs, str, { fallback: DEFAULTS.models.planning }),
    orchestration: field(v, 'orchestration', path, errs, str, { fallback: DEFAULTS.models.orchestration }),
    implementers: field(v, 'implementers', path, errs, impl, { fallback: DEFAULTS.models.implementers }),
  };
}

/** Bead ID prefix such as `shipr` or `my-proj`; stored with the trailing `-` (the part of an ID before its suffix). */
function idPrefix(v, path, errs) {
  if (typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9]*(-[A-Za-z0-9]+)*-?$/.test(v)) {
    errs.push(`${path}: expected a bead ID prefix such as "shipr" (letters, digits and single "-" between them), got ${JSON.stringify(v)}`);
    return undefined;
  }
  return v.endsWith('-') ? v : `${v}-`;
}

function tracker(v, path, errs) {
  if (!obj(v, path, errs, ['kind', 'idPrefix'])) return undefined;
  const kind = field(v, 'kind', path, errs, (x, p, e) => {
    if (TRACKER_KINDS.includes(x)) return x;
    e.push(`${p}: must be ${TRACKER_KINDS.map((k) => `"${k}"`).join(' or ')}, got ${JSON.stringify(x)}`);
    return undefined;
  }, { fallback: DEFAULTS.tracker.kind });
  const out = { kind };
  if ('idPrefix' in v) out.idPrefix = idPrefix(v.idPrefix, join_(path, 'idPrefix'), errs);
  return out;
}

/**
 * Layout of the code map by its path: a path ending in `.md` is one file ("file", the original layout),
 * anything else is a folder of per-module files with an `index.md` ("folder").
 */
export function codeMapLayout(path) {
  return /\.md$/i.test(path) ? 'file' : 'folder';
}

function maxDescription(v, path, errs) {
  if (Number.isInteger(v) && v >= 20 && v <= 1000) return v;
  errs.push(`${path}: expected an integer from 20 to 1000, got ${JSON.stringify(v)}`);
  return undefined;
}

function codeMap(v, path, errs) {
  if (!obj(v, path, errs, ['path', 'maxDescription'])) return undefined;
  const mapPath = field(v, 'path', path, errs, relativePrefix, { required: true });
  if (mapPath === undefined) return undefined;
  if (codeMapLayout(mapPath) === 'file') {
    if ('maxDescription' in v) errs.push(`${join_(path, 'maxDescription')}: only applies to the folder layout (a codeMap.path that does not end in .md)`);
    return { path: mapPath };
  }
  if (mapPath === '.') {
    errs.push(`${join_(path, 'path')}: a folder code map needs its own folder, not "." (use e.g. "docs/code-map")`);
    return undefined;
  }
  if (mapPath.startsWith('-')) {
    errs.push(`${join_(path, 'path')}: must not start with "-" (the checker would read it as an option)`);
    return undefined;
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(mapPath)) {
    errs.push(`${join_(path, 'path')}: a folder code map path may only contain letters, digits, ".", "_", "-" and "/" (it is passed to the checker command)`);
    return undefined;
  }
  return {
    path: mapPath.replace(/\/+$/, ''),
    maxDescription: field(v, 'maxDescription', path, errs, maxDescription, { fallback: DEFAULTS.codeMap.maxDescription }),
  };
}

/**
 * The part of the code map config that needs the file system: the folder layout needs `<path>/index.md`.
 * Called by init and update (validateConfig stays pure). The file layout, and no codeMap, are not checked.
 * The folder and `index.md` must be real (no symlinks), so the checker script never reads outside the repository.
 *
 * @param {string} repoRoot
 * @param {object} config validated config
 * @throws {Error} naming codeMap.path and what is missing
 */
export function assertCodeMapOnDisk(repoRoot, config) {
  const map = config.codeMap;
  if (!map || codeMapLayout(map.path) === 'file') return;
  const where = `codeMap.path ${JSON.stringify(map.path)}`;
  const hint = ' (a codeMap.path without .md is a folder; for a single file add the .md suffix)';
  const stat = (rel) => {
    try {
      return lstatSync(join(repoRoot, rel));
    } catch (e) {
      if (e.code === 'ENOENT') return undefined;
      throw new Error(`${where}: cannot inspect ${rel}: ${e.code ?? e.message}`);
    }
  };
  let current = '';
  for (const segment of map.path.split(/[\\/]/)) {
    current = current ? `${current}/${segment}` : segment;
    if (stat(current)?.isSymbolicLink()) throw new Error(`${where}: ${current} is a symlink (the code map folder must be a real folder inside the repository)`);
  }
  const dir = stat(map.path);
  if (!dir) throw new Error(`${where}: folder does not exist; create it with an index.md (the folder layout needs ${map.path}/index.md), or point codeMap.path at a single .md file${hint}`);
  if (!dir.isDirectory()) throw new Error(`${where}: must be a folder, but it is a file (end the path in .md for the single-file layout)`);
  const index = stat(`${map.path}/index.md`);
  if (!index) throw new Error(`${where}: must contain index.md (the folder layout reads the index first, then one module file)${hint}`);
  if (index.isSymbolicLink()) throw new Error(`${where}: ${map.path}/index.md is a symlink`);
  if (!index.isFile()) throw new Error(`${where}: ${map.path}/index.md must be a regular file`);
}

function uiSkill(v, path, errs) {
  if (!obj(v, path, errs, ['name', 'appliesTo'])) return undefined;
  return {
    name: field(v, 'name', path, errs, str, { required: true }),
    appliesTo: field(v, 'appliesTo', path, errs, (x, p, e) => strArray(x, p, e, { minItems: 1, item: relativePrefix }), { required: true }),
  };
}

function findings(v, path, errs) {
  if (!obj(v, path, errs, ['epicTitles'])) return undefined;
  const titles = field(v, 'epicTitles', path, errs, stringMap);
  // User-given titles override the defaults per category; other categories keep their default.
  return { epicTitles: { ...clone(DEFAULTS.findings.epicTitles), ...(titles ?? {}) } };
}

function attribution(v, path, errs) {
  if (!obj(v, path, errs, ['allowAiTrailer'])) return undefined;
  return {
    allowAiTrailer: field(v, 'allowAiTrailer', path, errs, bool, { fallback: DEFAULTS.attribution.allowAiTrailer }),
  };
}

function tokensFile(v, path, errs) {
  if (relativePrefix(v, path, errs) === undefined) return undefined;
  if (v.includes('\\')) errs.push(`${path}: must not contain a backslash`);
  if (!v.endsWith('.css')) errs.push(`${path}: must end in .css`);
  return v;
}

function dashboard(v, path, errs) {
  if (!obj(v, path, errs, ['enabled', 'port', 'tokensFile'])) return undefined;
  const out = {
    enabled: field(v, 'enabled', path, errs, bool, { fallback: DEFAULTS.dashboard.enabled }),
    port: field(v, 'port', path, errs, port, { fallback: DEFAULTS.dashboard.port }),
  };
  if ('tokensFile' in v) out.tokensFile = tokensFile(v.tokensFile, join_(path, 'tokensFile'), errs);
  return out;
}

const TOP_LEVEL = ['baseBranch', 'worktree', 'checks', 'models', 'tracker', 'codeMap', 'uiSkill', 'findings', 'attribution', 'dashboard'];

/**
 * Validates a parsed wavework config and fills defaults. Pure: does not touch the file system.
 * Throws one Error listing every problem as `<json.path>: <reason>`.
 *
 * @param {unknown} raw parsed JSON
 * @returns {object} the config with defaults filled in
 */
export function validateConfig(raw) {
  return validate(raw, undefined);
}

/** Shared by validateConfig and loadConfig; `file` only decorates the error message. */
function validate(raw, file) {
  const errs = [];
  if (!obj(raw, '', errs, TOP_LEVEL)) throw configError(errs, file);

  const config = {
    baseBranch: field(raw, 'baseBranch', '', errs, str, { required: true }),
    worktree: field(raw, 'worktree', '', errs, worktree, { fallback: DEFAULTS.worktree }),
    checks: field(raw, 'checks', '', errs, checks, { required: true }),
    models: field(raw, 'models', '', errs, models, { fallback: DEFAULTS.models }),
    tracker: field(raw, 'tracker', '', errs, tracker, { fallback: DEFAULTS.tracker }),
    findings: field(raw, 'findings', '', errs, findings, { fallback: { epicTitles: DEFAULTS.findings.epicTitles } }),
    attribution: field(raw, 'attribution', '', errs, attribution, { fallback: DEFAULTS.attribution }),
    dashboard: field(raw, 'dashboard', '', errs, dashboard, { fallback: DEFAULTS.dashboard }),
  };
  for (const [key, check] of [['codeMap', codeMap], ['uiSkill', uiSkill]]) {
    if (key in raw) config[key] = check(raw[key], key, errs);
  }

  if (errs.length > 0) throw configError(errs, file);
  return config;
}

function configError(errs, file) {
  const where = file ? ` in ${file}` : '';
  const noun = errs.length === 1 ? 'problem' : 'problems';
  return new Error(`invalid wavework config${where} (${errs.length} ${noun}):\n${errs.map((e) => `  - ${e}`).join('\n')}`);
}

/**
 * Loads and validates `<repoRoot>/.claude/wavework.json`.
 *
 * @param {string} repoRoot
 * @returns {object} validated config with defaults
 */
export function loadConfig(repoRoot) {
  const file = join(repoRoot, CONFIG_PATH);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`wavework config not found: ${file}`);
    throw new Error(`cannot read wavework config ${file}: ${e.message}`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`wavework config is not valid JSON: ${file}: ${e.message}`);
  }
  return validate(raw, file);
}

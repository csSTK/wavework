import { readFileSync } from 'node:fs';
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
  attribution: Object.freeze({ allowAiTrailer: false }),
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

function tracker(v, path, errs) {
  if (!obj(v, path, errs, ['kind'])) return undefined;
  const kind = field(v, 'kind', path, errs, (x, p, e) => {
    if (TRACKER_KINDS.includes(x)) return x;
    e.push(`${p}: must be ${TRACKER_KINDS.map((k) => `"${k}"`).join(' or ')}, got ${JSON.stringify(x)}`);
    return undefined;
  }, { fallback: DEFAULTS.tracker.kind });
  return { kind };
}

function codeMap(v, path, errs) {
  if (!obj(v, path, errs, ['path'])) return undefined;
  return { path: field(v, 'path', path, errs, relativePrefix, { required: true }) };
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

const TOP_LEVEL = ['baseBranch', 'worktree', 'checks', 'models', 'tracker', 'codeMap', 'uiSkill', 'findings', 'attribution'];

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

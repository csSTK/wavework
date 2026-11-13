import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(root + rel, 'utf8');
const pkg = JSON.parse(read('package.json'));

const publish = read('.github/workflows/publish.yml');
const ci = read('.github/workflows/ci.yml');
const changelog = read('CHANGELOG.md');
const readme = read('README.md');

/** The `uses:` references of a workflow file, e.g. "actions/checkout@<sha> # v7.0.1". */
function usesRefs(yaml) {
  return [...yaml.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
}

/** The `on:` block of a workflow: the lines from `on:` up to the next top-level key. */
function onBlock(yaml) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => /^on:/.test(l));
  assert.notEqual(start, -1, 'publish.yml has no top-level on: block');
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

test('publish.yml triggers only on v* tag pushes', () => {
  const on = onBlock(publish);
  assert.match(on, /^\s+push:\s*$/m, 'on: must have a push trigger');
  assert.match(on, /^\s+tags:\s*\n\s+-\s*['"]?v\*['"]?\s*$/m, 'push must filter on tags v*');
  assert.doesNotMatch(on, /branches/, 'publish must not trigger on branches');
  assert.doesNotMatch(on, /pull_request|workflow_dispatch|schedule|release:/, 'publish must not trigger on other events');
});

test('publish job has id-token: write (OIDC for trusted publishing) and contents: read', () => {
  assert.match(publish, /^permissions:\s*\n\s+contents:\s*read\s*$/m, 'top-level permissions must be contents: read');
  const jobPerms = publish.slice(publish.indexOf('jobs:'));
  assert.match(jobPerms, /permissions:\s*\n\s+contents:\s*read\s*\n\s+id-token:\s*write/, 'job permissions must include id-token: write and contents: read');
});

test('publish.yml references no secrets and no NPM_TOKEN', () => {
  const code = publish.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /secrets\./);
  assert.doesNotMatch(code, /NPM_TOKEN|NODE_AUTH_TOKEN/);
});

test('publish.yml pins its actions to the same commit SHAs as ci.yml', () => {
  const refs = usesRefs(publish);
  assert.ok(refs.length >= 2, 'publish.yml should use checkout and setup-node');
  const ciRefs = new Set(usesRefs(ci));
  for (const ref of refs) {
    assert.match(ref, /@[0-9a-f]{40}$/, `"${ref}" must be pinned to a full commit SHA`);
    assert.ok(ciRefs.has(ref), `"${ref}" is not used with the same SHA in ci.yml`);
  }
});

test('setup-node points at the npm registry', () => {
  assert.match(publish, /registry-url:\s*https:\/\/registry\.npmjs\.org/);
});

test('publish runs the tests and the smoke run before publishing, and publishes publicly', () => {
  const testAt = publish.indexOf('run: npm test');
  const smokeAt = publish.indexOf('run: bash scripts/smoke.sh');
  const publishAt = publish.indexOf('run: npm publish --access public');
  assert.notEqual(testAt, -1, 'missing "run: npm test"');
  assert.notEqual(smokeAt, -1, 'missing "run: bash scripts/smoke.sh"');
  assert.notEqual(publishAt, -1, 'missing "run: npm publish --access public"');
  assert.ok(testAt < smokeAt && smokeAt < publishAt, 'order must be npm test, smoke, publish');
});

test('npm is upgraded to a pinned version that supports trusted publishing', () => {
  const m = publish.match(/npm install -g npm@(\d+\.\d+\.\d+)/);
  assert.ok(m, 'publish.yml must install an exact npm version (npm install -g npm@<x.y.z>)');
  const [major, minor, patch] = m[1].split('.').map(Number);
  // Trusted publishing needs npm CLI 11.5.1 or later (https://docs.npmjs.com/trusted-publishers).
  const ok = major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)));
  assert.ok(ok, `npm ${m[1]} is older than 11.5.1`);
});

test('tag guard fails unless the tag equals v + package.json version', () => {
  const guard = publish.match(/^\s*run:\s*(test "v\$\(node[^\n]*)$/m);
  assert.ok(guard, 'publish.yml needs a one-line guard run: test "v$(node -p ...)" = "$TAG"');
  const script = guard[1];
  const env = (tag) => ({ ...process.env, TAG: tag, PATH: process.env.PATH });
  const run = (tag) => spawnSync('bash', ['-c', script], { cwd: root, env: env(tag), encoding: 'utf8' });
  assert.equal(run(`v${pkg.version}`).status, 0, 'matching tag must pass');
  assert.notEqual(run('v9.9.9').status, 0, 'mismatching tag must fail');
  assert.notEqual(run(pkg.version).status, 0, 'a tag without the v prefix must fail');
});

test('CHANGELOG has a [0.1.0] section above the link references, with an empty Unreleased on top', () => {
  assert.equal(pkg.version, '0.1.0');
  const unreleased = changelog.indexOf('## [Unreleased]');
  const released = changelog.indexOf(`## [${pkg.version}] - 2026-11-13`);
  assert.notEqual(unreleased, -1, 'missing ## [Unreleased]');
  assert.notEqual(released, -1, `missing ## [${pkg.version}] - 2026-11-13`);
  assert.ok(unreleased < released, '[Unreleased] must come before the release');
  const between = changelog.slice(unreleased + '## [Unreleased]'.length, released);
  assert.doesNotMatch(between, /^### /m, '[Unreleased] must be empty after the cut');
});

test('CHANGELOG has link references for Unreleased and the release', () => {
  assert.match(changelog, new RegExp(`^\\[Unreleased\\]: https://github\\.com/csSTK/wavework/compare/v${pkg.version.replace(/\./g, '\\.')}\\.\\.\\.HEAD$`, 'm'));
  assert.match(changelog, new RegExp(`^\\[${pkg.version.replace(/\./g, '\\.')}\\]: https://github\\.com/csSTK/wavework/releases/tag/v${pkg.version.replace(/\./g, '\\.')}$`, 'm'));
});

test('docs/releasing.md exists, is linked from README Development, and covers the release steps', () => {
  assert.ok(existsSync(root + 'docs/releasing.md'), 'docs/releasing.md is missing');
  const doc = read('docs/releasing.md');
  for (const needle of ['publish.yml', 'id-token', 'npm view wavework version', 'npm audit signatures', 'git push origin v', 'csSTK']) {
    assert.ok(doc.includes(needle), `docs/releasing.md must mention "${needle}"`);
  }
  const dev = readme.slice(readme.indexOf('## Development'), readme.indexOf('## License'));
  assert.ok(dev.includes('docs/releasing.md'), 'README Development section must link docs/releasing.md');
});

test('README status line says 0.1.0 is the first release', () => {
  assert.match(readme, /\*\*Status: 0\.1\.0, first release\. Expect changes before 1\.0\.\*\*/);
  assert.doesNotMatch(readme, /pre-release/i);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('CHANGELOG has a section for the current version above the link references, with an empty Unreleased on top', () => {
  assert.equal(pkg.version, '0.3.1');
  const unreleased = changelog.indexOf('## [Unreleased]');
  const released = changelog.indexOf(`## [${pkg.version}] - 2026-11-14`);
  assert.notEqual(unreleased, -1, 'missing ## [Unreleased]');
  assert.notEqual(released, -1, `missing ## [${pkg.version}] - 2026-11-14`);
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

/** The steps of publish.yml's job, as { name, block } in file order. */
function publishSteps(yaml) {
  const starts = [...yaml.matchAll(/^      - name: (.*)$/gm)];
  return starts.map((m, i) => ({
    name: m[1],
    block: yaml.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : yaml.length),
  }));
}

/** The step whose name starts with `prefix`; fails the test if there is none. */
function stepNamed(prefix) {
  const step = publishSteps(publish).find((s) => s.name.startsWith(prefix));
  assert.ok(step, `publish.yml has no step named "${prefix}..."`);
  return step;
}

/** The multi-line `run: |` script of a step, dedented. */
function runScript(block) {
  const lines = block.split('\n');
  const i = lines.findIndex((l) => /^\s+run:\s*\|\s*$/.test(l));
  assert.notEqual(i, -1, 'step has no multi-line run: | script');
  const body = [];
  for (const line of lines.slice(i + 1)) {
    if (line.trim() !== '' && !/^ {10}/.test(line)) break;
    body.push(line.slice(10));
  }
  return body.join('\n');
}

/** Runs the published-check script with a stubbed npm; returns status, stderr and GITHUB_OUTPUT. */
function runPublishedCheck(npmBehaviour) {
  const dir = mkdtempSync(join(tmpdir(), 'wavework-npm-stub-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'npm'), [
      '#!/usr/bin/env bash',
      'case "$NPM_STUB" in',
      '  version) echo "${2#*@}" ;;',
      '  e404) echo "npm error code E404" >&2; echo "npm error 404 Not Found - GET https://registry.npmjs.org/wavework" >&2; exit 1 ;;',
      '  empty) ;;',
      '  other) echo "npm error code ECONNRESET" >&2; exit 1 ;;',
      'esac',
      '',
    ].join('\n'), { mode: 0o755 });
    const outFile = join(dir, 'github-output');
    writeFileSync(outFile, '');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', runScript(stepNamed('Check whether').block)], {
      cwd: root,
      env: { PATH: `${bin}:${process.env.PATH}`, NPM_STUB: npmBehaviour, GITHUB_OUTPUT: outFile },
      encoding: 'utf8',
    });
    return { status: result.status, stderr: result.stderr, output: readFileSync(outFile, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the published check runs after the tag guard and before the tests', () => {
  const names = publishSteps(publish).map((s) => s.name);
  const guard = names.findIndex((n) => /tag/i.test(n));
  const check = names.findIndex((n) => n.startsWith('Check whether'));
  const test_ = names.findIndex((n) => n === 'Test');
  assert.ok(guard !== -1 && check !== -1 && test_ !== -1, `steps: ${names.join(' | ')}`);
  assert.ok(guard < check && check < test_, 'order must be tag guard, published check, Test');
  assert.match(stepNamed('Check whether').block, /^\s+id: published\s*$/m, 'the check step needs id: published');
});

test('the published check writes exists=true when npm returns the version', () => {
  const r = runPublishedCheck('version');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.output, 'exists=true\n');
});

test('the published check writes exists=false on E404 (version not published yet)', () => {
  const r = runPublishedCheck('e404');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.output, 'exists=false\n');
});

test('the published check writes exists=false when npm prints nothing and exits 0', () => {
  const r = runPublishedCheck('empty');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.output, 'exists=false\n');
});

test('the published check fails the job on any other npm error instead of skipping the publish', () => {
  const r = runPublishedCheck('other');
  assert.notEqual(r.status, 0, 'a non-404 npm error must fail the step');
  assert.equal(r.output, '', 'no output may be written, so the publish cannot be skipped silently');
  assert.match(r.stderr, /ECONNRESET/, 'the npm error must be shown in the log');
});

test('Publish runs only when the published check says the version is not on npm', () => {
  const publishStep = stepNamed('Publish');
  assert.match(publishStep.block, /^\s+if: steps\.published\.outputs\.exists != 'true'\s*$/m);
  assert.match(publishStep.block, /run: npm publish --access public/);
});

test('Test and smoke steps are not skipped by the published check', () => {
  for (const prefix of ['Test', 'Smoke run']) {
    assert.doesNotMatch(stepNamed(prefix).block, /^\s+if:/m, `"${prefix}" must always run`);
  }
});

test('a notice step reports the skipped publish when the version already exists', () => {
  const notice = publishSteps(publish).find((s) => /^\s+if: steps\.published\.outputs\.exists == 'true'\s*$/m.test(s.block));
  assert.ok(notice, 'missing a step that runs when steps.published.outputs.exists == true');
  assert.match(notice.block, /::notice::.*already on npm, publish skipped/);
});

test('docs/releasing.md explains the manual 0.1.0 release, the v0.1.0 marker and the skip on re-runs', () => {
  const doc = read('docs/releasing.md');
  for (const needle of ['published manually', 'marker', 'already', 'trusted publisher', '0.1.1']) {
    assert.ok(doc.includes(needle), `docs/releasing.md must mention "${needle}"`);
  }
  assert.doesNotMatch(doc, /Confirm on npmjs\.com whether the settings for `wavework` are available/, 'the open first-publish question is answered and must be removed');
});

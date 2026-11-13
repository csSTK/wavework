// Opt-in browser check of the dashboard UI, NOT part of `npm test` (wavework has no runtime or dev dependencies,
// and Playwright is neither): node e2e/dashboard.e2e.mjs
// Starts the real server (createServer) on a temp fixture store and drives it with a Playwright that is resolved
// from the current directory (or from WAVEWORK_E2E_PLAYWRIGHT_DIR, a directory with node_modules/@playwright/test
// or node_modules/playwright). One-time: `npx playwright install chromium`. Exit code 0 = pass.
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../templates/dashboard/server.mjs';

const require = createRequire(path.join(path.resolve(process.env.WAVEWORK_E2E_PLAYWRIGHT_DIR ?? process.cwd()), 'package.json'));
let chromium;
for (const name of ['@playwright/test', 'playwright']) {
  try { ({ chromium } = require(name)); break; } catch { /* try the next one */ }
}
if (!chromium) {
  console.error('dashboard e2e: Playwright not found. Run it from a directory that has it installed, or set WAVEWORK_E2E_PLAYWRIGHT_DIR.');
  process.exit(2);
}

const T = (s) => `2026-11-13T10:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000Z`;
const store = mkdtempSync(path.join(tmpdir(), 'pipeline-e2e-'));
function writeRun(run, events) {
  const dir = path.join(store, run.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run));
  writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify({ run: run.id, ...e })).join('\n') + '\n');
}

writeRun({ id: 'epic.done-one', kind: 'next-task', units: ['d1'], parent: null, branch: 'epic/<img src=x onerror=window.__xss=1>', worktree: '/w', status: 'done', started: T(0), ended: T(300) }, [
  { ts: T(0), type: 'run-start' },
  { ts: T(5), type: 'step-start', step: 'plan' }, { ts: T(30), type: 'step-end', step: 'plan' },
  { ts: T(31), type: 'step-start', step: 'wave', wave: 1 },
  { ts: T(32), type: 'child-start', bead: 'd1.1', model: 'sonnet', wave: 1 },
  { ts: T(100), type: 'agent', agentId: 'a1', bead: 'd1.1', model: 'sonnet', durationMs: 60000, tokensIn: 1000, tokensOut: 500, tokensCacheRead: 2000, tokensCacheWrite: 100, cost: 0.42 },
  { ts: T(110), type: 'child-end', bead: 'd1.1', result: 'ok', redBeforeGreen: 'FooTest fails' },
  { ts: T(111), type: 'child-start', bead: 'd1.2', model: 'haiku', wave: 1 },
  { ts: T(120), type: 'agent', agentId: 'a2', bead: 'd1.2', model: 'mystery', durationMs: 1000, tokensIn: 10, tokensOut: 5 },
  { ts: T(130), type: 'child-end', bead: 'd1.2', result: 'ok' },
  { ts: T(131), type: 'step-end', step: 'wave', wave: 1 },
  { ts: T(140), type: 'review', bead: 'd1.1', verdict: 'pass', mustFix: 0, round: 1 },
  { ts: T(150), type: 'tests', scope: 'backend', passed: 12, failed: 1, duration: 9 },
  { ts: T(160), type: 'finding', bead: 'find-1' },
  { ts: T(200), type: 'step-start', step: 'push' }, { ts: T(210), type: 'step-end', step: 'push', sha: 'abc1234def' },
  { ts: T(300), type: 'run-end' },
]);
writeRun({ id: 'epic.live-one', kind: 'beads', units: ['l1'], parent: null, branch: 'task/l1', worktree: '/w2', status: 'running', started: T(400), ended: null }, [
  { ts: T(400), type: 'run-start' }, { ts: T(401), type: 'step-start', step: 'plan' },
]);

const ghRunner = async () => JSON.stringify([
  { name: 'CI', status: 'completed', conclusion: 'success', url: 'https://github.com/x/y/actions/runs/1' },
  { name: 'Evil', status: 'completed', conclusion: 'success', url: 'javascript:window.__xss=1' },
]);
const server = createServer({ storeDir: store, port: 0, project: 'e2e-project', ghRunner, watch: 'poll', pollMs: 100 });
await server.listen();
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // List: both runs visible, running first, no horizontal scroll, no cost invented.
  await page.goto(base);
  await page.locator('.brand', { hasText: 'e2e-project' }).waitFor(); // project name from /api/info, not a hard-coded one
  const rows = page.locator('[data-testid=run-row]');
  await rows.first().waitFor();
  assert.equal(await rows.count(), 2);
  assert.match(await rows.first().innerText(), /task\/l1/);
  assert.match(await rows.first().innerText(), /Running/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'list overflows horizontally');
  await page.locator('[data-testid=run-row]', { hasText: 'CI passed' }).waitFor();

  // Live update without reload: append an event, expect the running run to refresh.
  await page.evaluate(() => { window.__marker = 'same-page'; });
  appendFileSync(path.join(store, 'epic.live-one', 'events.jsonl'), JSON.stringify({ run: 'epic.live-one', ts: T(450), type: 'run-end', status: 'blocked' }) + '\n');
  writeFileSync(path.join(store, 'epic.live-one', 'run.json'), JSON.stringify({ id: 'epic.live-one', kind: 'beads', units: ['l1'], parent: null, branch: 'task/l1', worktree: '/w2', status: 'blocked', started: T(400), ended: T(450) }));
  await page.locator('[data-testid=run-row]', { hasText: 'Blocked' }).waitFor({ timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__marker), 'same-page');

  // Keyboard focus survives the periodic refresh (short interval via ?refresh=).
  await page.goto(`${base}/?refresh=150`);
  await rows.first().waitFor();
  await page.locator('[data-testid=run-row] a.link').first().focus();
  const focusedRun = await page.evaluate(() => document.activeElement?.closest('[data-run]')?.dataset.run);
  assert.ok(focusedRun, 'link not focusable');
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-run]')?.dataset.run), focusedRun, 'focus lost on refresh');
  await page.goto(base);
  await rows.first().waitFor();

  // Detail via click and via deep link.
  await page.locator('[data-testid=run-row]', { hasText: 'epic/<img' }).click();
  await page.locator('[data-testid=run-detail]').waitFor();
  const detail = page.locator('[data-testid=run-detail]');
  const text = await detail.innerText();
  assert.match(text, /d1\.1/);
  assert.match(text, /sonnet/);
  assert.match(text, /FooTest fails/);
  assert.match(text, /find-1/);
  assert.match(text, /abc1234/);
  assert.match(text, /Wave 1/);
  assert.match(text, /round 1/);
  assert.match(text, /estimate/i);
  assert.equal(await page.locator('[data-testid=child-row]', { hasText: 'd1.1' }).locator('[data-col=tokens]').innerText(), '3.6k');
  assert.equal(await page.locator('[data-testid=child-row]', { hasText: 'd1.2' }).locator('[data-col=cost]').innerText(), '—');
  assert.doesNotMatch(text, /\$0\.00/);
  assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
  assert.equal(await page.locator('a[href^="https://github.com/x/y/actions/runs/1"]').count(), 1);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'untrusted branch name executed');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'detail overflows horizontally');

  await page.goto(`${base}/#/runs/epic.done-one`);
  await page.locator('[data-testid=run-detail]').waitFor();
  await page.goBack();

  // Phone width: no horizontal page scroll, children readable (stacked, not one letter per line).
  await page.setViewportSize({ width: 390, height: 800 });
  for (const hash of ['#/', '#/runs/epic.done-one']) {
    await page.goto(`${base}/${hash}`);
    await page.locator(hash === '#/' ? '[data-testid=run-row]' : '[data-testid=child-row]').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${hash} overflows at 390px`);
  }
  const bead = await page.locator('[data-testid=child-row]').first().locator('td').first().boundingBox();
  assert.ok(bead.height < 60, `bead id wraps per letter (height ${bead.height})`);
  const stacked = await page.locator('[data-testid=child-row]').first().locator('td').nth(3)
    .evaluate((el) => [getComputedStyle(el).display, el.getAttribute('data-label')]);
  assert.deepEqual(stacked, ['flex', 'Duration']);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Unknown id shows an error state, not a blank page.
  await page.goto(`${base}/#/runs/epic.nope`);
  await page.locator('[data-testid=error-state]').waitFor();

  // Dark scheme and reduced motion render without errors.
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto(`${base}/#/`);
  await rows.first().waitFor();
  assert.deepEqual(errors, []);
  console.log('ui e2e: ok');
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  await server.close();
  rmSync(store, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);

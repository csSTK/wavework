import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ciBadge, formatCost, formatDuration, formatTokens, findingsOf, parseRoute, relativeTime,
  reviewsByBead, resultBadge, safeHref, formatStarted, tokensOf, stepLabel, reviewRows, sortRuns, statusBadge, totalTokens, pipelineView,
} from '../../templates/dashboard/public/format.mjs';
import { deriveTimeline } from '../../templates/dashboard/lib/derive.mjs';

test('formatDuration: unknown is a dash, then s / m / h', () => {
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(undefined), '—');
  assert.equal(formatDuration(-5), '—');
  assert.equal(formatDuration(450), '<1s');
  assert.equal(formatDuration(45_000), '45s');
  assert.equal(formatDuration(192_000), '3m 12s');
  assert.equal(formatDuration(3_900_000), '1h 5m');
});

test('formatCost: null is a dash, never $0.00; marked as estimate with ~', () => {
  assert.equal(formatCost(null), '—');
  assert.equal(formatCost(undefined), '—');
  assert.equal(formatCost(NaN), '—');
  assert.equal(formatCost(1.234), '~$1.23');
  assert.equal(formatCost(0.0004), '<$0.01');
  assert.equal(formatCost(0), '~$0.00');
});

test('formatTokens compacts large numbers', () => {
  assert.equal(formatTokens(null), '—');
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(12_300), '12.3k');
  assert.equal(formatTokens(2_400_000), '2.4M');
});

test('totalTokens sums in, out and cache', () => {
  assert.equal(totalTokens({ tokensIn: 1, tokensOut: 2, tokensCacheRead: 3, tokensCacheWrite: 4 }), 10);
  assert.equal(totalTokens(null), null);
});

test('statusBadge maps status to label and tone, unknown falls back to neutral', () => {
  assert.deepEqual(statusBadge('running'), { label: 'Running', tone: 'info' });
  assert.deepEqual(statusBadge('done'), { label: 'Done', tone: 'ok' });
  assert.deepEqual(statusBadge('blocked'), { label: 'Blocked', tone: 'warn' });
  assert.deepEqual(statusBadge('failed'), { label: 'Failed', tone: 'bad' });
  assert.deepEqual(statusBadge('weird'), { label: 'weird', tone: 'neutral' });
});

test('ciBadge: null means no CI column content, states map to tones', () => {
  assert.equal(ciBadge(null), null);
  assert.deepEqual(ciBadge({ state: 'success' }), { label: 'CI passed', tone: 'ok' });
  assert.deepEqual(ciBadge({ state: 'failure' }), { label: 'CI failed', tone: 'bad' });
  assert.deepEqual(ciBadge({ state: 'pending' }), { label: 'CI running', tone: 'info' });
  assert.deepEqual(ciBadge({ state: 'none' }), { label: 'No CI', tone: 'neutral' });
  assert.deepEqual(ciBadge({ state: 'unknown' }), { label: 'CI unknown', tone: 'neutral' });
});

test('safeHref only lets http(s) through', () => {
  assert.equal(safeHref('https://github.com/a/b/actions/runs/1'), 'https://github.com/a/b/actions/runs/1');
  assert.equal(safeHref('http://x.test/'), 'http://x.test/');
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('JaVaScript:alert(1)'), null);
  assert.equal(safeHref('data:text/html,x'), null);
  assert.equal(safeHref('//evil.test'), null);
  assert.equal(safeHref(null), null);
  assert.equal(safeHref(42), null);
});

test('sortRuns: running first, then newest started; does not mutate', () => {
  const runs = [
    { id: 'a', status: 'done', started: '2026-11-13T10:00:00Z' },
    { id: 'b', status: 'running', started: '2026-11-13T08:00:00Z' },
    { id: 'c', status: 'blocked', started: '2026-11-13T11:00:00Z' },
    { id: 'd', status: 'running', started: '2026-11-13T09:00:00Z' },
  ];
  const copy = structuredClone(runs);
  assert.deepEqual(sortRuns(runs).map((r) => r.id), ['d', 'b', 'c', 'a']);
  assert.deepEqual(runs, copy);
});

test('parseRoute: list, run detail, encoded ids, junk falls back to list', () => {
  assert.deepEqual(parseRoute(''), { view: 'list' });
  assert.deepEqual(parseRoute('#/'), { view: 'list' });
  assert.deepEqual(parseRoute('#/runs/epic.shipr-1hxo-pipeline-dashboard'), { view: 'run', id: 'epic.shipr-1hxo-pipeline-dashboard' });
  assert.deepEqual(parseRoute('#/runs/a%2Eb'), { view: 'run', id: 'a.b' });
  assert.deepEqual(parseRoute('#/runs/'), { view: 'list' });
  assert.deepEqual(parseRoute('#/runs/%E0%A4%A'), { view: 'list' });
  assert.deepEqual(parseRoute('#/nope'), { view: 'list' });
});

test('relativeTime', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  assert.equal(relativeTime(null, now), '—');
  assert.equal(relativeTime('2026-11-13T11:59:50Z', now), 'just now');
  assert.equal(relativeTime('2026-11-13T11:55:00Z', now), '5m ago');
  assert.equal(relativeTime('2026-11-13T09:00:00Z', now), '3h ago');
  assert.equal(relativeTime('2026-11-10T12:00:00Z', now), '3d ago');
});

test('reviewsByBead groups review events by bead; events without bead are skipped', () => {
  const events = [
    { type: 'review', bead: 'x.1', verdict: 'fix', round: 1 },
    { type: 'review', bead: 'x.1', verdict: 'pass', round: 2 },
    { type: 'review', verdict: 'pass', round: 1 },
    { type: 'tests' },
  ];
  const m = reviewsByBead(events);
  assert.deepEqual(m.get('x.1'), { verdict: 'pass', round: 2 });
  assert.equal(m.size, 1);
});

test('findingsOf lists finding bead ids', () => {
  assert.deepEqual(findingsOf([{ type: 'finding', bead: 'f1' }, { type: 'tests' }, { type: 'finding', bead: 'f2' }, { type: 'finding' }]), ['f1', 'f2']);
});

test('reviewsByBead shows the highest round seen, even when only the final round was recorded', () => {
  const m = reviewsByBead([{ type: 'review', bead: 'y', verdict: 'pass', round: 3 }]);
  assert.deepEqual(m.get('y'), { verdict: 'pass', round: 3 });
  const m2 = reviewsByBead([{ type: 'review', bead: 'y', verdict: 'pass', round: 3 }, { type: 'review', bead: 'y', verdict: 'fix', round: 1 }]);
  assert.deepEqual(m2.get('y'), { verdict: 'pass', round: 3 });
});

test('resultBadge: committed/ok are success, blocked warn, failed bad, none is null', () => {
  assert.deepEqual(resultBadge('committed'), { label: 'committed', tone: 'ok' });
  assert.equal(resultBadge('ok').tone, 'ok');
  assert.equal(resultBadge('blocked').tone, 'warn');
  assert.equal(resultBadge('failed').tone, 'bad');
  assert.equal(resultBadge('running').tone, 'info');
  assert.equal(resultBadge(null), null);
});

test('tokensOf: dash without agents, 0 only when agents really used 0', () => {
  assert.equal(tokensOf({ agents: 0, tokensIn: 0 }), null);
  assert.equal(tokensOf(null), null);
  assert.equal(tokensOf({ agents: 2, tokensIn: 0, tokensOut: 0 }), 0);
  assert.equal(tokensOf({ agents: 1, tokensIn: 5, tokensOut: 5 }), 10);
});

test('formatStarted: compact, no wrap-prone locale string', () => {
  assert.equal(formatStarted(null), '—');
  assert.equal(formatStarted('garbage'), '—');
  const out = formatStarted('2026-11-13T10:44:24Z', 'en-GB', 'UTC');
  assert.equal(out, '13 Nov, 10:44');
});

test('stepLabel capitalises and names waves', () => {
  assert.equal(stepLabel({ step: 'wave', wave: 2 }), 'Wave 2');
  assert.equal(stepLabel({ step: 'wave', wave: null }), 'Wave');
  assert.equal(stepLabel({ step: 'deps', wave: null }), 'Deps');
  assert.equal(stepLabel({ step: 'review', wave: 1 }), 'Review · wave 1');
});

test('reviewRows lists review events with bead, newest first', () => {
  const rows = reviewRows([
    { type: 'review', ts: '1', bead: 'a', verdict: 'fix', round: 1, mustFix: 2 },
    { type: 'tests' },
    { type: 'review', ts: '2', verdict: 'pass', round: 2 },
  ]);
  assert.deepEqual(rows.map((r) => [r.bead, r.round, r.mustFix]), [[null, 2, 0], ['a', 1, 2]]);
});

/* ---------- pipelineView ---------- */
const ev = (ts, type, fields = {}) => ({ ts: `2026-11-14T10:${String(ts).padStart(2, '0')}:00.000Z`, type, ...fields });
const viewFor = (run, events, ci = null, members = []) => pipelineView({ run, events, timeline: deriveTimeline(run, events), ci }, members);
const brief = (v) => v.stages.map((s) => `${s.id}:${s.status}`);

test('pipelineView: a running run shows done, current and queued stages and what the agents do now', () => {
  const run = { id: 'r', kind: 'next-task', status: 'running', started: '2026-11-14T10:00:00.000Z' };
  const events = [
    ev(0, 'step-start', { step: 'plan' }), ev(1, 'step-start', { step: 'deps' }), ev(2, 'step-end', { step: 'deps' }), ev(3, 'step-end', { step: 'plan' }),
    ev(4, 'step-start', { step: 'wave', wave: 1 }),
    ev(5, 'child-start', { bead: 'b.1', model: 'sonnet', wave: 1 }), ev(5, 'child-start', { bead: 'b.2', model: 'haiku', wave: 1 }),
    ev(9, 'review', { bead: 'b.1', verdict: 'FIX', mustFix: 2, round: 1 }),
  ];
  const v = viewFor(run, events);
  assert.deepEqual(brief(v), ['plan:success', 'wave-1:in_progress', 'finish:queued', 'ci:queued']);
  assert.deepEqual(v.stages[0].sub.map((x) => x.label), ['Deps']);
  assert.equal(v.activity, 'Wave 1 · b.1 (sonnet) fixing review round 1 · b.2 (haiku) implementing');
  assert.deepEqual(v.problems.map((p) => [p.level, p.stage, p.title]), [['warning', 'wave-1', 'Review of b.1 asked for 2 fixes (round 1)']]);
  assert.equal(v.stages[1].problems.warning, 1);
  assert.equal(v.lastEventTs, events[events.length - 1].ts);
});

test('pipelineView: a blocked run marks the stage it stopped in as failed and lists the problems there', () => {
  const run = { id: 'r', kind: 'next-task', status: 'blocked', started: '2026-11-14T10:00:00.000Z', ended: '2026-11-14T10:30:00.000Z' };
  const events = [
    ev(0, 'step-start', { step: 'plan' }), ev(1, 'step-end', { step: 'plan' }), ev(2, 'step-start', { step: 'wave', wave: 1 }),
    ev(3, 'child-start', { bead: 'b.1', wave: 1 }), ev(4, 'tests', { scope: 'backend', passed: 4, failed: 2 }),
    ev(5, 'review', { bead: 'b.1', verdict: 'FIX', mustFix: 1, round: 3 }), ev(6, 'child-end', { bead: 'b.1', result: 'blocked' }),
  ];
  const v = viewFor(run, events);
  assert.deepEqual(brief(v), ['plan:success', 'wave-1:failure', 'finish:skipped', 'ci:skipped']);
  assert.equal(v.activity, null);
  assert.deepEqual(v.problems.map((p) => [p.level, p.stage, p.title]), [
    ['failure', 'wave-1', '2 backend tests failed'],
    ['failure', 'wave-1', 'Review of b.1 asked for 1 fix (round 3)'],
    ['failure', 'wave-1', 'b.1 blocked'],
    ['failure', 'wave-1', 'Run blocked in Wave 1'],
  ]);
});

test('pipelineView: finish collects review and push, a resolved review is a warning, CI state becomes the CI stage', () => {
  const run = { id: 'r', kind: 'next-task', status: 'done', started: '2026-11-14T10:00:00.000Z', ended: '2026-11-14T10:40:00.000Z' };
  const events = [
    ev(0, 'step-start', { step: 'plan' }), ev(1, 'step-end', { step: 'plan' }),
    ev(2, 'step-start', { step: 'wave', wave: 1 }), ev(3, 'child-start', { bead: 'b.1', wave: 1 }),
    ev(4, 'review', { bead: 'b.1', verdict: 'FIX', mustFix: 1, round: 1 }), ev(5, 'review', { bead: 'b.1', verdict: 'PASS', round: 2 }),
    ev(6, 'child-end', { bead: 'b.1', result: 'committed' }), ev(7, 'step-end', { step: 'wave', wave: 1 }),
    ev(8, 'step-start', { step: 'finish' }), ev(9, 'step-start', { step: 'review' }), ev(10, 'step-end', { step: 'review' }),
    ev(11, 'step-start', { step: 'push' }), ev(12, 'step-end', { step: 'push', sha: 'abcdef1234' }), ev(13, 'step-end', { step: 'finish' }),
  ];
  const v = viewFor(run, events, { sha: 'abcdef1234', state: 'failure', runs: [{ name: 'build', conclusion: 'failure' }, { name: 'lint', conclusion: 'success' }] });
  assert.deepEqual(brief(v), ['plan:success', 'wave-1:success', 'finish:success', 'ci:failure']);
  assert.deepEqual(v.stages[2].sub.map((x) => `${x.label}:${x.status}`), ['Review:success', 'Push:success']);
  assert.deepEqual(v.problems.map((p) => [p.level, p.stage, p.detail]), [['warning', 'wave-1', 'passed in round 2'], ['failure', 'ci', 'build']]);
  assert.equal(v.stages[1].beads[0].reviewRounds, 2);
});

test('pipelineView: a batch has one stage per epic, units not started yet are queued', () => {
  const run = { id: 'batch.a', kind: 'batch', units: ['a', 'b', 'c'], status: 'running', started: '2026-11-14T10:00:00.000Z' };
  const members = [
    { id: 'epic.b', units: ['b'], status: 'running', started: '2026-11-14T10:20:00.000Z', ended: null },
    { id: 'epic.a', units: ['a'], status: 'blocked', started: '2026-11-14T10:00:00.000Z', ended: '2026-11-14T10:19:00.000Z' },
  ];
  const v = viewFor(run, [ev(0, 'run-start')], null, members);
  assert.deepEqual(brief(v), ['member:epic.a:failure', 'member:epic.b:in_progress', 'unit:c:queued']);
  assert.equal(v.activity, 'Working on b');
  assert.deepEqual(v.problems.map((p) => p.title), ['a blocked']);
});

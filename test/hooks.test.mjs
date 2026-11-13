import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHooks, parseHookDefs } from '../src/cli/hooks.mjs';

const E1 = { matcher: 'Bash', hooks: [{ type: 'command', command: 'wavework-a' }] };
const E2 = { hooks: [{ type: 'command', command: 'wavework-b' }] };
const FOREIGN = { matcher: 'Bash', hooks: [{ type: 'command', command: 'theirs' }] };

const defs = parseHookDefs({ hooks: { PreToolUse: [E1], SessionStart: [E2] } });

test('parseHookDefs flattens events, rejects malformed definitions', () => {
  assert.deepEqual(defs, [{ event: 'PreToolUse', entry: E1 }, { event: 'SessionStart', entry: E2 }]);
  assert.deepEqual(parseHookDefs({ hooks: {} }), []);
  assert.throws(() => parseHookDefs({ hooks: { X: 'nope' } }), /hooks\.X/);
  assert.throws(() => parseHookDefs({ hooks: { X: [5] } }), /hooks\.X\[0\]/);
  assert.throws(() => parseHookDefs({}), /"hooks"/);
});

test('adds entries to empty settings and records them as owned', () => {
  const { settings, owned } = mergeHooks({}, defs, []);
  assert.deepEqual(settings, { hooks: { PreToolUse: [E1], SessionStart: [E2] } });
  assert.deepEqual(owned, defs);
});

test('is idempotent: merging twice changes nothing and adds no duplicates', () => {
  const first = mergeHooks({}, defs, []);
  const second = mergeHooks(first.settings, defs, first.owned);
  assert.deepEqual(second.settings, first.settings);
  assert.deepEqual(second.owned, first.owned);
});

test('keeps foreign hooks in place and order, appends ours, preserves unknown keys', () => {
  const input = { model: 'x', permissions: { allow: ['a'] }, hooks: { PreToolUse: [FOREIGN], Stop: [FOREIGN] } };
  const { settings } = mergeHooks(input, defs, []);
  assert.deepEqual(settings.hooks.PreToolUse, [FOREIGN, E1]);
  assert.deepEqual(settings.hooks.Stop, [FOREIGN]);
  assert.equal(settings.model, 'x');
  assert.deepEqual(settings.permissions, { allow: ['a'] });
  assert.deepEqual(Object.keys(settings), ['model', 'permissions', 'hooks']);
});

test('does not mutate its input', () => {
  const input = { hooks: { PreToolUse: [FOREIGN] } };
  const copy = structuredClone(input);
  mergeHooks(input, defs, []);
  assert.deepEqual(input, copy);
});

test('removes only previously owned entries that are no longer defined', () => {
  const start = mergeHooks({ hooks: { PreToolUse: [FOREIGN] } }, defs, []);
  const next = mergeHooks(start.settings, parseHookDefs({ hooks: { PreToolUse: [E1] } }), start.owned);
  assert.deepEqual(next.settings.hooks, { PreToolUse: [FOREIGN, E1] });
  assert.deepEqual(next.owned, [{ event: 'PreToolUse', entry: E1 }]);
});

test('a changed definition replaces the old owned entry, foreign twin of other content stays', () => {
  const start = mergeHooks({}, defs, []);
  const E1v2 = { matcher: 'Bash', hooks: [{ type: 'command', command: 'wavework-a2' }] };
  const next = mergeHooks(start.settings, parseHookDefs({ hooks: { PreToolUse: [E1v2], SessionStart: [E2] } }), start.owned);
  assert.deepEqual(next.settings.hooks.PreToolUse, [E1v2]);
});

test('removing the last owned entry of an event drops the empty event and empty hooks key', () => {
  const start = mergeHooks({ other: 1 }, defs, []);
  const next = mergeHooks(start.settings, [], start.owned);
  assert.deepEqual(next.settings, { other: 1 });
  assert.deepEqual(next.owned, []);
});

test('an owned entry the user edited locally is left alone (not deep-equal anymore)', () => {
  const start = mergeHooks({}, defs, []);
  const edited = structuredClone(start.settings);
  edited.hooks.PreToolUse[0].matcher = 'Edit';
  const next = mergeHooks(edited, [], start.owned);
  assert.equal(next.settings.hooks.PreToolUse[0].matcher, 'Edit');
});

test('nothing to add and nothing to remove leaves settings without a hooks key', () => {
  assert.deepEqual(mergeHooks({ a: 1 }, [], []).settings, { a: 1 });
});

test('rejects settings with a non-object hooks or non-array event', () => {
  assert.throws(() => mergeHooks({ hooks: [] }, defs, []), /hooks/);
  assert.throws(() => mergeHooks({ hooks: { PreToolUse: 'x' } }, defs, []), /PreToolUse/);
});

test('an identical entry that already existed is foreign: not owned, never removed later', () => {
  const first = mergeHooks({ hooks: { PreToolUse: [E1] } }, defs, []);
  assert.deepEqual(first.settings.hooks.PreToolUse, [E1]);
  assert.deepEqual(first.owned, [{ event: 'SessionStart', entry: E2 }]);
  const gone = mergeHooks(first.settings, [], first.owned);
  assert.deepEqual(gone.settings.hooks, { PreToolUse: [E1] });
});

test('an owned, still defined entry missing from settings is not re-added, stays owned, and is reported as lost', () => {
  const start = mergeHooks({}, defs, []);
  const edited = structuredClone(start.settings);
  edited.hooks.PreToolUse[0].matcher = 'Edit'; // user changed it: no longer equal to E1
  const next = mergeHooks(edited, defs, start.owned);
  assert.deepEqual(next.settings.hooks.PreToolUse, [{ ...E1, matcher: 'Edit' }]);
  assert.deepEqual(next.lost, [{ event: 'PreToolUse', entry: E1 }]);
  assert.deepEqual(next.owned, start.owned);
  assert.deepEqual(mergeHooks(start.settings, defs, start.owned).lost, []);
});

test('parseHookDefs: "features" entries only count when the feature is enabled', () => {
  const json = { hooks: { PreToolUse: [E1] }, features: { dashboard: { hooks: { SessionStart: [E2] } } } };
  assert.deepEqual(parseHookDefs(json), [{ event: 'PreToolUse', entry: E1 }]);
  assert.deepEqual(parseHookDefs(json, ['other']), [{ event: 'PreToolUse', entry: E1 }]);
  assert.deepEqual(parseHookDefs(json, ['dashboard']), [{ event: 'PreToolUse', entry: E1 }, { event: 'SessionStart', entry: E2 }]);
});

test('parseHookDefs: malformed features are rejected even when disabled', () => {
  assert.throws(() => parseHookDefs({ hooks: {}, features: [] }), /features/);
  assert.throws(() => parseHookDefs({ hooks: {}, features: { dashboard: {} } }), /features\.dashboard/);
  assert.throws(() => parseHookDefs({ hooks: {}, features: { dashboard: { hooks: { X: 5 } } } }), /features\.dashboard\.hooks\.X/);
});

test('turning a feature off removes exactly its owned entries on the next merge', () => {
  const json = { hooks: {}, features: { dashboard: { hooks: { SessionStart: [E2] } } } };
  const on = mergeHooks({ hooks: { SessionStart: [FOREIGN] } }, parseHookDefs(json, ['dashboard']), []);
  assert.deepEqual(on.settings.hooks.SessionStart, [FOREIGN, E2]);
  const off = mergeHooks(on.settings, parseHookDefs(json, []), on.owned);
  assert.deepEqual(off.settings, { hooks: { SessionStart: [FOREIGN] } });
  assert.deepEqual(off.owned, []);
});

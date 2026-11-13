import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/render.mjs';

const throwsMsg = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.message;
  }
  assert.fail('expected render to throw');
};

test('substitutes a plain variable', () => {
  assert.equal(render('branch {{baseBranch}}!', { baseBranch: 'dev' }), 'branch dev!');
});

test('substitutes dotted paths and tolerates inner spaces', () => {
  const ctx = { worktree: { pathPattern: '../{repo}-{unit}' } };
  assert.equal(render('{{ worktree.pathPattern }}', ctx), '../{repo}-{unit}');
});

test('does not escape output and leaves single braces and angle brackets alone', () => {
  assert.equal(render('<id> {x} & "q" {{v}}', { v: '<b>&' }), '<id> {x} & "q" <b>&');
});

test('numbers are rendered, other value types are an error', () => {
  assert.equal(render('{{n}}', { n: 3 }), '3');
  assert.match(throwsMsg(() => render('{{o}}', { o: { a: 1 } }, 't')), /template "t".*"o".*not a string/);
  assert.match(throwsMsg(() => render('{{b}}', { b: true }, 't')), /"b".*not a string/);
});

test('unknown variable names the template and the variable', () => {
  const msg = throwsMsg(() => render('a\n{{nope.deep}}', { nope: {} }, 'next-task'));
  assert.match(msg, /template "next-task"/);
  assert.match(msg, /unknown variable "nope\.deep"/);
  assert.match(msg, /line 2/);
});

test('inherited properties are not variables', () => {
  assert.match(throwsMsg(() => render('{{toString}}', {}, 't')), /unknown variable "toString"/);
  assert.match(throwsMsg(() => render('{{a.constructor}}', { a: {} }, 't')), /unknown variable/);
});

test('if renders its body only when truthy', () => {
  assert.equal(render('{{#if a}}yes{{/if}}', { a: true }), 'yes');
  assert.equal(render('{{#if a}}yes{{/if}}', { a: false }), '');
});

test('truthiness: present, non-empty string or array, true', () => {
  const t = (v) => render('{{#if v}}Y{{else}}N{{/if}}', { v });
  assert.equal(t('x'), 'Y');
  assert.equal(t(''), 'N');
  assert.equal(t(['a']), 'Y');
  assert.equal(t([]), 'N');
  assert.equal(t(true), 'Y');
  assert.equal(t(false), 'N');
  assert.equal(t(null), 'N');
  assert.equal(t({ path: 'x' }), 'Y');
});

test('if on an unknown key is an error', () => {
  assert.match(throwsMsg(() => render('{{#if ghost}}x{{/if}}', {}, 'tpl')), /template "tpl".*unknown variable "ghost"/);
});

test('else branch', () => {
  assert.equal(render('{{#if a}}A{{else}}B{{/if}}', { a: false }), 'B');
  assert.equal(render('{{#if a}}A{{else}}B{{/if}}', { a: true }), 'A');
});

test('nested conditionals', () => {
  const tpl = '{{#if a}}[{{#if b}}ab{{else}}a-{{/if}}]{{else}}{{#if b}}-b{{else}}--{{/if}}{{/if}}';
  assert.equal(render(tpl, { a: true, b: true }), '[ab]');
  assert.equal(render(tpl, { a: true, b: false }), '[a-]');
  assert.equal(render(tpl, { a: false, b: true }), '-b');
  assert.equal(render(tpl, { a: false, b: false }), '--');
});

test('variables inside a taken branch are resolved against the context', () => {
  assert.equal(render('{{#if codeMap}}see {{codeMap.path}}{{/if}}', { codeMap: { path: 'docs/MAP.md' } }), 'see docs/MAP.md');
});

test('block tags alone on a line leave no blank line behind', () => {
  const tpl = 'one\n{{#if a}}\ntwo\n{{else}}\nalt\n{{/if}}\nthree\n';
  assert.equal(render(tpl, { a: true }), 'one\ntwo\nthree\n');
  assert.equal(render(tpl, { a: false }), 'one\nalt\nthree\n');
});

test('indented block tags on their own line are standalone too', () => {
  assert.equal(render('- x\n  {{#if a}}\n  - y\n  {{/if}}\n- z\n', { a: true }), '- x\n  - y\n- z\n');
  assert.equal(render('- x\n  {{#if a}}\n  - y\n  {{/if}}\n- z\n', { a: false }), '- x\n- z\n');
});

test('inline block tags keep the surrounding text', () => {
  assert.equal(render('a{{#if x}}, b{{/if}}.', { x: false }), 'a.');
  assert.equal(render('a{{#if x}}, b{{/if}}.', { x: true }), 'a, b.');
});

test('a multi-line variable alone on an indented line keeps its indentation', () => {
  assert.equal(render('  {{list}}\nend', { list: '- a\n- b' }), '  - a\n  - b\nend');
});

test('unclosed block is an error naming the template', () => {
  assert.match(throwsMsg(() => render('{{#if a}}x', { a: true }, 'tpl')), /template "tpl".*unclosed.*#if a/);
});

test('stray end, else outside if and duplicate else are errors', () => {
  assert.match(throwsMsg(() => render('x{{/if}}', {}, 'tpl')), /template "tpl".*\{\{\/if\}\}.*without/);
  assert.match(throwsMsg(() => render('{{else}}', {}, 'tpl')), /\{\{else\}\}.*outside/);
  assert.match(throwsMsg(() => render('{{#if a}}{{else}}{{else}}{{/if}}', { a: 1 }, 'tpl')), /more than one \{\{else\}\}/);
});

test('unbalanced nesting is an error even when the branch is not taken', () => {
  assert.match(throwsMsg(() => render('{{#if a}}{{#if b}}x{{/if}}', { a: false, b: false }, 'tpl')), /unclosed/);
});

test('malformed tags and stray braces are errors', () => {
  assert.match(throwsMsg(() => render('{{}}', {}, 'tpl')), /empty tag/);
  assert.match(throwsMsg(() => render('{{#each x}}', { x: [] }, 'tpl')), /invalid tag/);
  assert.match(throwsMsg(() => render('{{a b}}', { a: 1 }, 'tpl')), /invalid tag/);
  assert.match(throwsMsg(() => render('oops {{ open', {}, 'tpl')), /stray/);
  assert.match(throwsMsg(() => render('oops }} close', {}, 'tpl')), /stray/);
});

test('output is deterministic and never contains undefined', () => {
  assert.equal(render('plain text, no tags\n', {}), 'plain text, no tags\n');
});

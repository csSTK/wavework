/**
 * Minimal template engine for the skill templates. No dependencies, no escaping (output is Markdown).
 *
 * Syntax:
 *   {{path.to.var}}                 value of a context variable (string or number)
 *   {{#if key}} ... {{/if}}         body when truthy: true, non-empty string, non-empty array, any object
 *   {{#if key}} ... {{else}} ... {{/if}}
 *
 * Rules:
 *   - Unknown variables (also in `#if`) are errors, so typos never render as empty text.
 *   - Blocks must balance, also in branches that are not taken.
 *   - A block tag alone on its line removes the whole line, so blocks leave no blank lines.
 *   - A variable alone on an indented line indents every line of a multi-line value the same way.
 *   - There is no escape for a literal `{{` or `}}`; a stray one is an error.
 */

const NAME = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const TAG = /\{\{([^{}]*)\}\}/g;

function fail(name, line, message) {
  return new Error(`template "${name}", line ${line}: ${message}`);
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Splits the template into text and tag tokens; block tags alone on a line swallow the whole line. */
function tokenize(text, name) {
  const tokens = [];
  let pos = 0;
  const pushText = (end) => {
    const chunk = text.slice(pos, end);
    if (/\{\{|\}\}/.test(chunk)) {
      const at = pos + chunk.search(/\{\{|\}\}/);
      throw fail(name, lineOf(text, at), `stray "${text.slice(at, at + 2)}" (no escape exists for literal braces)`);
    }
    if (chunk) tokens.push({ type: 'text', value: chunk });
  };
  for (const match of text.matchAll(TAG)) {
    const inner = match[1].trim();
    const line = lineOf(text, match.index);
    let start = match.index;
    let end = match.index + match[0].length;
    let token;
    if (inner === '') throw fail(name, line, 'empty tag');
    if (inner.startsWith('#if ')) {
      const key = inner.slice(4).trim();
      if (!NAME.test(key)) throw fail(name, line, `invalid tag "{{${inner}}}"`);
      token = { type: 'if', key, line };
    } else if (inner === 'else' || inner === '/if') {
      token = { type: inner, line };
    } else if (NAME.test(inner)) {
      token = { type: 'var', key: inner, line };
    } else {
      throw fail(name, line, `invalid tag "{{${inner}}}"`);
    }
    if (token.type !== 'var') {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const nl = text.indexOf('\n', end);
      const lineEnd = nl === -1 ? text.length : nl;
      if (/^[ \t]*$/.test(text.slice(lineStart, start)) && /^[ \t]*$/.test(text.slice(end, lineEnd))) {
        start = lineStart;
        end = nl === -1 ? text.length : nl + 1;
      }
    }
    pushText(start);
    tokens.push(token);
    pos = end;
  }
  pushText(text.length);
  return tokens;
}

/** Builds a tree of { type: 'text' | 'var' | 'if', ... } and checks that blocks balance. */
function parse(tokens, name) {
  const root = { children: [] };
  const stack = [{ node: root, list: root.children }];
  for (const token of tokens) {
    const top = stack[stack.length - 1];
    if (token.type === 'text' || token.type === 'var') {
      top.list.push(token);
    } else if (token.type === 'if') {
      const node = { type: 'if', key: token.key, line: token.line, then: [], otherwise: null };
      top.list.push(node);
      stack.push({ node, list: node.then });
    } else if (token.type === 'else') {
      if (stack.length === 1) throw fail(name, token.line, '{{else}} outside of an {{#if}} block');
      if (top.node.otherwise !== null) throw fail(name, token.line, 'more than one {{else}} in one {{#if}} block');
      top.node.otherwise = [];
      top.list = top.node.otherwise;
    } else {
      if (stack.length === 1) throw fail(name, token.line, '{{/if}} without a matching {{#if}}');
      stack.pop();
    }
  }
  if (stack.length > 1) {
    const open = stack[stack.length - 1].node;
    throw fail(name, open.line, `unclosed block {{#if ${open.key}}}`);
  }
  return root.children;
}

function lookup(context, key, name, line) {
  let value = context;
  for (const part of key.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) {
      throw fail(name, line, `unknown variable "${key}"`);
    }
    value = value[part];
  }
  return value;
}

function truthy(value) {
  if (Array.isArray(value) || typeof value === 'string') return value.length > 0;
  return Boolean(value);
}

/**
 * @param {string} template
 * @param {object} context variables; see src/context.mjs
 * @param {string} [name] template name for error messages
 * @returns {string}
 */
export function render(template, context, name = '<template>') {
  const tree = parse(tokenize(template, name), name);
  let out = '';
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        out += node.value;
      } else if (node.type === 'var') {
        const value = lookup(context, node.key, name, node.line);
        if (typeof value !== 'string' && typeof value !== 'number') {
          throw fail(name, node.line, `variable "${node.key}" is not a string or number`);
        }
        const tail = out.slice(out.lastIndexOf('\n') + 1);
        const indent = /^[ \t]+$/.test(tail) ? tail : '';
        out += String(value).split('\n').join(`\n${indent}`);
      } else if (truthy(lookup(context, node.key, name, node.line))) {
        walk(node.then);
      } else if (node.otherwise !== null) {
        walk(node.otherwise);
      }
    }
  };
  walk(tree);
  return out;
}

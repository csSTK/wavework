// Pipeline dashboard UI. Plain ES modules, no build. All data is rendered with textContent (never innerHTML).
import {
  ciBadge, findingsOf, formatCost, formatDuration, formatTokens, parseRoute, relativeTime,
  resultBadge, reviewRows, reviewsByBead, safeHref, sortRuns, statusBadge, stepLabel, tokensOf, formatStarted,
} from './format.mjs';

const app = document.getElementById('app');

/** Replaces the page content and puts keyboard focus back on the same run link (by data-run) if it had it. */
function show(...nodes) {
  const run = document.activeElement?.closest?.('[data-run]')?.dataset.run;
  const onBack = document.activeElement?.classList?.contains('back');
  app.replaceChildren(...nodes);
  if (run) app.querySelector(`[data-run="${CSS.escape(run)}"] a.link`)?.focus({ preventScroll: true });
  else if (onBack) app.querySelector('.back')?.focus({ preventScroll: true });
}
const liveEl = document.getElementById('live');
let project = '';
const appTitle = () => (project ? `Pipeline dashboard · ${project}` : 'Pipeline dashboard');
// The project name (repo directory) comes from the server; the page works without it.
fetch('/api/info').then((r) => r.json()).then((info) => {
  if (typeof info?.project !== 'string') return;
  project = info.project;
  const brand = document.querySelector('.brand');
  if (brand) brand.textContent = `Pipeline · ${project}`;
  document.title = appTitle();
}).catch(() => {});

/** Tiny element builder: h('td', {class: 'num'}, 'text', childNode). Strings become text nodes. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
/** Copies each header text onto its cells (data-label) so CSS can stack rows on narrow cards. */
function labelCells(tbl) {
  const heads = [...tbl.querySelectorAll('thead th')].map((th) => th.textContent);
  for (const tr of tbl.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => td.setAttribute('data-label', heads[i] ?? ''));
  return tbl;
}
const badge = (b, pulse) => h('span', { class: 'badge', 'data-tone': b.tone, 'data-pulse': pulse }, b.label);
const dash = '—';
const runTitle = (r) => r.branch ?? (r.units?.length ? r.units.join(', ') : r.id);

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(res.status === 404 ? 'This run does not exist (any more).' : `Server answered ${res.status}.`);
  return res.json();
}

const state = { runs: null, listError: null, details: new Map(), ci: new Map(), route: parseRoute(location.hash) };

/* ---------- Run list ---------- */
function liveDuration(run) {
  if (run.status === 'running' && run.started) return Date.now() - Date.parse(run.started);
  return run.totals?.durationMs ?? null;
}

function runRow(r, nested) {
  const href = `#/runs/${encodeURIComponent(r.id)}`;
  const link = (kids) => h('a', { class: 'link', href }, kids);
  const ci = ciBadge(state.ci.get(r.id) ?? null);
  const tr = h('tr', { 'data-testid': 'run-row', 'data-run': r.id, class: nested ? 'nested' : null, 'data-clickable': true },
    h('td', null, badge(statusBadge(r.status), r.status === 'running')),
    h('td', null, link([h('strong', null, runTitle(r)), h('div', { class: 'small muted' }, `${r.kind ?? dash} · ${(r.units ?? []).join(', ') || dash}`)])),
    h('td', { class: 'small muted', title: r.started ? relativeTime(r.started) : null }, formatStarted(r.started)),
    h('td', { class: 'num' }, formatDuration(liveDuration(r))),
    h('td', { class: 'num', title: 'Estimated cost' }, formatCost(r.totals?.cost ?? null)),
    h('td', null, ci ? badge(ci) : h('span', { class: 'subtle' }, dash)));
  tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = href; });
  return tr;
}

function renderList() {
  if (state.listError) return errorState(state.listError, loadList);
  if (!state.runs) return show(h('h1', null, 'Pipeline runs'), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
  const runs = sortRuns(state.runs);
  const body = h('tbody');
  for (const r of runs) {
    body.append(runRow(r, false));
    for (const c of sortRuns(r.children ?? [])) body.append(runRow(c, true));
  }
  const content = runs.length === 0
    ? h('div', { class: 'state' }, h('h2', null, 'No runs yet'), h('p', { class: 'muted' }, 'Runs appear here as soon as a /next-task pipeline records its first event.'))
    : h('div', { class: 'card' }, labelCells(h('table', { class: 'rows' },
      h('thead', null, h('tr', null, ['Status', 'Run', 'Started'].map((t) => h('th', null, t)),
        h('th', { class: 'num' }, 'Duration'), h('th', { class: 'num' }, 'Est. cost'), h('th', null, 'CI'))),
      body)));
  show(
    h('div', { class: 'head' }, h('h1', null, 'Pipeline runs'), h('p', { class: 'muted small' }, 'Costs are estimates from token usage.')),
    content);
  document.title = appTitle();
}

async function loadList() {
  try {
    state.runs = await getJson('/api/runs');
    state.listError = null;
  } catch (e) { state.listError = e.message; }
  if (state.route.view === 'list') renderList();
  loadCi();
}

/** The list endpoint has no CI info; fetch details of runs with a pushed SHA once, then rely on the server cache. */
async function loadCi() {
  const flat = (state.runs ?? []).flatMap((r) => [r, ...(r.children ?? [])]);
  await Promise.all(flat.map(async (r) => {
    if (state.ci.has(r.id) && state.ci.get(r.id)?.state === 'success') return;
    try {
      const d = await getJson(`/api/runs/${encodeURIComponent(r.id)}`);
      state.ci.set(r.id, d.ci ?? null);
    } catch { /* leave the badge out */ }
  }));
  if (state.route.view === 'list') renderList();
}

/* ---------- Run detail ---------- */
function stat(label, value, title, live) {
  return h('div', { class: 'stat' }, h('span', { class: 'label' }, label), h('span', { class: 'value', title, 'data-live': live }, value));
}

function section(title, ...kids) { return h('section', { class: 'card' }, h('h2', null, title), ...kids); }
const empty = (t) => h('p', { class: 'muted' }, t);

function table(heads, rows, testid) {
  return labelCells(h('table', { class: 'rows', 'data-testid': testid },
    h('thead', null, h('tr', null, heads.map(([t, num]) => h('th', { class: num ? 'num' : null }, t)))), h('tbody', null, rows)));
}

function renderDetail(id) {
  const d = state.details.get(id);
  if (d?.error) return errorState(d.error, () => loadDetail(id));
  if (!d) return show(backLink(), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
  const { run, events, timeline: t, ci } = d;
  const members = (state.runs ?? []).find((r) => r.id === run.id)?.children ?? [];
  const reviews = reviewsByBead(events);
  const findings = findingsOf(events);
  const ciB = ciBadge(ci);
  const ciRuns = (ci?.runs ?? []);

  const children = t.children.map((c) => {
    const rv = reviews.get(c.bead);
    return h('tr', { 'data-testid': 'child-row' },
      h('td', { class: 'mono' }, c.bead), h('td', null, c.model ?? dash), h('td', { class: 'num' }, c.wave ?? dash),
      h('td', { class: 'num' }, formatDuration(c.durationMs)),
      h('td', { class: 'num', 'data-col': 'tokens' }, formatTokens(tokensOf({ ...c.agents, agents: c.agents?.count }))),
      h('td', { class: 'num', 'data-col': 'cost' }, formatCost(c.agents?.cost ?? null)),
      h('td', null, c.result ? badge(resultBadge(c.result)) : (run.status === 'running' ? badge({ label: 'Working', tone: 'info' }, true) : dash)),
      h('td', null, rv ? `${rv.verdict ?? dash}${rv.round ? ` · round ${rv.round}` : ''}` : dash),
      h('td', { class: 'small' }, c.redBeforeGreen ?? dash));
  });

  const steps = t.steps.map((s) => h('li', { 'data-open': s.end ? null : true },
    h('span', { class: 'dot' }),
    h('span', null, stepLabel(s), s.sha ? h('span', { class: 'mono muted' }, ` ${s.sha.slice(0, 7)}`) : null),
    h('span', { class: 'num muted' }, s.end ? formatDuration(s.durationMs) : 'running')));

  const reviewTr = reviewRows(events).map((r) => h('tr', null, h('td', { class: 'mono' }, r.bead ?? dash), h('td', { class: 'num' }, r.round ?? dash), h('td', null, r.verdict ?? dash), h('td', { class: 'num' }, r.mustFix)));
  const testRows = t.tests.map((x) => h('tr', null,
    h('td', null, x.scope ?? dash), h('td', { class: 'num' }, x.passed),
    h('td', { class: 'num' }, x.failed > 0 ? badge({ label: String(x.failed), tone: 'bad' }) : x.failed), h('td', { class: 'num' }, x.duration != null ? `${x.duration}s` : dash)));

  const ciLinks = ciRuns.map((r) => {
    const href = safeHref(r.url);
    return h('li', null, href ? h('a', { class: 'link-btn', href, target: '_blank', rel: 'noopener noreferrer' }, r.name || 'Workflow run') : h('span', null, r.name || 'Workflow run'),
      h('span', { class: 'small muted' }, r.conclusion ?? r.status));
  });

  document.title = `${runTitle(run)} · ${appTitle()}`;
  show(
    backLink(),
    h('div', { 'data-testid': 'run-detail', class: 'stack' },
      h('div', { class: 'head' }, h('h1', null, runTitle(run)), badge(statusBadge(run.status), run.status === 'running')),
      h('section', { class: 'card' },
        h('div', { class: 'stats' },
          stat('Kind', run.kind ?? dash), stat('Units', (run.units ?? []).join(', ') || dash),
          stat('Started', formatStarted(run.started), run.started ? relativeTime(run.started) : null),
          stat('Duration', formatDuration(run.status === 'running' && run.started ? Date.now() - Date.parse(run.started) : t.totals.durationMs), null, run.status === 'running' ? run.started : null),
          stat('Tokens', formatTokens(tokensOf(t.totals))), stat('Est. cost (estimate)', formatCost(t.totals.cost)),
          stat('Agents', String(t.totals.agents))),
        t.totals.cost === null && t.totals.agents > 0 ? h('p', { class: 'small muted' }, 'Cost is unknown because at least one agent used a model without a price.') : null),
      members.length ? section('Runs in this batch', table([['Status'], ['Run'], ['Started'], ['Duration', true], ['Est. cost', true], ['CI']], members.map((m) => runRow(m, false)))) : null,
      section('Steps', t.steps.length ? h('ol', { class: 'steps' }, steps) : empty('No steps recorded yet.')),
      section('Children', t.children.length
        ? table([['Bead'], ['Model'], ['Wave', true], ['Duration', true], ['Tokens', true], ['Est. cost', true], ['Result'], ['Review'], ['Red before green']], children)
        : empty('No child tasks recorded yet.')),
      h('div', { class: 'grid-2' },
        section('Reviews', reviewTr.length ? table([['Bead'], ['Round', true], ['Verdict'], ['Must fix', true]], reviewTr) : empty('No reviews yet.')),
        section('Tests', t.tests.length ? table([['Scope'], ['Passed', true], ['Failed', true], ['Time', true]], testRows) : empty('No test results yet.'))),
      h('div', { class: 'grid-2' },
        section('Findings filed', findings.length ? h('ul', { class: 'list' }, findings.map((f) => h('li', { class: 'mono' }, f))) : empty('No findings.')),
        section('CI', ci ? [ciB ? badge(ciB) : null, h('p', { class: 'small muted mono' }, ci.sha.slice(0, 7)), ciRuns.length ? h('ul', { class: 'list' }, ciLinks) : empty('No workflow runs found for this commit.')] : empty('Nothing pushed yet.')))));
}

const backLink = () => h('a', { class: 'back', href: '#/' }, '← All runs');

async function loadDetail(id) {
  try {
    const d = await getJson(`/api/runs/${encodeURIComponent(id)}`);
    state.details.set(id, d);
    state.ci.set(id, d.ci ?? null);
  } catch (e) { state.details.set(id, { error: e.message }); }
  if (state.route.view === 'run' && state.route.id === id) renderDetail(id);
}

function errorState(message, retry) {
  show(backLink(), h('div', { class: 'state', 'data-tone': 'bad', 'data-testid': 'error-state', role: 'alert' },
    h('h2', null, 'Could not load'), h('p', null, message), h('button', { class: 'btn', type: 'button', onclick: null }, 'Retry')));
  app.querySelector('button').addEventListener('click', retry);
}

/* ---------- Routing and live updates ---------- */
function route() {
  state.route = parseRoute(location.hash);
  if (state.route.view === 'run') {
    state.details.delete(state.route.id);
    renderDetail(state.route.id);
    loadDetail(state.route.id);
    if (!state.runs) loadList();
  } else {
    renderList();
    loadList();
  }
  window.scrollTo(0, 0);
}

let refreshTimer = null;
function onRunChanged(id) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    state.ci.delete(id);
    loadList();
    if (state.route.view === 'run') loadDetail(state.route.id);
  }, 150);
}

function connect() {
  const es = new EventSource('/api/events');
  let dropped = false;
  es.addEventListener('open', () => {
    liveEl.dataset.state = 'live'; liveEl.textContent = 'Live';
    if (dropped) { dropped = false; onRunChanged(null); } // events missed while disconnected
  });
  es.addEventListener('error', () => { dropped = true; liveEl.dataset.state = 'offline'; liveEl.textContent = 'Reconnecting'; });
  es.addEventListener('run-changed', (e) => {
    try { onRunChanged(JSON.parse(e.data).id); } catch { onRunChanged(null); }
  });
}

window.addEventListener('hashchange', route);
// Keep relative times and running durations fresh.
const refreshMs = Number(new URLSearchParams(location.search).get('refresh')) || 10_000;
setInterval(() => {
  if (state.route.view === 'list' && state.runs) renderList();
  // Running detail: only the duration text ticks, the rest of the page (and focus) stays untouched.
  for (const el of app.querySelectorAll('[data-live]')) el.textContent = formatDuration(Date.now() - Date.parse(el.dataset.live));
}, refreshMs);
route();
connect();

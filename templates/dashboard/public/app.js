// Pipeline dashboard UI. Plain ES modules, no build. All data is rendered with textContent (never innerHTML).
// Layout after GitHub Actions: every run shows its stages (plan, waves, finish, CI) with a status icon each, what
// the agents are doing right now, and where problems happened.
import {
  ciBadge, findingsOf, formatCost, formatDuration, formatTokens, parseRoute, pipelineView, relativeTime,
  resultBadge, reviewRows, reviewsByBead, safeHref, sortRuns, stageStatusLabel, statusBadge, tokensOf, formatStarted,
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

/* ---------- Status icons (inline SVG, drawn with currentColor; the colour comes from data-status in CSS) ---------- */
const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
}
const ICON_PARTS = {
  success: () => [svg('circle', { cx: 8, cy: 8, r: 8, fill: 'currentColor' }), svg('path', { d: 'M4.5 8.2l2.3 2.3 4.7-4.9', fill: 'none', stroke: 'var(--color-on-status)', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })],
  failure: () => [svg('circle', { cx: 8, cy: 8, r: 8, fill: 'currentColor' }), svg('path', { d: 'M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4', stroke: 'var(--color-on-status)', 'stroke-width': 1.8, 'stroke-linecap': 'round' })],
  in_progress: () => [svg('circle', { cx: 8, cy: 8, r: 6.5, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.3, 'stroke-width': 2 }), svg('path', { class: 'spin', d: 'M8 1.5a6.5 6.5 0 0 1 6.5 6.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' })],
  queued: () => [svg('circle', { cx: 8, cy: 8, r: 6.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-dasharray': '2.5 2' })],
  skipped: () => [svg('circle', { cx: 8, cy: 8, r: 6.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }), svg('path', { d: 'M3.6 12.4l8.8-8.8', stroke: 'currentColor', 'stroke-width': 1.5 })],
  cancelled: () => [svg('circle', { cx: 8, cy: 8, r: 6.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }), svg('rect', { x: 5.5, y: 5.5, width: 5, height: 5, rx: 1, fill: 'currentColor' })],
  unknown: () => [svg('circle', { cx: 8, cy: 8, r: 6.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 })],
  warning: () => [svg('path', { d: 'M8 1.2l7 12.8H1z', fill: 'currentColor', 'stroke-linejoin': 'round' }), svg('path', { d: 'M8 6v3.6M8 11.8v.1', stroke: 'var(--color-on-status)', 'stroke-width': 1.6, 'stroke-linecap': 'round' })],
};
/** A 16px status icon with an accessible label. */
function icon(status, label = stageStatusLabel(status)) {
  const parts = (ICON_PARTS[status] ?? ICON_PARTS.unknown)();
  const el = svg('svg', { class: 'icon', viewBox: '0 0 16 16', width: 16, height: 16, 'data-status': status, role: 'img', 'aria-label': label }, svg('title', {}, label), ...parts);
  return el;
}
const RUN_STATUS = { running: 'in_progress', done: 'success', blocked: 'failure', failed: 'failure' };

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(res.status === 404 ? 'This run does not exist (any more).' : `Server answered ${res.status}.`);
  return res.json();
}

// details: run id -> /api/runs/:id answer (or {error}); every run's detail is loaded, the list shows its stages too.
const state = { runs: null, listError: null, details: new Map(), route: parseRoute(location.hash) };
const flatRuns = () => (state.runs ?? []).flatMap((r) => [r, ...(r.children ?? [])]);
const membersOf = (id) => (state.runs ?? []).find((r) => r.id === id)?.children ?? [];
const viewOf = (id) => {
  const d = state.details.get(id);
  return d && !d.error ? pipelineView(d, membersOf(id)) : null;
};

/* ---------- Shared pieces ---------- */
function liveDuration(run) {
  if (run.status === 'running' && run.started) return Date.now() - Date.parse(run.started);
  return run.totals?.durationMs ?? null;
}

/** The stage strip: one chip per stage with its icon, like the job graph of a workflow run, in one line. */
function stageStrip(view) {
  return h('ol', { class: 'strip', 'aria-label': 'Stages' }, view.stages.map((s) => h('li', { 'data-status': s.status, title: `${s.label}: ${stageStatusLabel(s.status)}` },
    icon(s.status), h('span', null, s.label),
    s.problems.failure ? h('span', { class: 'count', 'data-level': 'failure' }, String(s.problems.failure)) : null)));
}

/** "2 failures · 3 warnings" chips, or nothing. */
function problemChips(view) {
  const failures = view.problems.filter((p) => p.level === 'failure').length;
  const warnings = view.problems.length - failures;
  return [
    failures ? h('span', { class: 'chip', 'data-level': 'failure' }, icon('failure', 'Failures'), `${failures} failure${failures === 1 ? '' : 's'}`) : null,
    warnings ? h('span', { class: 'chip', 'data-level': 'warning' }, icon('warning', 'Warnings'), `${warnings} warning${warnings === 1 ? '' : 's'}`) : null,
  ];
}

/** Last activity of a running run; a quiet run gets flagged so a stuck agent is easy to spot. */
function lastActivity(view, run) {
  if (run.status !== 'running' || !view?.lastEventTs) return null;
  const quietMs = Date.now() - Date.parse(view.lastEventTs);
  return h('span', { class: 'small', 'data-quiet': quietMs > 20 * 60_000 ? true : null, title: view.lastEventTs }, `last event ${relativeTime(view.lastEventTs)}`);
}

/* ---------- Run list ---------- */
function runRow(r, nested) {
  const href = `#/runs/${encodeURIComponent(r.id)}`;
  const view = viewOf(r.id);
  const ci = ciBadge(state.details.get(r.id)?.ci ?? null);
  const status = statusBadge(r.status);
  const li = h('li', { class: 'run', 'data-testid': 'run-row', 'data-run': r.id, 'data-nested': nested ? true : null, 'data-clickable': true },
    h('div', { class: 'run-icon' }, icon(RUN_STATUS[r.status] ?? 'unknown', status.label)),
    h('div', { class: 'run-main' },
      h('a', { class: 'link', href }, h('strong', null, runTitle(r))),
      h('div', { class: 'small muted meta' },
        h('span', { class: 'status-text', 'data-tone': status.tone }, status.label),
        h('span', null, r.kind ?? dash), h('span', null, (r.units ?? []).join(', ') || dash),
        h('span', { title: r.started ?? null }, r.started ? relativeTime(r.started) : dash)),
      view?.activity ? h('div', { class: 'activity' }, h('span', { class: 'activity-text' }, view.activity), lastActivity(view, r)) : null,
      view ? stageStrip(view) : h('div', { class: 'strip-skeleton' })),
    h('div', { class: 'run-side' },
      view ? h('div', { class: 'chips' }, problemChips(view)) : null,
      h('div', { class: 'small muted nums' },
        h('span', { title: 'Duration' }, formatDuration(liveDuration(r))),
        h('span', { title: 'Estimated cost' }, formatCost(r.totals?.cost ?? null))),
      ci ? badge(ci) : null));
  li.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = href; });
  return li;
}

function renderList() {
  if (state.listError) return errorState(state.listError, loadList);
  if (!state.runs) return show(h('h1', null, 'Pipeline runs'), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
  const runs = sortRuns(state.runs);
  const items = [];
  for (const r of runs) {
    items.push(runRow(r, false));
    for (const c of sortRuns(r.children ?? [])) items.push(runRow(c, true));
  }
  const content = runs.length === 0
    ? h('div', { class: 'state' }, h('h2', null, 'No runs yet'), h('p', { class: 'muted' }, 'Runs appear here as soon as a /next-task pipeline records its first event.'))
    : h('div', { class: 'card flush' }, h('ul', { class: 'runs' }, items));
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
  render();
}

/** Loads run details: `ids`, or every run whose detail is missing or can still change. */
async function loadDetails(ids) {
  const want = ids ?? flatRuns().filter((r) => {
    const d = state.details.get(r.id);
    return !d || d.error || r.status === 'running' || d.run?.status !== r.status || d.ci?.state === 'pending';
  }).map((r) => r.id);
  await Promise.all(want.map(async (id) => {
    try { state.details.set(id, await getJson(`/api/runs/${encodeURIComponent(id)}`)); } catch (e) { state.details.set(id, { error: e.message }); }
  }));
  render();
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

const stageDuration = (s) => (s.status === 'in_progress' && s.start
  ? h('span', { class: 'num muted small', 'data-live': s.start }, formatDuration(Date.now() - Date.parse(s.start)))
  : h('span', { class: 'num muted small' }, s.durationMs != null ? formatDuration(s.durationMs) : ''));

/** The job list on the left: one entry per stage, click scrolls to its card in the graph. */
function sidebar(view, run) {
  const go = (id) => () => document.getElementById(`stage-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  return h('nav', { class: 'sidebar card', 'aria-label': 'Stages' },
    h('div', { class: 'side-title' }, icon(RUN_STATUS[run.status] ?? 'unknown', statusBadge(run.status).label), h('strong', null, 'Summary')),
    h('div', { class: 'side-label small muted' }, 'Stages'),
    h('ul', { class: 'jobs' }, view.stages.map((s) => {
      const b = h('button', { type: 'button', class: 'job', 'data-status': s.status }, icon(s.status), h('span', { class: 'job-name' }, s.label),
        s.problems.failure + s.problems.warning ? h('span', { class: 'count', 'data-level': s.problems.failure ? 'failure' : 'warning' }, String(s.problems.failure + s.problems.warning)) : null,
        stageDuration(s));
      b.addEventListener('click', go(s.id));
      return h('li', null, b);
    })));
}

function beadLine(b) {
  const review = b.reviewRounds ? `review ${b.verdict ?? dash}${b.reviewRounds > 1 ? ` · ${b.reviewRounds} rounds` : ''}` : null;
  return h('li', { class: 'bead', 'data-status': b.status }, icon(b.status, `${b.bead}: ${b.result ?? stageStatusLabel(b.status)}`),
    h('span', { class: 'mono bead-id' }, b.bead),
    h('span', { class: 'small muted' }, [b.model, review].filter(Boolean).join(' · ')));
}

/** The pipeline graph: stage cards left to right (top to bottom on phones), with sub-steps and beads inside. */
function graph(view) {
  return h('ol', { class: 'graph', 'data-testid': 'pipeline-graph' }, view.stages.map((s) => h('li', { class: 'stage', id: `stage-${s.id}`, 'data-status': s.status },
    h('div', { class: 'stage-head' }, icon(s.status), h('strong', null, s.runId ? h('a', { href: `#/runs/${encodeURIComponent(s.runId)}` }, s.label) : s.label), stageDuration(s)),
    s.sub.length ? h('ul', { class: 'subs' }, s.sub.map((x) => h('li', { 'data-status': x.status }, icon(x.status), h('span', null, x.label), x.sha ? h('span', { class: 'mono muted' }, x.sha.slice(0, 7)) : null, h('span', { class: 'num muted small' }, x.durationMs != null ? formatDuration(x.durationMs) : '')))) : null,
    s.beads.length ? h('ul', { class: 'beads' }, s.beads.map(beadLine)) : null,
    s.runs?.length ? h('ul', { class: 'subs' }, s.runs.map((r) => h('li', { 'data-status': r.conclusion === 'success' ? 'success' : r.conclusion ? 'failure' : 'in_progress' }, icon(r.conclusion === 'success' ? 'success' : r.conclusion ? 'failure' : 'in_progress'), h('span', null, r.name || 'Workflow run')))) : null,
    s.problems.failure + s.problems.warning ? h('div', { class: 'chips' }, problemChips({ problems: view.problems.filter((p) => p.stage === s.id) })) : null,
    s.status === 'queued' && !s.sub.length && !s.beads.length ? h('p', { class: 'small subtle' }, 'Waiting') : null)));
}

/** Annotations: every failure and warning with the stage it happened in. */
function annotations(view) {
  const label = (id) => view.stages.find((s) => s.id === id)?.label ?? null;
  const items = view.problems.map((p) => h('li', { 'data-level': p.level },
    icon(p.level, p.level === 'failure' ? 'Failure' : 'Warning'),
    h('div', { class: 'ann-main' },
      h('strong', null, p.title),
      h('div', { class: 'small muted' }, [label(p.stage), p.detail, p.ts ? relativeTime(p.ts) : null].filter(Boolean).join(' · ')))));
  return h('section', { class: 'card', 'data-testid': 'annotations' }, h('h2', null, 'Annotations'),
    items.length ? h('ul', { class: 'annotations' }, items) : empty('No problems recorded.'));
}

function renderDetail(id) {
  const d = state.details.get(id);
  if (d?.error) return errorState(d.error, () => loadDetails([id]));
  if (!d) return show(backLink(), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
  const { run, events, timeline: t, ci } = d;
  const view = pipelineView(d, membersOf(run.id));
  const members = membersOf(run.id);
  const reviews = reviewsByBead(events);
  const findings = findingsOf(events);
  const ciB = ciBadge(ci);
  const ciRuns = (ci?.runs ?? []);

  const children = t.children.map((c) => {
    const rv = reviews.get(c.bead);
    return h('tr', { 'data-testid': 'child-row' },
      h('td', { class: 'mono' }, c.bead), h('td', { 'data-col': 'model' }, c.model ?? dash), h('td', { class: 'num' }, c.wave ?? dash),
      h('td', { class: 'num' }, formatDuration(c.durationMs)),
      h('td', { class: 'num', 'data-col': 'tokens' }, formatTokens(tokensOf({ ...c.agents, agents: c.agents?.count }))),
      h('td', { class: 'num', 'data-col': 'cost' }, formatCost(c.agents?.cost ?? null)),
      h('td', null, c.result ? badge(resultBadge(c.result)) : (run.status === 'running' ? badge({ label: 'Working', tone: 'info' }, true) : dash)),
      h('td', null, rv ? `${rv.verdict ?? dash}${rv.round ? ` · round ${rv.round}` : ''}` : dash),
      h('td', { class: 'small' }, c.redBeforeGreen ?? dash));
  });

  const reviewTr = reviewRows(events).map((r) => h('tr', null, h('td', { class: 'mono' }, r.bead ?? dash), h('td', { class: 'num' }, r.round ?? dash), h('td', null, r.verdict ?? dash), h('td', { class: 'num' }, r.mustFix)));
  const testRows = t.tests.map((x) => h('tr', null,
    h('td', null, x.scope ?? dash), h('td', { class: 'num' }, x.passed),
    h('td', { class: 'num' }, x.failed > 0 ? badge({ label: String(x.failed), tone: 'bad' }) : x.failed), h('td', { class: 'num' }, x.duration != null ? `${x.duration}s` : dash)));

  const ciLinks = ciRuns.map((r) => {
    const href = safeHref(r.url);
    return h('li', null, href ? h('a', { class: 'link-btn', href, target: '_blank', rel: 'noopener noreferrer' }, r.name || 'Workflow run') : h('span', null, r.name || 'Workflow run'),
      h('span', { class: 'small muted' }, r.conclusion ?? r.status));
  });

  const isBatch = run.kind === 'batch';
  document.title = `${runTitle(run)} · ${appTitle()}`;
  show(
    backLink(),
    h('div', { 'data-testid': 'run-detail', class: 'detail' },
      sidebar(view, run),
      h('div', { class: 'stack' },
        h('div', { class: 'head' },
          h('div', { class: 'title' }, icon(RUN_STATUS[run.status] ?? 'unknown', statusBadge(run.status).label), h('h1', null, runTitle(run))),
          badge(statusBadge(run.status), run.status === 'running')),
        view.activity ? h('div', { class: 'now', 'data-testid': 'activity' }, h('span', { class: 'now-label' }, 'Now'), h('span', null, view.activity), lastActivity(view, run)) : null,
        h('section', { class: 'card' },
          h('div', { class: 'stats' },
            stat('Kind', run.kind ?? dash), stat('Units', (run.units ?? []).join(', ') || dash),
            stat('Started', formatStarted(run.started), run.started ? relativeTime(run.started) : null),
            stat('Duration', formatDuration(run.status === 'running' && run.started ? Date.now() - Date.parse(run.started) : t.totals.durationMs), null, run.status === 'running' ? run.started : null),
            stat('Tokens', formatTokens(tokensOf(t.totals))), stat('Est. cost (estimate)', formatCost(t.totals.cost)),
            stat('Agents', String(t.totals.agents))),
          t.totals.cost === null && t.totals.agents > 0 ? h('p', { class: 'small muted' }, 'Cost is unknown because at least one agent used a model without a price.') : null),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, isBatch ? 'Epics' : 'Pipeline'), h('div', { class: 'chips' }, problemChips(view))), h('div', { class: 'graph-scroll' }, graph(view))),
        annotations(view),
        members.length ? section('Runs in this batch', h('ul', { class: 'runs' }, members.map((m) => runRow(m, false)))) : null,
        isBatch ? null : section('Beads', t.children.length
          ? table([['Bead'], ['Model'], ['Wave', true], ['Duration', true], ['Tokens', true], ['Est. cost', true], ['Result'], ['Review'], ['Red before green']], children)
          : empty('No beads started yet.')),
        isBatch ? null : h('div', { class: 'stack' },
          section('Reviews', reviewTr.length ? table([['Bead'], ['Round', true], ['Verdict'], ['Must fix', true]], reviewTr) : empty('No reviews yet.')),
          section('Tests', t.tests.length ? table([['Scope'], ['Passed', true], ['Failed', true], ['Time', true]], testRows) : empty('No test results yet.'))),
        isBatch ? null : h('div', { class: 'grid-2' },
          section('Findings filed', findings.length ? h('ul', { class: 'list' }, findings.map((f) => h('li', { class: 'mono' }, f))) : empty('No findings.')),
          section('CI', ci ? [ciB ? badge(ciB) : null, h('p', { class: 'small muted mono' }, ci.sha.slice(0, 7)), ciRuns.length ? h('ul', { class: 'list' }, ciLinks) : empty('No workflow runs found for this commit.')] : empty('Nothing pushed yet.'))))));
}

const backLink = () => h('a', { class: 'back', href: '#/' }, '← All runs');

function errorState(message, retry) {
  show(backLink(), h('div', { class: 'state', 'data-tone': 'bad', 'data-testid': 'error-state', role: 'alert' },
    h('h2', null, 'Could not load'), h('p', null, message), h('button', { class: 'btn', type: 'button', onclick: null }, 'Retry')));
  app.querySelector('button').addEventListener('click', retry);
}

/* ---------- Routing and live updates ---------- */
function render() {
  if (state.route.view === 'run') renderDetail(state.route.id);
  else renderList();
}

async function route() {
  state.route = parseRoute(location.hash);
  if (state.route.view === 'run') state.details.delete(state.route.id);
  render();
  window.scrollTo(0, 0);
  await loadList();
  await loadDetails(state.route.view === 'run' ? [state.route.id, ...membersOf(state.route.id).map((m) => m.id)] : undefined);
  if (state.route.view === 'run') loadDetails();
}

const changed = new Set();
let refreshTimer = null;
/** A store change: reload the list (new runs appear here) and the details of the changed runs, debounced. */
function onRunChanged(id) {
  changed.add(id);
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    const ids = changed.has(null) ? flatRuns().map((r) => r.id) : [...changed];
    changed.clear();
    await loadList();
    // Runs that are new to the list have no detail yet; loadDetails() without ids picks them up.
    await loadDetails([...new Set([...ids.filter((x) => flatRuns().some((r) => r.id === x)), ...flatRuns().filter((r) => !state.details.has(r.id)).map((r) => r.id)])]);
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
// Keep relative times and running durations fresh; pending CI has no store event, so poll it here.
const refreshMs = Number(new URLSearchParams(location.search).get('refresh')) || 10_000;
setInterval(() => {
  if (state.route.view === 'list' && state.runs) renderList();
  // Running detail: only the duration texts tick, the rest of the page (and focus) stays untouched.
  for (const el of app.querySelectorAll('[data-live]')) el.textContent = formatDuration(Date.now() - Date.parse(el.dataset.live));
  const pending = flatRuns().filter((r) => state.details.get(r.id)?.ci?.state === 'pending').map((r) => r.id);
  if (pending.length) loadDetails(pending);
}, refreshMs);
route();
connect();

// Pure helpers for the dashboard UI (no DOM), unit-tested in test/ui.test.mjs.
const DASH = '—';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function formatDuration(ms) {
  if (!isNum(ms) || ms < 0) return DASH;
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Cost is an estimate (prefix "~"). Unknown (null) is a dash, never $0.00. */
export function formatCost(cost) {
  if (!isNum(cost)) return DASH;
  if (cost > 0 && cost < 0.005) return '<$0.01';
  return `~$${cost.toFixed(2)}`;
}

export function formatTokens(n) {
  if (!isNum(n)) return DASH;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** Sum of all token kinds of an agents/totals object. */
export function totalTokens(t) {
  if (!t) return null;
  return ['tokensIn', 'tokensOut', 'tokensCacheRead', 'tokensCacheWrite'].reduce((s, k) => s + (isNum(t[k]) ? t[k] : 0), 0);
}

const STATUS = {
  running: { label: 'Running', tone: 'info' },
  done: { label: 'Done', tone: 'ok' },
  blocked: { label: 'Blocked', tone: 'warn' },
  failed: { label: 'Failed', tone: 'bad' },
};
export function statusBadge(status) {
  return STATUS[status] ?? { label: String(status ?? DASH), tone: 'neutral' };
}

const CI = {
  success: { label: 'CI passed', tone: 'ok' },
  failure: { label: 'CI failed', tone: 'bad' },
  pending: { label: 'CI running', tone: 'info' },
  none: { label: 'No CI', tone: 'neutral' },
  unknown: { label: 'CI unknown', tone: 'neutral' },
};
export function ciBadge(ci) {
  if (!ci) return null;
  return CI[ci.state] ?? CI.unknown;
}

/** Returns the url only when it is http(s); anything else (javascript:, data:, relative) is null. */
export function safeHref(url) {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : null;
  } catch { return null; }
}

/** Running runs first, then newest started first. Returns a new array. */
export function sortRuns(runs) {
  const rank = (r) => (r.status === 'running' ? 0 : 1);
  return [...runs].sort((a, b) => rank(a) - rank(b) || (b.started ?? '').localeCompare(a.started ?? ''));
}

export function parseRoute(hash) {
  const m = /^#\/runs\/(.+)$/.exec(hash ?? '');
  if (!m) return { view: 'list' };
  try { return { view: 'run', id: decodeURIComponent(m[1]) }; } catch { return { view: 'list' }; }
}

export function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return DASH;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 30) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Latest verdict and highest round per bead, from raw review events that carry a bead (the skill may record only the final round). */
export function reviewsByBead(events) {
  const map = new Map();
  for (const e of events ?? []) {
    if (e.type !== 'review' || !e.bead) continue;
    const prev = map.get(e.bead);
    const round = isNum(e.round) ? e.round : 0;
    if (!prev || round >= prev.round) map.set(e.bead, { verdict: e.verdict ?? null, round });
  }
  return map;
}

/** Review events (newest first) with their bead, for the reviews table. */
export function reviewRows(events) {
  return (events ?? []).filter((e) => e.type === 'review')
    .map((e) => ({ ts: e.ts, bead: e.bead ?? null, round: e.round ?? null, verdict: e.verdict ?? null, mustFix: e.mustFix ?? 0 }))
    .reverse();
}

const RESULT = { committed: 'ok', ok: 'ok', done: 'ok', blocked: 'warn', failed: 'bad', running: 'info' };
export function resultBadge(result) {
  if (!result) return null;
  return { label: String(result), tone: RESULT[result] ?? 'neutral' };
}

/** Total tokens, or null when no agent was recorded (unknown, not 0). */
export function tokensOf(totals) {
  if (!totals || !totals.agents) return null;
  return totalTokens(totals);
}

/** Compact start time like "13 Nov, 10:44". */
export function formatStarted(iso, locale = undefined, timeZone = undefined) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return DASH;
  const d = new Date(t);
  const opts = { timeZone };
  const day = new Intl.DateTimeFormat(locale, { ...opts, day: 'numeric', month: 'short' }).format(d);
  const time = new Intl.DateTimeFormat(locale, { ...opts, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${day}, ${time}`;
}

export function stepLabel({ step, wave }) {
  const name = String(step ?? DASH).replace(/^./, (c) => c.toUpperCase());
  if (step === 'wave') return wave != null ? `${name} ${wave}` : name;
  return wave != null ? `${name} · wave ${wave}` : name;
}

export function findingsOf(events) {
  return (events ?? []).filter((e) => e.type === 'finding' && e.bead).map((e) => e.bead);
}

/* ---------- Pipeline view: stages, problems and current activity of one run ---------- */

// Steps recorded inside another step (deps runs during plan; review and push during finish) are sub-steps of it.
const PARENT_STEP = { deps: 'plan', review: 'finish', push: 'finish' };
const TOP_ORDER = ['plan', 'wave', 'finish'];
const STATUS_LABEL = {
  success: 'Succeeded', failure: 'Failed', in_progress: 'In progress', queued: 'Queued',
  skipped: 'Skipped', cancelled: 'Cancelled', unknown: 'Unknown',
};
export const stageStatusLabel = (status) => STATUS_LABEL[status] ?? STATUS_LABEL.unknown;
const OK_RESULTS = new Set(['committed', 'ok', 'done']);
const BAD_RESULTS = new Set(['blocked', 'failed']);
const isLive = (run) => run?.status === 'running';

/** Status of a recorded step entry (latest of its retries): open steps are live, or where an ended run stopped. */
function entryStatus(entry, run) {
  if (entry.end) return 'success';
  if (isLive(run)) return 'in_progress';
  return run?.status === 'done' ? 'success' : 'failure';
}
const notReached = (run) => (isLive(run) ? 'queued' : 'skipped');
const within = (ts, s) => Boolean(ts && s.start && ts >= s.start && (!s.end || ts <= s.end));

/** Per bead: status, model, review rounds, latest verdict, from the timeline's children and the raw events. */
function beadViews(timeline, events, run) {
  const reviews = new Map();
  for (const e of events) {
    if (e.type !== 'review' || !e.bead) continue;
    if (!reviews.has(e.bead)) reviews.set(e.bead, []);
    reviews.get(e.bead).push(e);
  }
  return (timeline.children ?? []).map((c) => {
    const rs = reviews.get(c.bead) ?? [];
    const last = rs[rs.length - 1];
    let status;
    if (c.result) status = OK_RESULTS.has(c.result) ? 'success' : BAD_RESULTS.has(c.result) ? 'failure' : 'unknown';
    else if (isLive(run)) status = c.start ? 'in_progress' : 'queued';
    else status = run?.status === 'done' ? 'unknown' : 'cancelled';
    return {
      bead: c.bead, model: c.model, wave: c.wave, status, result: c.result, durationMs: c.durationMs,
      start: c.start, end: c.end, agents: c.agents, redBeforeGreen: c.redBeforeGreen,
      reviewRounds: rs.length ? Math.max(...rs.map((r) => (isNum(r.round) ? r.round : 0)), rs.length) : 0,
      verdict: last?.verdict ?? null, lastReview: last ?? null,
    };
  });
}

const CI_STAGE = { success: 'success', failure: 'failure', pending: 'in_progress', none: 'skipped', unknown: 'unknown' };

/**
 * The run as a pipeline, GitHub Actions style: `stages` in order (plan, one per wave, finish, CI; a batch has one
 * stage per member run), each with a status (success, failure, in_progress, queued, skipped, cancelled, unknown),
 * its sub-steps and beads; `problems` (failures and warnings, each tied to a stage); `activity`, what the run is
 * doing right now (null when it is not running); `lastEventTs`.
 */
export function pipelineView(detail, members = []) {
  const run = detail?.run ?? {};
  const events = detail?.events ?? [];
  const timeline = detail?.timeline ?? { steps: [], children: [], tests: [] };
  const ci = detail?.ci ?? null;
  const lastEventTs = events.length ? events[events.length - 1].ts ?? null : null;
  if (run.kind === 'batch') return batchView(run, members, lastEventTs);

  const beads = beadViews(timeline, events, run);
  const stages = [];
  const byId = new Map();
  const stageFor = (id, make) => {
    if (!byId.has(id)) { const s = make(); byId.set(id, s); stages.push(s); }
    return byId.get(id);
  };
  const blank = (id, label, step, wave = null) => ({ id, label, step, wave, status: null, start: null, end: null, durationMs: null, sub: [], beads: [], problems: { failure: 0, warning: 0 } });

  for (const entry of timeline.steps ?? []) {
    const parent = PARENT_STEP[entry.step];
    if (parent) {
      const s = stageFor(parent, () => blank(parent, stepLabel({ step: parent }), parent));
      const sub = { id: `${parent}:${entry.step}`, label: stepLabel(entry), step: entry.step, start: entry.start, end: entry.end, durationMs: entry.durationMs, status: entryStatus(entry, run), sha: entry.sha ?? null };
      const i = s.sub.findIndex((x) => x.step === entry.step);
      if (i >= 0) s.sub[i] = sub; else s.sub.push(sub); // a retried sub-step: the latest attempt counts
      continue;
    }
    const id = entry.step === 'wave' ? `wave-${entry.wave ?? '?'}` : entry.step;
    const s = stageFor(id, () => blank(id, stepLabel(entry), entry.step, entry.wave));
    Object.assign(s, { start: entry.start ?? s.start, end: entry.end, durationMs: entry.durationMs, status: entryStatus(entry, run) });
  }
  // Beads go to their wave; a bead whose wave step was never recorded still gets a wave stage.
  for (const b of beads) {
    const id = b.wave != null ? `wave-${b.wave}` : 'wave-?';
    const s = stageFor(id, () => blank(id, b.wave != null ? `Wave ${b.wave}` : 'Wave', 'wave', b.wave));
    s.beads.push(b);
  }
  // Placeholders, so a running run shows what is still ahead.
  if (!byId.has('plan')) stageFor('plan', () => blank('plan', 'Plan', 'plan'));
  if (!stages.some((s) => s.step === 'wave')) stageFor('wave-?', () => blank('wave-?', 'Waves', 'wave'));
  if (!byId.has('finish')) stageFor('finish', () => blank('finish', 'Finish', 'finish'));

  const rank = (s) => {
    const i = TOP_ORDER.indexOf(s.step);
    return i < 0 ? TOP_ORDER.length : i;
  };
  const waveNo = (s) => (isNum(s.wave) ? s.wave : Number.MAX_SAFE_INTEGER);
  stages.sort((a, b) => rank(a) - rank(b) || waveNo(a) - waveNo(b));

  for (const s of stages) {
    // Sub-steps only: the parent was never recorded, so its window and status come from them.
    if (s.status === null && s.sub.length) {
      s.start = s.sub[0].start;
      const open = s.sub.find((x) => x.status !== 'success');
      s.status = open ? open.status : (isLive(run) && s.step === 'finish' ? 'in_progress' : 'success');
      if (s.status === 'success' && s.sub.every((x) => x.end)) s.end = s.sub[s.sub.length - 1].end;
    }
    if (s.status === null && s.beads.length) {
      s.start = s.beads.map((b) => b.start).filter(Boolean).sort()[0] ?? null;
      s.status = s.beads.some((b) => b.status === 'in_progress') ? 'in_progress' : s.beads.every((b) => b.status === 'success') ? 'success' : 'failure';
    }
    if (s.status === null) s.status = notReached(run);
    if (s.beads.some((b) => b.status === 'failure') && s.status === 'success') s.status = 'failure';
  }

  // The run stopped without done: the stage it stopped in failed (the last one that started, if none is marked).
  if (run.status === 'blocked' || run.status === 'failed') {
    if (!stages.some((s) => s.status === 'failure')) {
      const started = stages.filter((s) => s.start || s.status === 'success');
      const at = started[started.length - 1];
      if (at) at.status = 'failure';
    }
  }

  const ciStage = { id: 'ci', label: 'CI', step: 'ci', wave: null, start: null, end: null, durationMs: null, sub: [], beads: [], problems: { failure: 0, warning: 0 }, status: ci ? CI_STAGE[ci.state] ?? 'unknown' : notReached(run), runs: ci?.runs ?? [], sha: ci?.sha ?? null };
  if (!ci && run.status === 'done') ciStage.status = 'skipped';
  stages.push(ciStage);

  const problems = problemsOf({ run, events, timeline, beads, stages, ci });
  for (const p of problems) {
    const s = stages.find((x) => x.id === p.stage);
    if (s) s.problems[p.level] += 1;
  }
  return { stages, problems, activity: activityOf(run, stages, events), lastEventTs };
}

/** Failures and warnings, oldest first, each with the stage it happened in. */
function problemsOf({ run, events, beads, stages, ci }) {
  const out = [];
  const stageAt = (ts) => {
    const hits = stages.filter((s) => s.id !== 'ci' && within(ts, s));
    return hits[hits.length - 1]?.id ?? null;
  };
  const waveOf = (bead) => {
    const b = beads.find((x) => x.bead === bead);
    return b ? (b.wave != null ? `wave-${b.wave}` : 'wave-?') : null;
  };
  for (const e of events) {
    if (e.type === 'tests' && isNum(e.failed) && e.failed > 0) {
      out.push({ level: 'failure', stage: stageAt(e.ts), ts: e.ts, title: `${e.failed} ${e.scope ?? ''} test${e.failed === 1 ? '' : 's'} failed`.replace(/\s+/g, ' '), detail: `${e.passed ?? 0} passed` });
    } else if (e.type === 'review' && String(e.verdict ?? '').toUpperCase() === 'FIX') {
      const later = events.find((x) => x.type === 'review' && x.bead === e.bead && x.ts > e.ts && String(x.verdict ?? '').toUpperCase() === 'PASS');
      const n = isNum(e.mustFix) ? e.mustFix : null;
      const who = e.bead === 'branch' ? 'Branch review' : `Review of ${e.bead ?? 'a bead'}`;
      out.push({
        level: later || isLive(run) ? 'warning' : 'failure', stage: e.bead && e.bead !== 'branch' ? waveOf(e.bead) ?? stageAt(e.ts) : stageAt(e.ts), ts: e.ts, bead: e.bead ?? null,
        title: `${who} asked for ${n ?? 'some'} fix${n === 1 ? '' : 'es'}${e.round ? ` (round ${e.round})` : ''}`,
        detail: later ? `passed in round ${later.round ?? '?'}` : (isLive(run) ? 'being fixed' : 'never passed'),
      });
    } else if (e.type === 'child-end' && BAD_RESULTS.has(e.result)) {
      out.push({ level: 'failure', stage: waveOf(e.bead) ?? stageAt(e.ts), ts: e.ts, bead: e.bead ?? null, title: `${e.bead ?? 'A bead'} ${e.result}`, detail: e.reason ?? e.note ?? null });
    } else if (e.type === 'child-end' && e.redBeforeGreen === 'exception') {
      out.push({ level: 'warning', stage: waveOf(e.bead) ?? stageAt(e.ts), ts: e.ts, bead: e.bead ?? null, title: `${e.bead} skipped red-before-green`, detail: 'recorded as an exception' });
    }
  }
  if (run.status === 'blocked' || run.status === 'failed') {
    const at = stages.find((s) => s.status === 'failure' && s.id !== 'ci');
    out.push({ level: 'failure', stage: at?.id ?? null, ts: run.ended ?? null, title: `Run ${run.status}${at ? ` in ${at.label}` : ''}`, detail: null });
  }
  if (ci?.state === 'failure') {
    const failing = (ci.runs ?? []).filter((r) => r.conclusion && r.conclusion !== 'success' && r.conclusion !== 'skipped').map((r) => r.name).filter(Boolean);
    out.push({ level: 'failure', stage: 'ci', ts: null, title: 'CI failed', detail: failing.length ? failing.join(', ') : null });
  }
  return out;
}

/** What a running run is doing now, as one line, e.g. "Wave 2 · rumbo-qu3.2 (sonnet) fixing review round 1". */
function activityOf(run, stages, events) {
  if (!isLive(run)) return null;
  const now = stages.find((s) => s.status === 'in_progress' && s.id !== 'ci');
  if (!now) {
    const next = stages.find((s) => s.status === 'queued');
    return next ? `Starting ${next.label}` : 'Working';
  }
  const parts = [now.label];
  const openSub = now.sub.find((x) => x.status === 'in_progress');
  if (now.step === 'plan') parts.push(openSub ? 'installing dependencies' : 'planning');
  else if (now.step === 'finish') {
    const tests = events.filter((e) => e.type === 'tests' && within(e.ts, now));
    const reviewed = now.sub.some((x) => x.step === 'review' && x.status === 'success');
    parts.push(openSub?.step === 'push' ? 'pushing' : openSub?.step === 'review' ? 'reviewing the branch'
      : reviewed ? 'preparing the push' : tests.length ? 'running the full gate' : 'finishing');
  } else if (now.step === 'wave') {
    const working = now.beads.filter((b) => b.status === 'in_progress');
    if (working.length === 0) parts.push('starting agents');
    for (const b of working) {
      const doing = !b.lastReview ? 'implementing'
        : String(b.lastReview.verdict).toUpperCase() === 'FIX' ? `fixing review round ${b.lastReview.round ?? b.reviewRounds}` : 'committing';
      parts.push(`${b.bead}${b.model ? ` (${b.model})` : ''} ${doing}`);
    }
  }
  return parts.join(' · ');
}

const MEMBER_STAGE = { running: 'in_progress', done: 'success', blocked: 'failure', failed: 'failure' };

/** A batch: one stage per member run (its epic), in start order; units not started yet are queued. */
function batchView(run, members, lastEventTs) {
  const started = [...members].sort((a, b) => (a.started ?? '').localeCompare(b.started ?? ''));
  const stages = started.map((m) => ({
    id: `member:${m.id}`, label: (m.units ?? []).join(', ') || m.id, step: 'member', runId: m.id, wave: null,
    start: m.started, end: m.ended, durationMs: m.totals?.durationMs ?? null, status: MEMBER_STAGE[m.status] ?? 'unknown',
    sub: [], beads: [], problems: { failure: m.status === 'blocked' || m.status === 'failed' ? 1 : 0, warning: 0 },
  }));
  const seen = new Set(started.flatMap((m) => m.units ?? []));
  for (const u of run.units ?? []) {
    if (seen.has(u)) continue;
    stages.push({ id: `unit:${u}`, label: u, step: 'member', runId: null, wave: null, start: null, end: null, durationMs: null, status: notReached(run), sub: [], beads: [], problems: { failure: 0, warning: 0 } });
  }
  const problems = started.filter((m) => m.status === 'blocked' || m.status === 'failed')
    .map((m) => ({ level: 'failure', stage: `member:${m.id}`, ts: m.ended, title: `${(m.units ?? []).join(', ') || m.id} ${m.status}`, detail: null, runId: m.id }));
  const now = stages.find((s) => s.status === 'in_progress');
  // The batch records little itself; its members' runs are where the work shows up.
  const latest = [lastEventTs, ...members.map((m) => m.ended ?? m.started)].filter(Boolean).sort().pop() ?? null;
  return { stages, problems, activity: isLive(run) ? (now ? `Working on ${now.label}` : 'Starting the next epic') : null, lastEventTs: now ? null : latest };
}

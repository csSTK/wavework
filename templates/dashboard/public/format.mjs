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

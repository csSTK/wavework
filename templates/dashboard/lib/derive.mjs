// Derives the run timeline (steps, children, reviews, tests, totals) from a run's events.
const AGENT_SUMS = ['durationMs', 'tokensIn', 'tokensOut', 'tokensCacheRead', 'tokensCacheWrite', 'cost'];

const ms = (a, b) => {
  const d = Date.parse(b) - Date.parse(a);
  return Number.isFinite(d) ? d : null;
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Sums agent stats. `cost` is null (never 0 or a partial sum) when there are no agents or any agent
 * lacks a numeric cost (unknown model): an unknown cost must not look like a cheap one.
 */
function sumAgents(agents) {
  const out = { count: agents.length };
  for (const k of AGENT_SUMS) out[k] = agents.reduce((s, a) => s + num(a[k]), 0);
  const known = agents.length > 0 && agents.every((a) => typeof a.cost === 'number' && Number.isFinite(a.cost));
  // Round away binary float noise (0.1 + 0.2).
  out.cost = known ? Math.round(out.cost * 1e6) / 1e6 : null;
  return out;
}

export function deriveTimeline(run, events, now = Date.now()) {
  const steps = [];
  const open = new Map(); // step + wave -> stack of open step entries
  const key = (step, wave) => `${step}\0${wave ?? ''}`;
  const sha = (e) => (e.sha ? { sha: e.sha } : {});
  for (const e of events) {
    if (e.type === 'step-start') {
      const entry = { step: e.step, wave: e.wave ?? null, start: e.ts, end: null, durationMs: null };
      steps.push(entry);
      const k = key(e.step, e.wave);
      if (!open.has(k)) open.set(k, []);
      open.get(k).push(entry);
    } else if (e.type === 'step-end') {
      let entry = open.get(key(e.step, e.wave))?.pop();
      if (!entry && e.wave == null) {
        // End without a wave: close the latest open entry of that step.
        const stacks = [...open.entries()].filter(([k, v]) => k.startsWith(`${e.step}\0`) && v.length);
        entry = stacks.length ? stacks[stacks.length - 1][1].pop() : undefined;
      }
      if (entry) {
        entry.end = e.ts;
        entry.durationMs = ms(entry.start, e.ts);
        Object.assign(entry, sha(e));
      } else {
        steps.push({ step: e.step, wave: e.wave ?? null, start: null, end: e.ts, durationMs: null, ...sha(e) });
      }
    }
  }

  const children = [];
  const byBead = new Map();
  for (const e of events) {
    if (e.type === 'child-start') {
      const c = {
        bead: e.bead, model: e.model ?? null, wave: e.wave ?? null, start: e.ts, end: null,
        durationMs: null, result: null, redBeforeGreen: null,
      };
      children.push(c);
      byBead.set(e.bead, c);
    } else if (e.type === 'child-end') {
      let c = byBead.get(e.bead);
      if (!c) {
        c = { bead: e.bead, model: e.model ?? null, wave: e.wave ?? null, start: null, end: null, durationMs: null, result: null, redBeforeGreen: null };
        children.push(c);
        byBead.set(e.bead, c);
      }
      c.end = e.ts;
      c.durationMs = c.start ? ms(c.start, e.ts) : null;
      c.result = e.result ?? null;
      c.redBeforeGreen = e.redBeforeGreen ?? null;
      if (!c.model && e.model) c.model = e.model;
    }
  }

  const agentEvents = events.filter((e) => e.type === 'agent');
  const perChild = new Map(children.map((c) => [c, []]));
  for (const a of agentEvents) {
    let owner = a.bead ? byBead.get(a.bead) : undefined;
    if (!owner) {
      // No bead on the event: attribute to the child whose window contains it.
      owner = children.find((c) => c.start && a.ts >= c.start && (!c.end || a.ts <= c.end));
    }
    if (owner) perChild.get(owner).push(a);
  }
  for (const c of children) c.agents = sumAgents(perChild.get(c));

  const reviews = events.filter((e) => e.type === 'review')
    .map((e) => ({ ts: e.ts, round: e.round ?? null, verdict: e.verdict ?? null, mustFix: e.mustFix ?? 0 }));
  const tests = events.filter((e) => e.type === 'tests')
    .map((e) => ({ ts: e.ts, scope: e.scope ?? null, passed: e.passed ?? 0, failed: e.failed ?? 0, duration: e.duration ?? null }));

  const all = sumAgents(agentEvents);
  const end = run?.ended ? Date.parse(run.ended) : now;
  const start = run?.started ? Date.parse(run.started) : NaN;
  const totals = {
    agents: all.count, tokensIn: all.tokensIn, tokensOut: all.tokensOut,
    tokensCacheRead: all.tokensCacheRead, tokensCacheWrite: all.tokensCacheWrite, cost: all.cost,
    durationMs: Number.isFinite(start) && Number.isFinite(end) ? end - start : null,
  };

  const pushed = [...steps].reverse().find((s) => s.step === 'push' && s.sha)?.sha ?? null;
  return { steps, children, reviews, tests, totals, sha: pushed };
}

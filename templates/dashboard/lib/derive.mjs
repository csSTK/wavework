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
  return { steps, children, reviews, tests, totals, sha: pushed, agents: deriveAgents(run, events, children) };
}

/**
 * One lane per agent: the orchestrator (`agent-step` without agentId and bead), each sub-agent (by agentId), and an
 * implementer known only from `agent-step --bead` Record lines. Each lane lists its steps (the skills it read or
 * recorded, in order; a re-read of the current skill is not a new step), its current step while it runs, its model,
 * bead and time window. A sub-agent ends at its `agent` event (SubagentStop), a bead-only lane at its `child-end`,
 * every open lane at the end of the run.
 */
export function deriveAgents(run, events, children = []) {
  const lanes = [];
  const byId = new Map();
  const childModel = new Map(children.map((c) => [c.bead, c.model]));
  const make = (key, fields) => {
    const lane = {
      key, agentId: null, agentType: null, role: 'agent', model: null, bead: null, start: null, end: null,
      durationMs: null, running: false, current: null, steps: [], cost: null, ...fields,
    };
    lanes.push(lane);
    byId.set(key, lane);
    return lane;
  };
  const roleOf = (lane, skill) => {
    if (!lane.agentId) return lane.key === 'main' ? 'orchestrator' : 'implementer';
    if (skill === 'next-task-review' && lane.steps.length === 0) return 'reviewer';
    return /^implementer\b/.test(lane.agentType ?? '') ? 'implementer' : 'agent';
  };
  const laneFor = (e) => {
    if (e.agentId) return byId.get(e.agentId) ?? make(e.agentId, { agentId: e.agentId });
    if (!e.bead) return byId.get('main') ?? make('main', { role: 'orchestrator' });
    // A Record line from an implementer: its lane is the latest implementer lane of that bead, else a lane of its own.
    const own = [...lanes].reverse().find((l) => l.bead === e.bead && l.role === 'implementer');
    return own ?? make(`bead:${e.bead}`, { bead: e.bead, role: 'implementer' });
  };

  for (const e of events) {
    if (e.type === 'agent-step' && typeof e.skill === 'string' && e.skill) {
      const lane = laneFor(e);
      if (lane.steps.length === 0 && lane.agentId) lane.role = roleOf(lane, e.skill);
      if (!lane.agentType && e.agentType) { lane.agentType = e.agentType; if (lane.role === 'agent') lane.role = roleOf(lane, null); }
      if (e.model) lane.model = e.model;
      if (!lane.bead && e.bead) lane.bead = e.bead;
      if (!lane.start) lane.start = e.ts;
      lane.end = null; // a resumed agent (SendMessage after a review) is running again
      const last = lane.steps[lane.steps.length - 1];
      if (last && last.skill === e.skill && !last.end) continue;
      if (last && !last.end) last.end = e.ts;
      lane.steps.push({ skill: e.skill, start: e.ts, end: null });
    } else if (e.type === 'agent' && e.agentId) {
      const lane = byId.get(e.agentId) ?? make(e.agentId, {
        agentId: e.agentId, agentType: e.agentType ?? null, bead: e.bead ?? null,
        start: Number.isFinite(e.durationMs) ? new Date(Date.parse(e.ts) - e.durationMs).toISOString() : e.ts,
      });
      if (lane.role === 'agent') lane.role = roleOf(lane, null);
      lane.end = e.ts;
      if (!lane.model && e.model) lane.model = e.model;
      if (!lane.bead && e.bead) lane.bead = e.bead;
      if (typeof e.cost === 'number') lane.cost = (lane.cost ?? 0) + e.cost;
    } else if (e.type === 'child-end' && e.bead) {
      const lane = byId.get(`bead:${e.bead}`);
      if (lane && !lane.end) lane.end = e.ts;
    }
  }

  const runEnd = run?.ended ?? null;
  for (const lane of lanes) {
    if (!lane.end && run?.status !== 'running') lane.end = runEnd;
    lane.running = !lane.end && run?.status === 'running';
    if (!lane.model && lane.role === 'implementer' && lane.bead) lane.model = childModel.get(lane.bead) ?? null;
    for (const s of lane.steps) {
      if (!s.end && lane.end && s.start <= lane.end) s.end = lane.end;
      s.durationMs = s.end ? ms(s.start, s.end) : null;
    }
    lane.durationMs = lane.start && lane.end ? ms(lane.start, lane.end) : null;
    const last = lane.steps[lane.steps.length - 1];
    lane.current = lane.running && last && !last.end ? last : null;
    if (lane.cost !== null) lane.cost = Math.round(lane.cost * 1e6) / 1e6;
  }
  // Orchestrator first, then by start.
  return lanes.sort((a, b) => (a.key === 'main' ? -1 : b.key === 'main' ? 1 : (a.start ?? '').localeCompare(b.start ?? '')));
}

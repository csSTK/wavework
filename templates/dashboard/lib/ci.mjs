// CI status for a pushed SHA via `gh run list --commit <sha>`, cached per SHA (only success is final: failed runs get re-run).
import { execFile } from 'node:child_process';

const SHA = /^[0-9a-f]{7,40}$/i;
const BAD = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required', 'stale']);

export function isSha(v) { return typeof v === 'string' && SHA.test(v); }

/** Default gh runner: execFile with an argument list, no shell. Rejects when gh is missing or fails. */
export function defaultGhRunner(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: 10_000, maxBuffer: 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

export function summarize(runs) {
  if (runs.length === 0) return 'none';
  if (runs.some((r) => r.status !== 'completed')) return 'pending';
  if (runs.some((r) => BAD.has(r.conclusion))) return 'failure';
  return 'success';
}

export function createCiLookup({ ghRunner = defaultGhRunner, refreshMs = 15_000, now = Date.now } = {}) {
  const cache = new Map(); // sha -> { at, value, inflight }

  async function fetchSha(sha) {
    try {
      const out = await ghRunner(['run', 'list', '--commit', sha, '--json', 'status,conclusion,url,name']);
      const parsed = JSON.parse(out);
      if (!Array.isArray(parsed)) throw new Error('unexpected gh output');
      const runs = parsed.map((r) => ({
        name: String(r.name ?? ''), status: String(r.status ?? ''), conclusion: r.conclusion ? String(r.conclusion) : null, url: String(r.url ?? ''),
      }));
      return { sha, state: summarize(runs), runs };
    } catch {
      return { sha, state: 'unknown', runs: [] };
    }
  }

  /** Returns { sha, state, runs }; state is unknown when gh is missing/fails or the sha is not a plain hex string. */
  async function lookup(sha) {
    if (!isSha(sha)) return { sha: sha ?? null, state: 'unknown', runs: [] };
    const hit = cache.get(sha);
    const final = hit?.value && (hit.value.state === 'success');
    if (hit?.inflight) return hit.inflight;
    if (hit && (final || now() - hit.at < refreshMs)) return hit.value;
    const inflight = fetchSha(sha).then((value) => { cache.set(sha, { at: now(), value }); return value; });
    cache.set(sha, { ...(hit ?? { at: 0 }), inflight });
    return inflight;
  }
  return { lookup };
}

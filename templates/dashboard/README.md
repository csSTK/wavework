# Pipeline dashboard

Installed by `wavework init` / `wavework update` into `.claude/wavework/dashboard/` (managed by the lock file: do not edit, change `dashboard` in `.claude/wavework.json` instead). Dev tooling (Node >= 22, built-ins only, no node_modules) that records and shows `/next-task*` runs. This folder holds the recorder (`record.mjs`), the SubagentStop and SessionStart hooks (`hooks/`), the server (`server.mjs`, `lib/`), the UI (`public/`) and `config.json` (port and tokensFile, written from the config).

## Store

`$(git rev-parse --git-common-dir)/pipeline-runs/<run-id>/`, shared by every worktree of the repo (never committed, lives inside `.git`). Override with `WAVEWORK_PIPELINE_STORE=<dir>` (used by tests).

- `run.json`: summary, replaced atomically (write temp file, rename).
- `events.jsonl`: append-only, one JSON object per line, written with `O_APPEND` so parallel sub-agents do not interleave lines.

`run.json` fields: `id`, `kind` (`next-task|beads|batch`), `units` (epic/bead ids), `parent` (run id of the batch, for batch members), `branch`, `worktree`, `status` (`running|done|blocked|failed`), `started`, `ended` (ISO timestamps, `ended` is null while running).

## CLI

```
node .claude/wavework/dashboard/record.mjs <event> [--run <id>] [--key value ...]
```

Without `--run` the run is found by cwd: the running run whose `worktree` contains the current directory (deepest worktree wins). `--units a,b` is a list, known numeric keys are stored as numbers, `--some-key` becomes `someKey`. Run ids match `[A-Za-z0-9][A-Za-z0-9._-]*` and are at most 128 characters. `readRun` applies the same check and returns null for anything else, so URL params can be passed in safely.

Recording never blocks the pipeline: any error prints one `pipeline-record: ...` line to stderr and the exit code is 0.

## Events

Every event has `ts` (ISO), `type` and `run`, plus:

| type | fields |
| --- | --- |
| `run-start` | `kind`, `units`, `parent`, `branch`, `worktree` (creates `run.json`) |
| `run-end` | `status` (`done` default, `blocked`, `failed`; updates `run.json`) |
| `step-start`, `step-end` | `step` (`deps`, `plan`, `wave`, `review`, `finish`, `push`), `wave` (on `wave` steps; start and end are paired by step + wave), `sha` (on `step-end --step push`) |
| `child-start`, `child-end` | `bead`, `model`, `wave`, `result`, `redBeforeGreen` (evidence) |
| `review` | `verdict`, `mustFix` (count), `round` |
| `tests` | `scope`, `passed`, `failed`, `duration` |
| `finding` | `bead` (id of the finding bead) |
| `agent` | `agentId`, `agentType`, `bead` (from the first user prompt, after the word "bead"; absent if none), `model`, `durationMs`, `tokensIn`, `tokensOut`, `tokensCacheRead`, `tokensCacheWrite`, `cost` (estimate); written by the SubagentStop hook |

Other keys passed on the command line are stored as given, except `ts`, `type` and `run`, which are always set by the recorder.

`run-start` for an existing id rewrites `run.json` from scratch (status back to `running`); events stay appended. `run-end` without a prior `run-start` creates a minimal `run.json` (`started` null).

## Agent events and pricing

The `agent` events come from the SubagentStop hook (`hooks/subagent-stop.mjs`, registered in `.claude/settings.json` by wavework). Claude Code passes `cwd`, `agent_id`, `agent_type` and `agent_transcript_path` on stdin. The hook reads the sub-agent transcript: usage is taken from assistant messages (`message.usage`, `message.model`), deduplicated by message id (streamed content blocks repeat the id; the max per field wins), duration is last minus first timestamp. The run is found by cwd (falling back to the cwd recorded in the transcript); no running run means nothing is written. The hook always exits 0 and prints nothing to stdout.

`pricing.json` holds USD per million tokens (`input`, `output`, `cacheRead`, `cacheWrite`) per model id. The cost is the sum over messages, each priced with its own model. If any message's model is missing from the table, the event has no `cost` field (never 0). Prices are estimates: cache write is the 5-minute rate (1.25x input), and Haiku uses the rate card for prompts up to 100K tokens.

## Importing

`record.mjs` exports `resolveStoreDir`, `findRunByCwd`, `recordEvent`, `readRun`, `listRuns`, `parseArgs`, `main`, `EVENT_TYPES`, `RUN_ID`, so the server and hooks reuse store resolution and lookup.

## SessionStart hook

`hooks/session-start.mjs` is registered in `.claude/settings.json` by wavework. Every repository uses the same configured port, so at session start it checks `GET /api/health` on the dashboard port (`PIPELINE_DASHBOARD_PORT`, else `config.json`, else 4690) and the next 9 ports in parallel (300 ms timeout), and classifies each: this repository's server (health `store` is this repo's store; servers that do not report `store` are matched by the store of their `root` checkout), a stale dashboard (its `root` no longer exists), another repository's dashboard, free, or a foreign process.

- This repository's server answers on one of them: prints `{"systemMessage":"Pipeline dashboard: http://127.0.0.1:<port>"}` (with a note when it is not the configured port) and starts nothing.
- A stale dashboard (its `root`, the checkout `server.mjs` runs from, no longer exists, e.g. a deleted worktree) that this repository recorded: stops that server via `<store>/server.pid` and starts a fresh one on its port. A stale dashboard it did not record is left alone and its port skipped. The pid file is `{"pid","port","root"}`. The hook kills the recorded pid only when port and root match the answering server and `lsof` lists that pid as the single listener on the port while `ps` shows that record's own `<root>/server.mjs` (so another repo's dashboard is never touched) (a recorded pid alone is not proof, pids get reused). If the record does not match or either check cannot run, it prints one warning and kills nothing.
- Otherwise, on the first free port: starts `server.mjs` detached (`stdio` to `<store>/server.log`, pid file `<store>/server.pid`) and prints `{"systemMessage":"Pipeline dashboard: http://127.0.0.1:<port>"}` once it answers. The server runs from the main checkout's `.claude/wavework/dashboard/server.mjs` (main checkout = parent of `git rev-parse --path-format=absolute --git-common-dir`) when that exists, else from the copy the hook belongs to. So the long-lived server does not depend on a worktree that `/next-task-finish` later deletes.
- No candidate port is free or replaceable (other processes or other repositories' dashboards on all 10): prints one `systemMessage` warning and starts nothing.
- Nothing answers within the start wait (2 s) after the spawn: prints `{"systemMessage":"Pipeline dashboard: could not start, see <store>/server.log"}`. The spawned pid is recorded at spawn, so a server that is still starting stays stoppable.

`PIPELINE_DASHBOARD_START_WAIT_MS` overrides the start wait. It is a test-only knob (tests set it near zero to force the "gave up waiting" path); do not set it in normal use.

A pid record is not overwritten while it names a live server on the same port, and a spawned child clears the record only if it exits without ever answering health.

Two sessions starting together start one server: an exclusive `<store>/server.starting` lock lets only one hook spawn; the other waits for the server. A lock older than 5 s (crashed hook) is taken over by renaming it to a unique name first (rename is atomic, so only one hook moves a given lock); a fresh lock moved by mistake is linked back.

Timing: the hook always exits 0 and has a worst case of about 1.5 s on the stale-server replace path (probe 300 ms, `lsof`/`ps` checks with a 500 ms timeout each, stop wait 250 ms, start wait 600 ms, probes of 150 ms, plus node start-up). Output format: `systemMessage` on stdout JSON, per the Claude Code hooks docs. The 5 s `timeout` in `.claude/settings.json` is only a hard kill.

## Server/API

`wavework dashboard` (or `node .claude/wavework/dashboard/server.mjs`) binds `127.0.0.1` only, port `PIPELINE_DASHBOARD_PORT`, else `config.json` (`dashboard.port`), else 4690, reads the store via `resolveStoreDir`. `createServer({storeDir, port, publicDir, tokensPath, project, ghRunner, ciRefreshMs, watch, pollMs})` is the factory used by tests (`port: 0`, stubbed `ghRunner`; `await server.listen()`, `server.port`, `await server.close()`).

- `GET /api/health`: `{ok:true, root, store}`; `root` is the directory `server.mjs` runs from (the SessionStart hook uses it to spot a server whose checkout is gone), `store` the run store it serves (so a hook in another repository does not take it for its own).
- `GET /api/runs`: run summaries (`run.json` fields + `totals`), newest `started` first; batch members (runs whose `parent` is another run) are nested in the batch's `children`.
- `GET /api/runs/:id`: `{run, events, timeline, ci}`. `timeline` = `steps` (paired step-start/end with `durationMs`, `sha` on push), `children` (per bead: model, wave, result, `redBeforeGreen`, `durationMs`, `agents` summed from `agent` events by `bead`, else by the child's time window), `reviews`, `tests`, `totals` (tokens, `cost`, `agents`, `durationMs`; `cost` is null when there are no agents or any agent has no cost, never 0 or a partial sum), `sha`. Invalid id (not the run-id pattern, `../`, encoded `%2e%2e%2f`, `%2F`, NUL) is 400, unknown id 404.
- A batch that is still `running` but whose members have all ended is reported as ended (`blocked` if any member is blocked/failed, else `done`, `ended` = latest member end) in both endpoints.
- Requests need a `Host` of `127.0.0.1:<port>` or `localhost:<port>`, else 403 (DNS-rebinding guard).
- `GET /api/events`: Server-Sent Events, `event: run-changed` with `data: {"id": "<run id>"}` when a store file changes (`fs.watch` recursive as trigger, polling fallback, also if the store does not exist yet).
- `GET /api/info`: `{project}`, the repo directory name (the main checkout), shown in the UI.
- `/tokens.css` is the project's own tokens file (`dashboard.tokensFile`, resolved inside the repo, symlinks leaving it refused) or an empty stylesheet when none is configured; everything else is served from `public/` only (resolved, symlinks and traversal refused).

**CI status:** the pushed SHA is the `sha` field of the last `step-end` event with `step=push` (the skill emits `record.mjs step-end --step push --sha <sha>`). For such runs, `ci` is `{sha, state, runs[]}` from `gh run list --commit <sha> --json status,conclusion,url,name` (execFile with an argument list, SHA must be 7-40 hex chars). `state` is `success|failure|pending|none|unknown`; missing/failing `gh` gives `unknown`. Results are cached per SHA; only `success` is cached for good, everything else (pending, failure because CI may be re-run, none, unknown) is refreshed after `ciRefreshMs` (15 s). `ci` is null without a pushed SHA.

## UI

Open `http://127.0.0.1:4690/` (your port) after starting the server. Plain HTML/CSS/JS in `public/` (no build): `index.html`, `default-theme.css` (neutral tokens, light and dark), `app.css` (design tokens only, `prefers-reduced-motion`; the project's `/tokens.css` loads after the default theme and may override any token), `app.js` (hash routing, SSE) and `format.mjs` (pure helpers).

- Stages (`pipelineView` in `format.mjs`, pure): Plan (sub-step Deps), one stage per wave (with its beads), Finish (sub-steps Review, Push), CI; a batch has one stage per member run, plus queued units not started yet. Statuses as in GitHub Actions: `success`, `failure`, `in_progress`, `queued` (not reached, run still running), `skipped` (not reached, run ended), `cancelled`, `unknown`. A wave with a blocked bead fails; a blocked or failed run fails the stage it stopped in. Problems: failed tests, `FIX` reviews (a warning once a later round passed or while the run runs, else a failure), blocked/failed beads, `redBeforeGreen exception`, where a blocked run stopped, failed CI workflows; each is tied to a stage (bead events to the bead's wave, others by time window).
- `#/` lists all runs: running first, then newest; batch members are nested under their batch. Each row has a status icon, the stage strip, what the agents are doing now (running runs), the time since the last event (marked quiet after 20 minutes), failure and warning counts, duration, cost and CI. It refreshes on every `run-changed` SSE event, no reload; a run that appears in the store shows up at once. The header shows `Live` or `Reconnecting`.
- `#/runs/<id>` is a deep link to a run: stage sidebar, a "Now" banner while running, header stats, the pipeline graph (stage cards with sub-steps and beads), Annotations (problems), beads (model, wave, duration, tokens, cost, result, review verdict and rounds, red-before-green), reviews, tests, findings filed and CI links.
- Costs are estimates (marked as such); an unknown cost is shown as `—`, never `$0.00`.
- The UI fetches `/api/runs/:id` per run (the list endpoint has no events or `ci`): all once, then only runs that changed, are running, or whose CI is pending (polled every 10 s).
- Untrusted strings are rendered with `textContent`; CI links must be http(s).

Tests live in the wavework package (`test/dashboard/`), not in the target repository.

# Pipeline dashboard

A live view of every `/next-task*` run: steps, waves, sub-agents with model, duration, tokens and estimated cost, reviews, tests, and the CI state of the pushed commit. Plain Node (built-ins only), no build, no database.

## What gets installed

With `dashboard.enabled` (the default), `wavework init` and `update` write the runtime to `.claude/wavework/dashboard/` (recorder, server, UI, hooks, `config.json`) and register two hooks in `.claude/settings.json`: `SessionStart` (starts the server if none runs and prints its URL) and `SubagentStop` (records each sub-agent's tokens and cost). The skills then contain `Record:` lines that call `node .claude/wavework/dashboard/record.mjs`. The runtime is a committed copy, so it works in git worktrees without `node_modules`: commit `.claude/`.

Open the URL the session prints, or run `npx wavework dashboard` in the repository (foreground; it starts the repo's installed server and fails with a clear message when the dashboard is disabled or not installed).

## Configuration

In `.claude/wavework.json` (see [config.md](config.md)):

```json
"dashboard": { "enabled": true, "port": 4690, "tokensFile": "frontend/src/shared/styles/tokens.css" }
```

- `enabled`: `false` removes the Record lines, the runtime files and the hooks on the next `wavework update` (files you edited are kept and reported).
- `port`: 1024 to 65535, default 4690. The environment variable `PIPELINE_DASHBOARD_PORT` overrides it.
- `tokensFile`: optional CSS file with your design tokens. The UI loads a neutral default theme first, then this file, so it can override any token (the token names are in `.claude/wavework/dashboard/public/default-theme.css`). The path is resolved inside the repository; a file that is missing, outside the repo or reached through a symlink leaving it is not served.

## Where the data lives

`<git common dir>/pipeline-runs/<run-id>/` (`run.json` and an append-only `events.jsonl`), shared by all worktrees, never committed because it sits inside `.git`. Delete a run folder to forget a run. The server listens on `127.0.0.1` only and refuses foreign `Host` headers. Event and API details: `.claude/wavework/dashboard/README.md` in your repository.

## Differences from Shipir's original

See "Pipeline dashboard" in [porting.md](porting.md).

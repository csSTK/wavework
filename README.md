# wavework

wavework is a versioned Claude Code pipeline for repositories that use [beads](https://github.com/steveyegge/beads) (`bd`) for task tracking. It installs the `/next-task*` skills, implementer agents and helper scripts into `.claude/` of your repository and keeps them up to date with a lock file.

The pipeline works like this:

- **Waves of parallel sub-agents.** An epic's tasks are planned into waves; each task is implemented by a sub-agent, and each run works in its own git worktree.
- **Independent review.** A fresh, read-only sub-agent reviews every task's diff against the bead's acceptance criteria and the project's rules.
- **Red before green.** Tests are written first, and `red-green-check.sh` checks that new tests fail on the old code.
- **Findings backlog.** Problems found outside a task's scope are filed as beads under a few standing epics, so they can be run later with the same pipeline.

**Status: pre-release.** Version 0.1.0 is not published yet. The commands below describe the CLI as it is on `main`.

## Requirements

- Node.js 22 or newer (npm)
- git
- [beads](https://github.com/steveyegge/beads) (`bd`), with the repository set up for it
- [Claude Code](https://claude.com/claude-code)
- bash (for `red-green-check.sh`)
- [GitHub CLI](https://cli.github.com) (`gh`), only for `/watch-ci`

## Install

From the root of a git repository:

```bash
npm i -D wavework
npx wavework --version
npx wavework init
```

Without `--config`, `init` writes a starter config: `baseBranch` comes from `origin/HEAD`, and the one check runs `npm test` when `package.json` has a `test` script; otherwise it is a placeholder that fails until you replace it. Without `--config` and without `origin/HEAD`, `init` exits with code 1 and asks for `--config`. To start from a complete config file instead (never overwritten once it exists):

```bash
npx wavework init --config <file>
```

`init` writes:

- `.claude/skills/`: the 16 skills (`next-task`, `next-task-*`, `text-to-task`, `watch-ci`)
- `.claude/agents/implementer-<model>.md`: one implementer agent per model in the config (the default config gives `implementer-sonnet` and `implementer-haiku`)
- `.claude/scripts/red-green-check.sh` and its test
- `.claude/wavework/dashboard/`: the pipeline dashboard (with `dashboard.enabled`, the default)
- `.claude/settings.json`: the dashboard's two hooks, merged into your settings without touching other entries
- `.claude/wavework.json`: your configuration (never overwritten)
- `.claude/wavework.lock.json`: the hashes of what wavework wrote (see [docs/lock.md](docs/lock.md))

Commit `.claude/`, including the lock file and the dashboard runtime. Each run works in a git worktree, which has no `node_modules`, so the committed files are what the skills run.

## Daily use

Start these from Claude Code:

- `/next-task <epic-id>`: implements a whole beads epic end to end and pushes it to the base branch.
- `/next-task-beads <id> [<id> ...]`: the same for individual beads (tasks, bugs, chores, findings), without an epic.
- `/next-task-batch <epic-id> <epic-id> ...`: runs `/next-task` for several epics one after another, ordered by their dependencies, and watches CI once at the end.
- `/text-to-task`: turns a free-text feature request into an epic with child tasks, asking questions first when the request is too vague.
- `/watch-ci`: reports the GitHub Actions result for the current commit, branch or run, read-only.

The other `next-task-*` skills are steps that these commands use; you do not start them directly.

## Configuration

The configuration is `.claude/wavework.json`. It names the base branch, the test commands of each area of the codebase and the model per role. The required fields are `baseBranch` and `checks`:

```json
{
  "baseBranch": "main",
  "checks": [
    { "name": "app", "dir": ".", "whenPaths": ["src/"], "focused": "npm test", "full": "npm test" }
  ]
}
```

Every field, its default and its validation rules are in [docs/config.md](docs/config.md). A complete example for a multi-area project is [examples/shipir.wavework.json](examples/shipir.wavework.json).

## Upgrading

Upgrade the package, preview the changes, then apply them:

```bash
npm i -D wavework@latest
npx wavework update --dry-run
npx wavework update
```

`update` re-renders `.claude/` from the installed version and your config. It never changes `.claude/wavework.json`. `--dry-run` prints the plan and writes nothing.

Exit codes:

- `0`: done.
- `1`: error. The plan is checked before anything is written, so a failing run leaves the repository unchanged.
- `2`: done, but some files need your review.

A file needs review when you edited it and the new version changed it too. `update` keeps your file and writes the new version next to it as `<file>.wavework-new`. To resolve it, merge what you want into your file, delete the `.wavework-new` file, and make the file either match the new version or hold the old content again. The next `update` then clears the report; until then every `update` reports it and exits with `2`. The rules are in [docs/lock.md](docs/lock.md).

## Dashboard

The pipeline dashboard shows every `/next-task*` run live: steps, waves, sub-agents with model, duration, tokens and estimated cost, reviews, tests and the CI state of the pushed commit. Its `SessionStart` hook starts the server and prints its URL. To run it in the foreground yourself:

```bash
npx wavework dashboard
```

It listens on `127.0.0.1` at port 4690 by default (`dashboard.port`). Set `dashboard.enabled` to `false` and run `update` to remove it. Details are in [docs/dashboard.md](docs/dashboard.md).

## Comparison with Sous Factory

[Sous Factory](https://sousfactory.com/) (MIT, npm package `sous-factory`) is another tool for running beads tasks through agents. The wavework author trialled Sous Factory on Shipir, the project wavework was ported from, against Shipir's own `/next-task*` pipeline. The numbers below are copied from that trial's handoff notes (`docs/sous-handoff.md` in Shipir, a private repository, so they are cited by run rather than linked). They measure Shipir's pipeline, not wavework; wavework is a port of that pipeline and has not been measured as a whole.

| Run (source) | Tool | Bead | Wall clock | Agent time | Cost | Review |
|---|---|---|---|---|---|---|
| 1 (Run 1, setup 2026-10-24, run date not recorded) | Sous | `shipr-hae` | ~36 min | ~5.5 min | not measured | diff review, then 3 whole-branch rounds |
| 2 (Run 2, date not recorded) | `/next-task-beads` | `shipr-8qd` | ~5 min | API time 2m28s | $1.34 Sonnet, plus $0.56 for a first attempt on Opus that was refused | 1 round, PASS |
| 3 (Run 3, 2026-11-13) | Sous 0.8.0 | `shipr-kipv.2` | ~28 min | ~2.5 min | $1.37 | review-full, 1 round |

Most of the wall clock in both Sous runs was the project's full checks (Maven `verify`), not agent work: Run 1 had about 30 of its ~36 minutes in checks ("~30 min was full Maven `verify` after every step"), and Run 3's implement step had 25m15s of checks out of 26m08s (agent 53s), so about 25 of its ~28 minutes. The wall-clock gap therefore mostly reflects when and how often the full checks run, not agent speed. Run 2's source gives no split between checks and agent time. Run 3's cost is listed per step (check-issue $0.45, plan $0.24, implement $0.27, review $0.22, review-full $0.19); Run 2's source gives one total of $1.34 without a per-step breakdown, so whether it includes planning or orchestration is unknown. The handoff's conclusion was to keep the `/next-task*` pipeline and to take over the one thing Sous did better, a check that new tests fail on the old code. wavework ships that check as `red-green-check.sh`.

Limitations of this comparison:

- One run per tool, on different beads of unrecorded size. The numbers are anecdotes, not a benchmark.
- Sous Run 1 hit a hard-coded `main` branch that cost a stop and a second attempt, and Run 1 was on an earlier Sous version (not recorded). Run 3 used Sous 0.8.0.
- Run 1 has no cost, so the two tools' costs are compared only for Runs 2 and 3.
- The review results compare different review designs, and the Run 2 red-before-green check was done by hand afterwards.
- No neutral party: the same person ran the Sous trial, built the pipeline it was compared with (Shipir's, which wavework was ported from) and made the decision. The project is a Java and React codebase; other repositories would give other numbers.

## Development

`npm test` runs the unit tests (`node:test`, no dependencies). `bash scripts/smoke.sh` packs the package and runs the commands from this README against it in two temporary repositories; CI runs it on Node 22 and 24. The dashboard's server, hooks and UI are tested in `test/dashboard/`; `test/dashboard-cli.test.mjs` covers `wavework dashboard`.

## License

MIT. See [LICENSE](LICENSE).

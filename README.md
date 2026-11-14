# wavework

wavework is a versioned Claude Code pipeline for repositories that use [beads](https://github.com/steveyegge/beads) (`bd`) for task tracking. It installs the `/next-task*` skills, implementer agents and helper scripts into `.claude/` of your repository and keeps them up to date with a lock file.

The pipeline works like this:

- **Waves of parallel sub-agents.** An epic's tasks are planned into waves; each task is implemented by a sub-agent, and each run works in its own git worktree.
- **Independent review.** A fresh, read-only sub-agent reviews every task's diff against the bead's acceptance criteria and the project's rules.
- **Red before green.** Tests are written first, and `red-green-check.sh` checks that new tests fail on the old code.
- **Findings backlog.** Problems found outside a task's scope are filed as beads under a few standing epics, so they can be run later with the same pipeline.

**Status: 0.1.0, first release. Expect changes before 1.0.** The commands below describe the CLI as released.

## Requirements

- Node.js 22 or newer (npm)
- git
- [beads](https://github.com/steveyegge/beads) (`bd`), with the repository set up for it
- [Claude Code](https://claude.com/claude-code)
- bash (for `red-green-check.sh`)
- [GitHub CLI](https://cli.github.com) (`gh`), only for `/watch-ci`

## Install

Inside a git repository (any subdirectory or linked worktree works; wavework runs against the enclosing git repository's working tree root and prints it as the first line, `wavework: repository <root> (<name>)`):

```bash
npm i -D wavework
npx wavework --version
npx wavework init
```

Without `--config`, `init` writes a starter config: `baseBranch` comes from `origin/HEAD`, and the one check runs `npm test` when `package.json` has a `test` script; otherwise it is a placeholder that fails until you replace it. Without `--config` and without `origin/HEAD`, `init` exits with code 1 and asks for `--config`. To start from a complete config file instead (never overwritten once it exists):

```bash
npx wavework init --config <file>
```

To adopt a repository that already has hand-written pipeline files (it never overwrites them):

```bash
npx wavework init --adopt --dry-run --config <file>
npx wavework init --adopt --config <file>
```

For each file `init` would write that already exists: identical content is kept and locked; different content is kept untouched and the rendered version is written to `<file>.wavework-new`, listed with a short `+N -M` line summary (diff it yourself: `diff <file> <file>.wavework-new`; a file with CRLF line endings against the LF rendered version shows every line as changed); missing files are created. `--dry-run` prints this plan and writes nothing. Exit code 0 when everything matched or was created, 2 when files differ. `--adopt` needs `.claude/wavework.json` or `--config <file>` (a starter config would be a guess, so every rendered file would differ) and refuses when a lock exists. Afterwards `npx wavework update` keeps reporting the differing files until you merge them and delete the `.wavework-new` files, or make the file equal to the rendered one. See [docs/lock.md](docs/lock.md).

`init` writes:

- `.claude/skills/`: the 16 skills (`next-task`, `next-task-*`, `text-to-task`, `watch-ci`)
- `.claude/agents/implementer-<model>.md`: one implementer agent per model in the config (the default config gives `implementer-sonnet` and `implementer-haiku`)
- `.claude/scripts/red-green-check.sh` and its test, plus `.claude/scripts/code-map-check.mjs` with a folder code map
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

Optional `codeMap` points the agents at a map of the codebase: a single file (`"path": "docs/CODE_MAP.md"`) or, for larger repositories, a folder with an `index.md` and one short-entry file per module (`"path": "docs/code-map"`, optional `maxDescription`, default 160). The folder layout also installs a checker, `.claude/scripts/code-map-check.mjs`, that `next-task-finish` runs before committing. Optional `tracker.idPrefix` names your bead ID prefix for it.

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

## Development

`npm test` runs the unit tests (`node:test`, no dependencies). `bash scripts/smoke.sh` packs the package and runs the commands from this README against it in two temporary repositories; CI runs it on Node 22 and 24. The dashboard's server, hooks and UI are tested in `test/dashboard/`; `test/dashboard-cli.test.mjs` covers `wavework dashboard`.

Releases are published to npm by `.github/workflows/publish.yml` when a `v*` tag is pushed, using npm trusted publishing (no npm token). The maintainer steps are in [docs/releasing.md](docs/releasing.md).

## License

MIT. See [LICENSE](LICENSE).

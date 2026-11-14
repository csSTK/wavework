# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-11-14

### Removed

- README: the comparison section with another tool.

## [0.3.0] - 2026-11-14

### Fixed

- Pipeline dashboard: runs of a second repository no longer stay invisible until the first repository's server is stopped. Every repository uses the same port (4690 by default), and the SessionStart hook accepted any healthy dashboard on it, so a session in repository B kept showing repository A's server and B's runs. `/api/health` now reports the run store it serves (`store`); the hook only accepts a server that serves its own repository's store (servers from before this change are matched by their checkout) and otherwise uses the next port (up to 9 above the configured one), starting its own server there. It prints the dashboard URL at every session start, so the actual port is always visible.

### Changed

- Pipeline dashboard UI, laid out like a GitHub Actions run. Each run in the list shows its stages as a strip (Plan, Wave 1..n, Finish, CI; one per epic for a batch), each with a status icon (succeeded, failed, in progress, queued, skipped), a line saying what the agents are doing right now (e.g. `Wave 2 · rumbo-qu3.2 (sonnet) fixing review round 1`), how long ago the last event was (flagged as quiet after 20 minutes) and failure and warning counts. The run page has a stage sidebar, a pipeline graph with sub-steps (Deps, Review, Push) and beads per wave, a "Now" banner, and Annotations listing every problem with the stage it happened in: failed tests, review rounds that asked for fixes (a warning once a later round passed), blocked beads, red-before-green exceptions, where a blocked run stopped, and failed CI workflows. The bead, review, test, finding and CI tables stay below.
- New default theme tokens for the status icons and the layout (`--color-status-*`, `--color-on-status`, `--size-icon`, `--size-sidebar`, `--size-stage`, `--size-connector`, `--duration-spin`, `--page-width-detail`); a project `tokensFile` may override them.

## [0.2.0] - 2026-11-13

### Added

- Folder code map layout. `codeMap.path` may now name a folder (a path that does not end in `.md`, e.g. `"docs/code-map"`) instead of a single file. The folder must contain an `index.md` (path prefix to module file table) next to one map file per module; `init` and `update` check this and fail with a clear error before writing anything. Optional `codeMap.maxDescription` (integer 20 to 1000, default 160) sets the longest allowed entry description. The skills then tell agents to read the index, open only the module file that covers their path, and update its lines in the same change (`next-task-implement`, `next-task-code`, `next-task-plan`, `text-to-task`, the implementer agents); `next-task-finish` runs the checker and requires a clean result before committing; `next-task-review` flags missing, stale and over-limit entries.
- Code map checker, installed as `.claude/scripts/code-map-check.mjs` for the folder layout only (Node built-ins, run with `node`; a switch back to the single-file layout removes it on `update`). Rules: description at most `codeMap.maxDescription` characters, no bead IDs, every listed path exists (exact case, normalized repo-relative paths, `{A,B}` braces and `*` `?` `**` globs, no symlink escaping the repository), every map file linked from `index.md`, no path listed twice, no malformed bullets. Exit code 0 ok, 1 violations (`file:line: message`), 2 usage error.
- Optional `tracker.idPrefix` (e.g. `"shipr"`) names the bead ID prefix for the checker's no-bead-ID rule. Without it the checker derives the prefix at run time from `.beads/config.yaml` (`issue-prefix`) or the first ID in `.beads/issues.jsonl`, and skips the rule when neither exists.

### Changed

- Compatibility: in 0.1.2 any string was a single-file `codeMap.path`; now only a path ending in `.md` is the file layout, so an extension-less path such as `"docs/CODE_MAP"` is read as a folder and `update` stops with a clear error until you add the `.md` suffix (or create the folder with an `index.md`).
- `examples/shipir.wavework.json` uses the folder layout (`"docs/code-map"`). A config with a single-file `codeMap.path` (ending in `.md`) renders byte for byte as in 0.1.2; `test/fixtures/shipir-file-layout.wavework.json` keeps that case under the golden tests.

## [0.1.2] - 2026-11-13

### Fixed

- `init` and `update` derive the repository name for the worktree example (`../<repo>-<unit-id>`) from the main checkout (the directory above `git rev-parse --git-common-dir`, as the skills do) instead of the current directory name, so running them in a linked worktree no longer renders the worktree's own name. `next-task-branch` therefore renders the same in every checkout.
- `init` and `update` work from a subdirectory or a linked worktree: they resolve the working tree root with `git rev-parse --show-toplevel` and use its `.claude/` (a worktree gets its own, as `.claude/` is committed per checkout). `--config <file>` stays relative to the directory you run in. Path safety is unchanged (symlinked `.claude/` and `..` paths are still refused). Outside a git working tree (or in a bare repository) they now fail with `not inside a git repository working tree` instead of looking for `.git` in the current directory.
- `init` and `update` print `wavework: repository <root> (<name>)` as their first line, so it is visible which repository they act on (the enclosing git repository's working tree root, e.g. when run from a directory nested inside another repository). Their git calls ignore inherited `GIT_DIR`, `GIT_WORK_TREE` and similar variables, so a stray one can no longer move `.claude/` outside the repository.
- `wavework dashboard` also resolves the working tree root, so it starts the checkout's own installed server from a subdirectory or a linked worktree.
- `next-task-e2e` template: the "Run" section is a single list of commands per area, without the stray blank line and the duplicate Focused/Full list.
- Generated agent descriptions no longer read `Scope: <rule>`: they say `Implements a planned beads task. Use it when this rule applies: <rule> Pass the bead ID.`

## [0.1.1] - 2026-11-13

### Added

- `wavework init --adopt` for repositories that already have hand-written pipeline files: existing files with identical content are kept and locked, differing files are kept untouched with the rendered version written to `<file>.wavework-new` and listed with a short `+N -M` line diff summary, missing files are created, and a script whose content matches but whose exec bit is wrong gets the bit fixed. The lock records the rendered hash for every target, so `update` keeps reporting unresolved files (exit code 2) until you merge and delete the `.wavework-new` file or make the file equal to the rendered one. `--adopt` needs `.claude/wavework.json` or `--config` (no starter config for adoption), refuses an existing lock, supports `--dry-run`, and applies the same path safety as `init`.

### Changed

- `update` reports a file whose `.wavework-new` still exists even when upstream did not change since the last run, so unresolved review files no longer go silent, and it fails closed (exit 1, nothing written) when a symlink sits at a `.wavework-new` path.

## [0.1.0] - 2026-11-13

### Added

- Package skeleton: `wavework` CLI with `--version` and `--help`, test setup with `node:test`, and CI on Node 22 and 24.
- Config: `src/config.mjs` validates and loads `.claude/wavework.json` (defaults, unknown-key rejection, errors as `<json.path>: <reason>`), documented in `docs/config.md` with Shipir's values as `examples/shipir.wavework.json`.
- Skill templates: the 14 `next-task*` skills as `templates/skills/<name>/SKILL.md`, rendered by `src/render.mjs` (`{{var}}`, `{{#if}}`/`{{else}}`) from `src/context.mjs`; golden test against Shipir's skills with reviewed differences in `docs/porting.md`.
- Agent, skill and script templates: the implementer agents (one file per implementer model), the `text-to-task` and `watch-ci` skills and `red-green-check.sh` with its test; `src/targets.mjs` maps every template to its `.claude/` target. `red-green-check.sh` needs only bash, git and node, discovers Maven and Vitest tests and prints `SKIP <area>: unsupported` for other areas.
- `wavework init` and `wavework update`: render the templates into `.claude/`, record a sha256 lock (`docs/lock.md`), keep locally edited files and write `<file>.wavework-new`, restore lost exec bits, merge hooks into `.claude/settings.json` without touching foreign entries, `--dry-run`, exit code 2 when files need review. Every path stays inside `.claude/` (no `..`, absolute paths or symlinks, also for a tampered lock). Config path fields (`checks[].dir`, `whenPaths`, `codeMap.path`, `uiSkill.appliesTo`) must be repo-relative; `.` means the whole repo.
- Pipeline dashboard: `init`/`update` install the recorder, hooks, server and UI into `.claude/wavework/dashboard/` (committed, works in worktrees without `node_modules`) and register its `SessionStart`/`SubagentStop` hooks while `dashboard.enabled`; `dashboard.port` and `dashboard.tokensFile` in the config; `wavework dashboard` starts the server; the skills' `Record:` lines follow the config; neutral default theme; disabling removes its hooks and unedited runtime files on `update` (`docs/dashboard.md`).
- README: install, daily use, configuration, upgrading, and dashboard. `scripts/smoke.sh` runs the README commands against the packed package in CI (`smoke` job), and `test/readme.test.mjs` fails when a README command has no smoke step or test.

[Unreleased]: https://github.com/csSTK/wavework/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/csSTK/wavework/releases/tag/v0.3.1
[0.3.0]: https://github.com/csSTK/wavework/releases/tag/v0.3.0
[0.2.0]: https://github.com/csSTK/wavework/releases/tag/v0.2.0
[0.1.2]: https://github.com/csSTK/wavework/releases/tag/v0.1.2
[0.1.1]: https://github.com/csSTK/wavework/releases/tag/v0.1.1
[0.1.0]: https://github.com/csSTK/wavework/releases/tag/v0.1.0

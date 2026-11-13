# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- README: install, daily use, configuration, upgrading, dashboard and a sourced comparison with Sous Factory. `scripts/smoke.sh` runs the README commands against the packed package in CI (`smoke` job), and `test/readme.test.mjs` fails when a README command has no smoke step or test.

[Unreleased]: https://github.com/csSTK/wavework/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/csSTK/wavework/releases/tag/v0.1.1
[0.1.0]: https://github.com/csSTK/wavework/releases/tag/v0.1.0

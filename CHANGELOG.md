# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Package skeleton: `wavework` CLI with `--version` and `--help`, test setup with `node:test`, and CI on Node 22 and 24.
- Config: `src/config.mjs` validates and loads `.claude/wavework.json` (defaults, unknown-key rejection, errors as `<json.path>: <reason>`), documented in `docs/config.md` with Shipir's values as `examples/shipir.wavework.json`.
- Skill templates: the 14 `next-task*` skills as `templates/skills/<name>/SKILL.md`, rendered by `src/render.mjs` (`{{var}}`, `{{#if}}`/`{{else}}`) from `src/context.mjs`; golden test against Shipir's skills with reviewed differences in `docs/porting.md`.
- Agent, skill and script templates: the implementer agents (one file per implementer model), the `text-to-task` and `watch-ci` skills and `red-green-check.sh` with its test; `src/targets.mjs` maps every template to its `.claude/` target. `red-green-check.sh` needs only bash, git and node, discovers Maven and Vitest tests and prints `SKIP <area>: unsupported` for other areas.
- `wavework init` and `wavework update`: render the templates into `.claude/`, record a sha256 lock (`docs/lock.md`), keep locally edited files and write `<file>.wavework-new`, restore lost exec bits, merge hooks into `.claude/settings.json` without touching foreign entries, `--dry-run`, exit code 2 when files need review. Every path stays inside `.claude/` (no `..`, absolute paths or symlinks, also for a tampered lock). Config path fields (`checks[].dir`, `whenPaths`, `codeMap.path`, `uiSkill.appliesTo`) must be repo-relative; `.` means the whole repo.

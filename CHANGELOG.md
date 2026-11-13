# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Package skeleton: `wavework` CLI with `--version` and `--help`, test setup with `node:test`, and CI on Node 22 and 24.
- Config: `src/config.mjs` validates and loads `.claude/wavework.json` (defaults, unknown-key rejection, errors as `<json.path>: <reason>`), documented in `docs/config.md` with Shipir's values as `examples/shipir.wavework.json`.

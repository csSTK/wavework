# CLAUDE.md

## Commits and pull requests

- Commits carry only the author's name. Don't add `Co-Authored-By: Claude ...` or any other Claude/AI attribution trailer to commit messages.
- Pull request descriptions likewise get no "Generated with Claude Code" line or other Claude attribution.

## Branches

- `dev` is the default branch: start work from it and get changes in by a pull request into `dev` (CI must pass). Don't push to `dev` directly.
- `prd` is the release branch: it only changes by a pull request from `dev`, merged with a merge commit. Release tags go on `prd` (steps in `docs/releasing.md`).

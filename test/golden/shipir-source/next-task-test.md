---
name: next-task-test
description: Runs backend and frontend tests focused on the area that changed (or the full suite with "full"). Used by implementer sub-agents and the next-task orchestrator.
---

# next-task-test

Work out the changed area with `git status --porcelain` plus `git diff --name-only origin/dev...HEAD`, run inside the worktree you were given. Run only what that area needs. If the argument is `full`, run everything listed under **Full**.

## Backend: files under `backend/`

- **Focused:** collect the feature packages that were touched, e.g. `docker`, `compose`. Run:

  ```bash
  ./backend/mvnw -f backend/pom.xml test -Dtest='dev.bethge.shipir.<pkg>.**' -Dsurefire.failIfNoSpecifiedTests=false
  ```

  Join several packages with commas. Run the full backend suite instead if any of these changed:
  - `pom.xml`
  - `application*.yml`
  - `db/migration/`
  - `common/`
  - a test base class or configuration

- **Full:** `./backend/mvnw -f backend/pom.xml verify`
- Docker must be running for Testcontainers. If it isn't, report that. Don't skip the tests.

## Frontend: files under `frontend/`

- **Focused,** from `frontend/`:

  ```bash
  pnpm vitest run <changed dirs, e.g. src/features/stacks src/shared/api>
  pnpm lint
  pnpm exec tsc -b
  ```

  Run `pnpm test` (the full suite) instead if any of these changed:
  - `package.json`
  - `pnpm-lock.yaml`
  - `vite.config.ts`
  - `src/app/`
  - `src/test/`

- **Full:** `pnpm lint && pnpm test && pnpm build`

## E2E

Only if `frontend/playwright.config.ts` exists. Needs the one-time `pnpm exec playwright install chromium`. From `frontend/`:
- Focused: `pnpm e2e e2e/<feature>.spec.ts` for the changed features. Run the full e2e suite if `src/app/`, `src/shared/` or `e2e/fixtures/` changed.
- Full: `pnpm e2e`

See `next-task-e2e` for the conventions.

Record: after each run, `node tools/pipeline-dashboard/record.mjs tests --scope <backend|frontend|e2e|full> --passed <n> --failed <n> --duration <seconds>` (no `--run` needed inside the worktree; append `2>/dev/null || true`, it must never fail a standalone run).

## Report

For each command: the command, pass or fail, and the test counts. On failure, give the first relevant error lines, not the whole log, and keep the last ~40 lines of the failing output so a BLOCKED report can quote it. Implementers count failed runs for the retry cap in `next-task-implement`.

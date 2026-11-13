# Porting notes: Shipir skills to wavework templates

The 14 skills in `templates/skills/<name>/SKILL.md` were ported from Shipir's `.claude/skills/next-task*/SKILL.md` (Shipir `dev`, 2026-11-13). Syntax: `{{var}}`, `{{#if key}}...{{else}}...{{/if}}` (see `src/render.mjs`); the variables come from `src/context.mjs`.

## How parity is checked

`test/templates.test.mjs` renders every template with `examples/shipir.wavework.json` (repo name `shipir`, dashboard on) and diffs the result against a snapshot of the Shipir original in `test/golden/shipir-source/<skill>.md`. The diff is stored in `test/golden/shipir-diff/<skill>.diff` (empty file = identical). The test fails when the diff changes, so every change in a template or in the context shows up in review. After reviewing an intended change, regenerate with `UPDATE_GOLDEN=1 npm test` and update this file. A skill with a non-empty diff must have a `## <skill>` section below (also tested).

Identical to Shipir with its config: `next-task-batch`, `next-task-beads`, `next-task-branch`.

## Design decisions

- **Dashboard.** The dashboard is ported later (shipr-p9ge.6) and is not in the config schema. All `Record:` lines (`tools/pipeline-dashboard/record.mjs`) sit behind `{{#if dashboard}}`. `buildContext(config, { dashboard })` defaults to off, so rendered skills contain no `Record:` lines. The golden test turns it on to keep Shipir's lines. When the dashboard lands, a config field or the init command can set the flag; no schema change is needed now.
- **Model labels.** `model:haiku|sonnet`, `implementer-haiku|sonnet` and the model rules are derived from the keys of `models.implementers.rules` (default model first for agents). Shipir output is unchanged. Limitation: the agent files `.claude/agents/implementer-<model>.md` must exist for every rule key (ported in shipr-p9ge.4).
- **Worktree and branch.** Derived from the patterns. `{repo}` is `repoName` when the caller passes it (init will), else the skill asks the shell (`$(basename "$MAIN")`). Examples with Shipir bead IDs (`shipr-cxk`, `shipr-yy7`, `shipr-hae`, `shipr-1hxo`) are kept as neutral sample IDs.
- **Literal braces.** The Shipir skills contain no `{{` or `}}`. The engine has no escape; a stray brace is an error.
- **Kept as is.** References to `CLAUDE.md` (generic project rules file) and to `.claude/scripts/red-green-check.sh` (ported in shipr-p9ge.4).

## Known limitations

- Dependency update commands are not configurable. `next-task-deps` describes the steps in package-manager-neutral words and takes the verify commands from `checks[].full`. Shipir's `pnpm update` / Maven versions plugin lines are gone.
- Test-framework conventions (JUnit, Testcontainers, Vitest, Playwright fixtures) are not configurable; the skills say "follow the area's existing framework".
- `findings.epicTitles` customises titles and adds categories, but class (Real/Quality) and typical content are built in for the four default slugs; other slugs count as Quality.

## Intended differences per skill

## next-task

- Findings epics named by "the standing findings epics" instead of the literal `"Findings: <category>"` (titles are configurable).
- Step 4 and the red-green bullet say "tests/checks of its area" instead of "backend and frontend"; the Docker remark is now "tests that need external services need them running" (Shipir-specific).
- UI skill remark is `{{uiSkill.name}} for UI under <appliesTo>` instead of "`apple-design` for frontend UI"; omitted without `uiSkill`.

## next-task-code

- The Shipir architecture checklist (package-by-feature, docker-java, `ProcessBuilder`, `PathValidationUtil`, Flyway) is replaced by "follow CLAUDE.md": Java/Spring prose belongs in the project's own rules file.
- The UI bullet comes from `uiSkill` (name, paths); "Skip its Initial Response section" dropped (apple-design specific).
- The "No database writes" bullet is dropped (Shipir DB guard, lives in Shipir's CLAUDE.md).

## next-task-deps

- Per-ecosystem commands (`pnpm install --frozen-lockfile`, `pnpm update`, Maven versions plugin, Spring Boot parent) replaced by neutral steps; areas listed from `checks`, verify commands from `checks[].full`. See limitations.
- Description no longer says "backend and frontend".
- New sentence: CLAUDE.md gives the project's dependency-update commands and what to leave alone; follow it.

## next-task-e2e

- Playwright/Shipir specifics dropped: `frontend/e2e/`, `e2e/fixtures/api.ts` and `api.mock`, port config (`E2E_PORT`), `pnpm e2e:csp`, `playwright.config.ts` check.
- Whole skill body depends on `hasE2e` (some area has an `e2e` command); otherwise it only says to report `e2e: n/a (no e2e setup)`. Run commands come from `checks[].e2e`.
- Description says "browser e2e tests" instead of "Playwright e2e tests".
- New sentence: the project's e2e conventions (fixtures, API mocking helper, ports) are in CLAUDE.md; follow it.

## next-task-findings

- No reference to `BACKLOG.md`, and "CLAUDE.md requires beads for all tracking" became "findings are tracked in beads like all other work".
- Description names "the standing findings epics" (titles configurable).
- Table header "Category epic title"; rows from `findings.epicTitles` (same text with the defaults).
- Epic creation: priority "2 for Real, 3 for Quality" and title "from the table" instead of fixed slugs and `Findings: <Category name>`.
- `model:` rules are the config's rule texts as a list instead of the hard-coded sentence.

## next-task-finish

- The `HANDOFF.md` documentation bullet is dropped (Shipir planning file).

## next-task-implement

- Step 5 says "the checks of your area ... where configured" instead of "Backend and frontend ... if present".

## next-task-plan

- "no unresolved open decision from HANDOFF.md" became "no unresolved open decision".
- Shared-file overlap list is generic (build and dependency manifests, shared configuration) instead of `pom.xml`, `package.json`, `application.yml`.

## next-task-review

- The UI remark reads "the `<uiSkill.name>` skill for UI under <paths>" instead of "`apple-design` + tokens for frontend UI".
- Generic wording for e2e examples without the Mockito `verify(...)` reference (see diff).

## next-task-test

- Per-area sections generated from `checks` (focused, full, lint, build, e2e) instead of the hand-written backend/frontend sections.
- Shipir's list of files that force the full suite (`pom.xml`, `application*.yml`, `db/migration/`, `common/`, `src/app/` ...) became one generic sentence.
- The Docker/Testcontainers remark is generic ("a service that isn't running").
- New sentence: CLAUDE.md may list more files whose change should force the **Full** command; follow it.
- When an area configures `lint`, the skill says to run it with the focused command (Shipir's focused frontend run always included lint); the rendered section is absent without any `lint`.
- e2e paragraph shortened; `playwright.config.ts` and `playwright install` remarks dropped.

## next-task-write-tests

- Java/JUnit/Testcontainers/Mockito and Vitest/Testing Library/`apiFetch`/React Query specifics replaced by framework-neutral rules (same structure: backend and library code, UI code, naming, done-when, red before green).
- Path `backend/src/test/java/dev/bethge/shipir/<feature>/` dropped.
- New sentence: the project's test conventions (frameworks, fixtures, mocking boundaries) are in CLAUDE.md; follow it.

## Moving Shipir-specific guidance (for shipr-p9ge.9)

Checklist of Shipir text that the templates no longer carry and that must go into Shipir's `CLAUDE.md` when Shipir adopts wavework. Wording is quoted from the Shipir sources (`test/golden/shipir-source/`). The four skills `next-task-write-tests`, `next-task-e2e`, `next-task-test` and `next-task-deps` now tell the agent to follow `CLAUDE.md` for these.

- [ ] **Dependency updates** (`next-task-deps`):
  - Frontend: "`pnpm install --frozen-lockfile` checks that the lockfile matches `package.json`. If it fails, run `pnpm install` and include the lockfile in the update commit." / "`pnpm update` updates within the semver ranges in `package.json`. Never use `--latest`." / "`pnpm outdated` shows what's left: major versions not taken."
  - Backend: "Install and compile: `./backend/mvnw -f backend/pom.xml -q dependency:resolve test-compile`." / "Report available updates: `./backend/mvnw -f backend/pom.xml -q versions:display-dependency-updates versions:display-plugin-updates`." / "Apply only patch and minor bumps of versions pinned directly in `pom.xml`." / "Leave versions managed by the Spring Boot parent alone. Bumping the parent itself, including a minor bump, is a separate decision."
  - Commit files: "`package.json`, `pnpm-lock.yaml`, `pom.xml`"; "Major updates and Spring Boot parent bumps are listed in the report, never applied here."
- [ ] **Full-run triggers** (`next-task-test`):
  - Backend: "Run the full backend suite instead if any of these changed: `pom.xml`, `application*.yml`, `db/migration/`, `common/`, a test base class or configuration".
  - Frontend: "Run `pnpm test` (the full suite) instead if any of these changed: `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `src/app/`, `src/test/`".
  - E2E: "Run the full e2e suite if `src/app/`, `src/shared/` or `e2e/fixtures/` changed."
- [ ] **Frontend typecheck:** the focused run was `pnpm vitest run <changed dirs, e.g. src/features/stacks src/shared/api>`, `pnpm lint` and `pnpm exec tsc -b`. The templates only run `checks[].lint`; keep `pnpm exec tsc -b` in CLAUDE.md (or fold it into the `lint` command) unless lint already covers it.
- [ ] **Docker for tests:** "Docker must be running for Testcontainers. If it isn't, report that. Don't skip the tests."
- [ ] **Playwright conventions** (`next-task-e2e`; Shipir's CLAUDE.md says "Conventions in `.claude/skills/next-task-e2e/SKILL.md`", a pointer that will dangle once the skill is generic: change it to point at the new CLAUDE.md section):
  - "Tool: Playwright with Chromium. Specs live in `frontend/e2e/`, one spec per feature flow: `<feature>.spec.ts`, e.g. `containers.spec.ts`."
  - "Target: the Vite frontend with `/api` mocked at the network level (`page.route`). Put shared fixtures and mock data in `frontend/e2e/fixtures/`. Import `test` and `expect` from `e2e/fixtures/api.ts` (see `api.spec.ts` for its behavior). Register API responses with `api.mock(method, path, { status, body })`, with the path without query string; an `/api` call without a mock fails the test. No real backend yet. Once full-stack e2e exists, this skill gets updated."
  - "If the e2e setup doesn't exist yet (no `frontend/playwright.config.ts`), report `e2e: n/a (no e2e setup)`."
  - Run: `pnpm e2e e2e/<feature>.spec.ts` (focused), `pnpm e2e` (full); one-time `pnpm exec playwright install chromium`; "Every Playwright run takes its own free dev-server port (`frontend/e2e-config/port.ts`), so parallel runs, in one checkout or several, never share a server. `E2E_PORT=<port>` overrides it (`E2E_CSP_PORT` for `pnpm e2e:csp`)."
- [ ] **Frontend test conventions** (`next-task-write-tests`): "Vitest with Testing Library. Test behavior as a user sees it: roles, labels, text. Don't test implementation details." / "Mock the network at the `apiFetch` boundary. Don't mock React Query." / test file next to the code as `<name>.test.ts(x)`. Test names: `rejectsPathOutsideBaseDirectory` or `shows error when start fails` (generic version stays in the template).
- [ ] **Backend test conventions** (`next-task-write-tests`): location `backend/src/test/java/dev/bethge/shipir/<feature>/`; "JUnit 5. One test class per class under test: `<ClassName>Test`." / "Anything touching the database or Docker uses Testcontainers through the shared test baseline. Don't start ad-hoc containers." / "Use Mockito only at module boundaries, such as the `docker/` port interfaces. Don't mock the class under test or the JPA layer." Shipir's CLAUDE.md already has "JUnit 5 for unit tests. Testcontainers (Postgres, Docker) for integration tests" and the security malicious-case rule (path traversal, permissions, subprocess), which the template keeps in generic form; the Mockito boundary, shared baseline and `<ClassName>Test` bullets are not in CLAUDE.md yet.
- [ ] **Architecture bullets** (`next-task-code`; Shipir's CLAUDE.md already holds the architecture and security sections, so mostly check that each is stated there): "package-by-feature, and the dependency direction (`docker/` knows no other feature)", "never pass docker-java types outward", "DTOs are built in the service layer", "`ProcessBuilder` with an argument list, never a shell", "all file access goes through `PathValidationUtil`", "no secrets in logs", "Flyway owns the schema".
- [ ] **Database guard** (`next-task-code`): "No database writes outside Testcontainers (see Database Access in CLAUDE.md). If the task needs one, e.g. running the app against the dev database, stop and report it. Don't attempt it." Already in Shipir's CLAUDE.md under Database Access; sub-agents are covered by "Sub-agents never write to a database".
- [ ] **apple-design remark** (`next-task-code`): "Frontend UI (components, styles, interactions): read `.claude/skills/apple-design/SKILL.md` first and apply it. Skip its "Initial Response" section; that's meant for interactive chats. Add no new UI library unless the bead names it." The generic UI bullet comes from `uiSkill`; the "Skip its Initial Response" sentence and "+ tokens" in the review (`apple-design` + tokens for frontend UI) need a home in CLAUDE.md's Frontend UI section (it already names the skill and the tokens).
- [ ] **Other dropped lines:** `BACKLOG.md` "stays the list of Portainer features" (`next-task-findings`); "CLAUDE.md requires beads for all tracking" (already in Shipir's CLAUDE.md); `HANDOFF.md` references in `next-task-plan` ("no unresolved open decision from HANDOFF.md") and `next-task-finish` ("HANDOFF.md: tick any decisions this run settled. Remove items that are now fully covered."); "needs Docker for backend tests" in the red-green bullet of `next-task`.

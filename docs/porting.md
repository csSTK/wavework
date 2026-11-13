# Porting notes: Shipir skills to wavework templates

The 16 skills in `templates/skills/<name>/SKILL.md` were ported from Shipir's `.claude/skills/` (the 14 `next-task*` skills, `text-to-task`, `watch-ci`; Shipir `dev`, 2026-11-13). The agents in `templates/agents/` and the scripts in `templates/scripts/` come from `.claude/agents/` and `.claude/scripts/`. Syntax: `{{var}}`, `{{#if key}}...{{else}}...{{/if}}` (see `src/render.mjs`); the variables come from `src/context.mjs`.

## How parity is checked

`test/templates.test.mjs` renders every template with `examples/shipir.wavework.json` (repo name `shipir`, dashboard on by default) and diffs the result against a snapshot of the Shipir original in `test/golden/shipir-source/<skill>.md`. The diff is stored in `test/golden/shipir-diff/<skill>.diff` (empty file = identical). The test fails when the diff changes, so every change in a template or in the context shows up in review. After reviewing an intended change, regenerate with `UPDATE_GOLDEN=1 npm test` and update this file. A skill with a non-empty diff must have a `## <skill>` section below (also tested). Agents and scripts are covered the same way by `test/targets.test.mjs` (snapshots `implementer-sonnet.md`, `implementer-haiku.md`, `red-green-check.sh`, `red-green-check.test.sh`; diffs `<file>.diff`; sections `## implementer-sonnet` etc.).

Identical to Shipir with its config: `next-task-beads`, `next-task-branch`. This holds for any directory name of the checkout or worktree that runs `wavework init`/`update`: the repo name comes from the main checkout (`git rev-parse --git-common-dir`), not from the current directory, and `test/repo-root.test.mjs` renders the skill in a worktree with a different name to prove it.

## Design decisions

- **Dashboard.** Ported in shipr-p9ge.6, see "Pipeline dashboard" below and `docs/dashboard.md`. The `Record:` lines sit behind `{{#if dashboard}}`; the flag is `dashboard.enabled` in the config (default on). `buildContext` has no `dashboard` option any more. The golden test uses the Shipir config, so the only difference left is the recorder path: `node tools/pipeline-dashboard/record.mjs` became `node .claude/wavework/dashboard/record.mjs` (and `tools/pipeline-dashboard/README.md` became `.claude/wavework/dashboard/README.md`), see `next-task`, `next-task-batch` and `next-task-test` below.
- **Model labels.** `model:haiku|sonnet`, `implementer-haiku|sonnet` and the model rules are derived from the keys of `models.implementers.rules` (default model first for agents). Shipir output is unchanged. The agent files `.claude/agents/implementer-<model>.md` are generated for every rule key plus the default model (see "Agents and file targets").
- **Worktree and branch.** Derived from the patterns. `{repo}` is `repoName` when the caller passes it (init will), else the skill asks the shell (`$(basename "$MAIN")`). Examples with Shipir bead IDs (`shipr-cxk`, `shipr-yy7`, `shipr-hae`, `shipr-1hxo`) are kept as neutral sample IDs.
- **Literal braces.** The Shipir skills contain no `{{` or `}}`. The engine has no escape; a stray brace is an error.
- **Kept as is.** References to `CLAUDE.md` (generic project rules file) and to `.claude/scripts/red-green-check.sh` (ported, see below).

## Known limitations

- **Git submodules.** In a submodule the git common dir is `<super>/.git/modules/<name>`, so the repo name (here and in the skills' `$(basename "$MAIN")`) comes out as `modules`. Not handled.
- Dependency update commands are not configurable. `next-task-deps` describes the steps in package-manager-neutral words and takes the verify commands from `checks[].full`. Shipir's `pnpm update` / Maven versions plugin lines are gone.
- Test-framework conventions (JUnit, Testcontainers, Vitest, Playwright fixtures) are not configurable; the skills say "follow the area's existing framework".
- `findings.epicTitles` customises titles and adds categories, but class (Real/Quality) and typical content are built in for the four default slugs; other slugs count as Quality.

## Code map layouts (0.2.0)

The goldens are rendered with `test/fixtures/shipir-file-layout.wavework.json` (single-file `codeMap.path` `docs/CODE_MAP.md`), so they keep recording the file layout, which renders exactly as in 0.1.x. `examples/shipir.wavework.json` uses the folder layout (`docs/code-map`); `test/templates.test.mjs` checks that it differs from the fixture only in `codeMap`. The folder layout changes the code map wording in `next-task-code`, `next-task-implement`, `next-task-plan`, `next-task-finish`, `next-task-review`, `text-to-task` and the implementer agents (`{{#if codeMap.folder}}`): index first, then only the module file; the checker (`templates/scripts/code-map-check.mjs`, ported from Shipir's `tools/code-map/check.mjs`) is installed verbatim as `.claude/scripts/code-map-check.mjs` and its tests (`test/code-map-check.test.mjs`) run against the rendered script. These folder-layout texts are not part of the Shipir golden; they are covered by the rendering tests in `test/templates.test.mjs`.

## Intended differences per skill

## next-task

- Findings epics named by "the standing findings epics" instead of the literal `"Findings: <category>"` (titles are configurable).
- Step 4 and the red-green bullet say "tests/checks of its area" instead of "backend and frontend"; the Docker remark is now "tests that need external services need them running" (Shipir-specific).
- Recording paragraph: recorder at `.claude/wavework/dashboard/record.mjs`, fields in `.claude/wavework/dashboard/README.md` (was `tools/pipeline-dashboard/`); "record.mjs only exists on the branch, so never from `MAIN`" became "record from `<WT>` while it exists" (the recorder is committed in `.claude/`, so it exists on every checkout).
- UI skill remark is `{{uiSkill.name}} for UI under <appliesTo>` instead of "`apple-design` for frontend UI"; omitted without `uiSkill`.

## next-task-batch

- The `Record:` line calls the installed recorder, `node .claude/wavework/dashboard/record.mjs` instead of `node tools/pipeline-dashboard/record.mjs`.

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
- The "Run" section is one list: `Commands per area (full run as listed; for a focused run, append the spec file):` followed by the per-area commands (no separate Focused/Full list, no blank line inside the list).

## next-task-findings

- No reference to `BACKLOG.md`, and "CLAUDE.md requires beads for all tracking" became "findings are tracked in beads like all other work".
- Description names "the standing findings epics" (titles configurable).
- Table header "Category epic title"; rows from `findings.epicTitles` (same text with the defaults).
- Epic creation: priority "2 for Real, 3 for Quality" and title "from the table" instead of fixed slugs and `Findings: <Category name>`.
- `model:` rules are the config's rule texts as a list instead of the hard-coded sentence.

## next-task-finish

- Recording sentence: "record.mjs only exists on the branch, so never call it from `MAIN`" became "record from `<WT>` while it exists, never after it is removed".
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

- The `Record:` line calls `node .claude/wavework/dashboard/record.mjs` (was `tools/pipeline-dashboard/`).

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

## Agents and file targets

`src/targets.mjs` is the single mapping from templates to files (its header documents the contract; `wavework init` and `update` consume it). One template, `templates/agents/implementer.md`, produces one file per implementer model: every key of `models.implementers.rules` plus `models.implementers.default` (default first), as `.claude/agents/implementer-<model>.md`. `templateTargets(config)` passes `vars.agent = { model, name, description, rule, isDefault, defaultName }`, which the caller merges over `buildContext(...)`. Model names must be safe file names (letters, digits, `.`, `_`, `-`), otherwise it throws. The `description` is a JSON string (a valid YAML double-quoted scalar), so rule texts with `: `, quotes or `#` cannot break the frontmatter.

## implementer-sonnet

- Name, `model:` and the `description` come from the config: `Implements a planned beads task. Use it when this rule applies: <models.implementers.rules[model]> Pass the bead ID.` instead of Shipir's hand-written description ("multi-file, non-trivial, or security-sensitive (auth, permissions, remote Docker host access, audit log, log streaming)"). The text after the colon is the rule text, so Shipir's wording moves into its config.
- "in the Shipir codebase" became "in this codebase".
- The `CODE_MAP.md` mentions (grep to find files, update your lines) appear only with `codeMap`.

## implementer-haiku

- Same as `implementer-sonnet`. Every non-default model gets the escalation paragraph "If the task turns out larger or riskier than described, or outside the scope in your description, stop and report back so it can go to implementer-<default>." Shipir listed the risky areas in it ("auth, permissions, remote host access, audit, subprocesses, path handling or streaming"); now that list lives in the rule text and in `CLAUDE.md`. The paragraph moved below the "Do not commit" paragraph.

## text-to-task

- Planning model comes from `models.planning` (was "Opus" and `/model opus`).
- Context reading: "Working Rules, Model Policy, Architecture, Security, Database & Flyway" became "the working rules, model policy, architecture and security sections"; the `CODE_MAP.md` grep only with `codeMap`; "Read the open decisions in HANDOFF.md" became "Read the project's list of open decisions, if it has one (CLAUDE.md says where)".
- Scope check: roles (ADMIN/OPERATOR/VIEWER), Shipir modules (`docker/`, `host/`, `compose/`) and "JWT vs. session, data model choices" are generic; placement lists the check areas.
- Children: "unit and/or Testcontainers integration" dropped; "Split backend and frontend" became "Split work in different areas"; the model-label bullet lists the config's model rules (the Shipir text "always for auth, permissions, remote host access, audit, subprocess execution, path handling and streaming" is now the Shipir `haiku`/`sonnet` rule texts, see the checklist below); the UI bullet comes from `uiSkill` (name, paths) without the `motion` example; "build order in HANDOFF.md" and "Flyway migration ... entity/repository" became "build order and architecture rules in CLAUDE.md (for example a schema migration is its own child)".
- Example label `model:sonnet` is `model:<models.implementers.default>`; the example title no longer names Flyway.

## watch-ci

- Only the missing-`gh` message: "Run `brew install gh`" became "Install the GitHub CLI (https://cli.github.com)" (no macOS-only package manager). Everything else is identical.

## Pipeline dashboard

`templates/dashboard/` holds Shipir's `tools/pipeline-dashboard/` (recorder, hooks, server, UI, pricing). `wavework init` / `update` copy it **verbatim** (it is JavaScript and CSS, not a template; `verbatim: true` in the target list) to `.claude/wavework/dashboard/`, lock it like every other file and write `config.json` next to it. Differences from Shipir's tool:

- **Location and run time.** The Record lines run from a git worktree, where `node_modules` is usually missing, and the hooks run in the main checkout. So nothing depends on `node_modules` or on an installed wavework: the repo's committed `.claude/wavework/dashboard/` is the runtime (Node >= 22, built-ins only). Commit `.claude/`. `npx wavework dashboard` runs that copy.
- **Store.** Unchanged: `<git common dir>/pipeline-runs/`, shared by all worktrees. The test override env var is `WAVEWORK_PIPELINE_STORE` (was `SHIPIR_PIPELINE_STORE`).
- **Port.** `dashboard.port` (default 4690) is written to `config.json`; `PIPELINE_DASHBOARD_PORT` still overrides it (tests use port 0). The SessionStart hook passes the port to the server it starts.
- **Hooks.** Shipir registered them by hand in `.claude/settings.json` (`SessionStart` beside `bd prime`, `SubagentStop`). wavework registers them from `templates/settings/hooks.json` under `features.dashboard` as its own entries (no matcher), only while `dashboard.enabled`; turning it off removes the entries and the unedited runtime files on `update`.
- **Stale-server stop.** The SessionStart hook only stops a server whose command line names the recorded `<root>/server.mjs` (Shipir matched any `pipeline-dashboard/server.mjs`), so one repo's hook can never stop another repo's or a developer's own dashboard. The start wait is 2 s (was 600 ms) for slow machines.
- **Server location.** The SessionStart hook runs `<main checkout>/.claude/wavework/dashboard/server.mjs` when it exists, else its own copy (was `tools/pipeline-dashboard/server.mjs`).
- **Theme.** Shipir's UI used Shipir's design tokens from `frontend/src/shared/styles/tokens.css`. The UI now loads `/default-theme.css` (neutral, light and dark, defines every token `app.css` uses) and then `/tokens.css`, which is the file named by `dashboard.tokensFile` (repo-relative `.css`, resolved inside the repo, symlinks leaving it refused) or an empty stylesheet. Shipir sets `tokensFile: "frontend/src/shared/styles/tokens.css"` to keep its look.
- **Project name.** `GET /api/info` returns the repo directory name (main checkout); the UI shows it in the header and the tab title.
- **Tests.** Shipir's `node:test` suites run in wavework as `test/dashboard/*.test.mjs` directly against `templates/dashboard/` (the files contain no placeholders), plus new tests for settings, tokens, `/api/info` and a fixture repo that is not Shipir (`test/dashboard-install.test.mjs`). The Playwright check is the opt-in script `e2e/dashboard.e2e.mjs` (Playwright is not a dependency of wavework, so it cannot run in `npm test` or CI).

## red-green-check.sh

Rewritten around an area table, so output and exit codes match Shipir's script for Shipir's config but the code is not a line-for-line port (the diff is large on purpose).

- **Areas come from `checks`.** The table `AREAS=( 'name|kind|dir' ... )` is rendered from `config.checks` (`name`, `dir`, and a kind guessed from the area's `focused` command: contains `mvn`/`mvnw` means `maven`, contains `vitest` means `vitest`, anything else `unsupported`). Names or dirs containing `|`, `'` or a newline are rejected when rendering. Shipir's hard-coded `backend/` and `frontend/` prefixes are gone; a changed file belongs to the area with the longest matching `dir` (`.` matches everything).
- **Test discovery is ecosystem-specific and stays that way.** `maven`: `*Test.java`, `*Tests.java`, `*IT.java` under `<dir>/src/test`, run with `./mvnw` (else `mvn`) `test -Dtest=<classes>`, results from surefire XML. `vitest`: `*.test.ts|tsx|js|jsx`, run with `pnpm` (when `pnpm-lock.yaml` exists) or `npx vitest` after `npm ci` (when `package-lock.json` exists), results from the JSON reporter; no lock file means the area prints `SKIP`. An area the script does not understand is never run: when files in it changed the script prints `SKIP <area>: unsupported (...)` and judge those tests from the diff (the reviewer sees the line). `maven` and `vitest` are the only kinds; adding one means editing the script template.
- **No python.** Shipir's script needed `python3` for XML, JSON and diff parsing; the port uses `node` (always present where wavework runs). Needs bash (3.2 compatible), git and node.
- Default base ref is still `HEAD` (Shipir's behaviour); callers pass `origin/<baseBranch>` for branch reviews, as the skills do.
- Display lines say `<area name> ...` instead of `backend`/`frontend`. Backend `-f backend/pom.xml` from the repo root became running `./mvnw` inside `<dir>`.
- Testing seam: `RED_GREEN_AREAS` (same line format) replaces the table; only the script's own test uses it.

## red-green-check.test.sh

- Adds cases: frontend GREEN-ON-OLD, SKIP of an unsupported area (alone and next to a supported one), helper files only, argument errors. It sets `RED_GREEN_AREAS` to its own table (a stubbed Maven area `backend`, a stubbed Vitest area `frontend`, an unsupported `svc`), so it is the same file for every config and needs only bash, git and node (the Shipir original also used python3 through the script under test). The `mvnw` and `pnpm` are stubs in a throwaway repo; no Maven, pnpm, Docker or network. `test/red-green-check.test.mjs` runs it in wavework's CI against the rendered script.

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
- [ ] **text-to-task** (quoted from `test/golden/shipir-source/text-to-task.md`): "Read CLAUDE.md: Working Rules, Model Policy, Architecture, Security, Database & Flyway." / "Read the open decisions in HANDOFF.md." / "Respect the build order in HANDOFF.md and the architecture rules (e.g. a Flyway migration is its own child, ahead of the entity/repository that needs it)." / the roles "(role: ADMIN/OPERATOR/VIEWER)" and "which feature module(s) (`docker/`, `host/`, `compose/`, …)" / "(unit and/or Testcontainers integration)" / "or the architecture tree". The generic skill points at CLAUDE.md for all of it: keep the open-decisions pointer (HANDOFF.md), the build-order note and the Flyway-migration-is-its-own-child rule in Shipir's CLAUDE.md.
- [ ] **Model policy as rule texts** (`text-to-task`, `implementer-*`): Shipir's labelling sentence "`model:sonnet` for everything else and **always** for auth, permissions, remote host access, audit, subprocess execution, path handling and streaming" and the agent descriptions "security-sensitive (auth, permissions, remote Docker host access, audit log, log streaming)" / "Never use for auth, permissions, remote host access, or the audit log" are now carried only by `models.implementers.rules` in Shipir's `.claude/wavework.json` (`examples/shipir.wavework.json`). Add "subprocess execution, path handling" to the sonnet rule there, and the haiku escalation sentence "(or touches auth, permissions, remote host access, audit, subprocesses, path handling or streaming)".
- [ ] **UI example in text-to-task:** "add an acceptance criterion such as "UI follows the apple-design skill: instant press feedback, reduced-motion handled, consistent typography and spacing"" and "(e.g. `motion` for springs)": covered by Shipir's CLAUDE.md Frontend UI section.
- [ ] **red-green-check.sh:** Shipir's `.claude/scripts/red-green-check.sh` is replaced by the rendered script; Shipir's test discovery (`backend/src/test/**/*Test|*Tests|*IT.java`, `frontend/**/*.test.ts(x)`) is covered by the `maven` and `vitest` kinds because Shipir's `focused` commands contain `mvnw` and `vitest`. Keep those words in the focused commands (or the areas turn `unsupported`). The script no longer needs `python3`.
- [ ] **Pipeline dashboard (shipr-p9ge.6):** delete Shipir's `tools/pipeline-dashboard/` (its tests, README and e2e script too) and the two dashboard entries in `.claude/settings.json` (`SessionStart` `session-start.mjs` and `SubagentStop` `subagent-stop.mjs`): `wavework init` installs the copy in `.claude/wavework/dashboard/` and registers its own hooks (keep `bd prime` and the other foreign hooks). Put `"dashboard": { "port": 4690, "tokensFile": "frontend/src/shared/styles/tokens.css" }` in `.claude/wavework.json` (already in `examples/shipir.wavework.json`). Update CLAUDE.md's "Pipeline dashboard" paragraph: `npx wavework dashboard`, data in `.git/pipeline-runs/`. Runs already recorded stay readable (same store, same format). `SHIPIR_PIPELINE_STORE` is now `WAVEWORK_PIPELINE_STORE`. Commit `.claude/wavework/` so worktrees have the recorder.

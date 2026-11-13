---
name: next-task-test
description: Runs the checks of the area that changed (or the full suite of every area with "full"). Used by implementer sub-agents and the next-task orchestrator.
---

# next-task-test

Work out the changed area with `git status --porcelain` plus `git diff --name-only origin/{{baseBranch}}...HEAD`, run inside the worktree you were given. An area counts as changed when a changed path starts with one of its path prefixes below. Run only what that area needs. If the argument is `full`, run the **Full** command of every area.

{{checksSection}}

{{#if hasLint}}
When an area lists a **Lint** command, also run its **Lint** command with the focused command.

{{/if}}
Run the **Full** command of an area instead of the focused one if its build or dependency manifests, shared configuration or shared test infrastructure changed. CLAUDE.md may list more files whose change should force the **Full** command; follow it.

If a check needs a service that isn't running (a container runtime, a database), report that. Don't skip the tests.

{{#if hasE2e}}
E2E commands run as part of their area. Run the focused e2e spec for the changed feature, and the whole e2e command if shared code or fixtures changed. See `next-task-e2e` for the conventions.

{{/if}}
{{#if dashboard}}
Record: after each run, `node .claude/wavework/dashboard/record.mjs tests --scope <{{areaNamesPipe}}|e2e|full> --passed <n> --failed <n> --duration <seconds>` (no `--run` needed inside the worktree; append `2>/dev/null || true`, it must never fail a standalone run).

{{/if}}
## Report

For each command: the command, pass or fail, and the test counts. On failure, give the first relevant error lines, not the whole log, and keep the last ~40 lines of the failing output so a BLOCKED report can quote it. Implementers count failed runs for the retry cap in `next-task-implement`.

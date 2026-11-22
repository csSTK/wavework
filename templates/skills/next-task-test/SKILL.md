---
name: next-task-test
description: Runs the checks of the area that changed (or, with "full", the full suite of every area the branch changed). Used by implementer sub-agents and the next-task orchestrator.
---

# next-task-test

Work out the changed area with `git status --porcelain` plus `git diff --name-only origin/{{baseBranch}}...HEAD`, run inside the worktree you were given. An area counts as changed when a changed path starts with one of its path prefixes below. Run only what that area needs.

If the argument is `full`, run the **Full** command of every changed area (same diff, against `origin/{{baseBranch}}`):
- A changed path that belongs to no area and isn't skipped (below) can affect anything (root config, CI, shared scripts): then run the **Full** command of **every** area.
{{#if fullGateSkipPaths}}
- Paths matching {{fullGateSkipPaths}} (a trailing `/` is a folder, `*.<ext>` a file extension) never trigger an area on their own. If they are all that changed, there is nothing to run: report `full: skipped (only <paths> changed)`.
{{/if}}
- Name the areas you ran and why, and the ones you left out.

{{checksSection}}

{{#if hasLint}}
When an area lists a **Lint** command, also run its **Lint** command with the focused command.

{{/if}}
Run the **Full** command of an area instead of the focused one if its build or dependency manifests, shared configuration or shared test infrastructure changed. CLAUDE.md may list more files whose change should force the **Full** command; follow it.

If a check needs a service that isn't running (a container runtime, a database), report that. Don't skip the tests.

{{#if hasE2e}}
E2E commands run as part of their area. Run the focused e2e spec for the changed feature, and the whole e2e command if shared code or fixtures changed. See `next-task-e2e` for the conventions.

{{/if}}
## Running a command

Other agents run tests in parallel on the same machine, often in the same worktree. So:

- **Log to a file, read only the end.** `cd <worktree> && LOG="$(git rev-parse --absolute-git-dir)/wavework-test-$(date +%s).log"; <command> >"$LOG" 2>&1; echo "exit=$?"; tail -n 60 "$LOG"`. Read more of the log (with `grep` for the failing test names, never whole) only when the tail doesn't show the cause.
- **Full, e2e and the red-green check run one at a time per repository** (they share ports, containers and the database daemon): wrap them as `flock "$(git rev-parse --git-common-dir)/wavework-tests.lock" <command>` when `flock` exists (`command -v flock`); without it, run them unwrapped.
- **Wait in the foreground** with an explicit Bash `timeout` (up to 600000 ms). Only a command that can run longer than that goes to the background (`run_in_background`): then do nothing else with it until its completion notification arrives. Never poll it, never `sleep`, never loop on `pgrep`/`ps`.
- **Stop only what you started**, by the PID or the background task you got when you started it. Never `pkill`/`killall` or kill by name or pattern: that hits other agents' runs.

{{#if dashboard}}
Record: after each run, `node .claude/wavework/dashboard/record.mjs tests --scope <{{areaNamesPipe}}|e2e|full> --passed <n> --failed <n> --duration <seconds>` (no `--run` needed inside the worktree; append `2>/dev/null || true`, it must never fail a standalone run). A skipped full run records `--scope full --passed 0 --failed 0 --duration 0`.

{{/if}}
## Report

For each command: the command, pass or fail, and the test counts. On failure, give the failing test names and the first relevant error lines, not the whole log, and keep the last ~40 lines of the failing output so a BLOCKED report can quote it. Implementers count failed runs for the retry cap in `next-task-implement` and read the root-cause line for each retry from these error lines.

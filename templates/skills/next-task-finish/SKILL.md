---
name: next-task-finish
description: Final step of /next-task and /next-task-beads once all sub-agents are finished. Rebases onto origin/{{baseBranch}}, runs the full test gate, records findings, closes the beads, writes short documentation, pushes to {{baseBranch}} from the worktree and removes the worktree and branch. Normally invoked by those skills, not directly.
---

# next-task-finish

Only run this when no child is blocked (see `next-task` step 6). Worktree and branch are removed only after a successful push (step 7); any earlier stop keeps both for resuming.

Everything runs **inside the worktree** (`cd <WT> && ...`). The main checkout is never switched: the branch is pushed to `{{baseBranch}}` directly, so other sessions keep their checkout.

Docs and bead closing happen **before** the push, so they're included in it.

{{#if dashboard}}
Record: `step-start --step finish` at the start. The full gate in step 2 records its `tests` (see `next-task-test`) and the branch review its `review` and `step-start/step-end --step review`. `step-start --step push` before step 6 and `step-end --step push --sha $(git rev-parse HEAD)` after it (the pushed commit), then, still in `<WT>` right before step 7 removes it, `step-end --step finish` and `run-end --status done` (record from `<WT>` while it exists, never after it is removed). Under `next-task-batch`, for the last epic that runs: also `run-end --run <BATCH-RUN> --status done|blocked` right before removing `<WT>`, or, if that epic stopped, from its kept `<WT>` at the stop (`blocked` if any epic stopped or was skipped). Every stop in this skill: `run-end --status blocked` (failed gate, conflict, rejected push, open must-fix).

{{/if}}
1. **Rebase onto the latest {{baseBranch}}.** `git fetch origin` then `git rebase origin/{{baseBranch}}`. If there are conflicts, stop and report. Don't resolve them by guessing.
2. **Full test gate.** Run `next-task-test full` on the rebased branch **in a sub-agent** (`implementer-{{models.implementers.default}}`; the gate's logs never enter your context). Its prompt: the worktree and branch, "run `.claude/skills/next-task-test/SKILL.md` with `full` and apply the flaky rule of `.claude/skills/next-task-finish/SKILL.md` step 2; change no files, commit nothing", and this report format: `Gate: PASS | FAIL | FLAKY`, the areas run and skipped, per area the passed/failed counts, and per failing test its name, whether the branch touches it or the code it tests, and up to 10 error lines.
   - **Flaky rule:** when tests fail, rerun **only the failing tests once** (the area's focused command narrowed to them). Still failing: `FAIL`. Passing on the rerun: `FLAKY`, but `FAIL` if the branch changed the test or the code it tests (a flake in your own code is a bug). Never a third run, never a rerun of the whole gate to "settle" it.
   - `PASS`: continue. `FAIL`: **stop**: don't close beads, don't push, and report the failure. `FLAKY`: file each flaky test with `next-task-findings` (category `tests`, the test's full name and both outputs in the description; dedupe against open **and closed** beads with that test name, and when a closed one matches, say "regressed, see <id>" and raise the priority by one), record it, name it in the report, and continue.
   **Branch review** (always): run the branch mode of `next-task-review` over `origin/{{baseBranch}}..HEAD` (code lens plus the branch lenses that apply), giving the reviewers the output of `.claude/scripts/red-green-check.sh <WT> origin/{{baseBranch}}`.
   - PASS: continue. Out-of-scope items go to `next-task-findings` (step 3).
   - `impl` must-fix: one fix round by an implementer (SendMessage, or a new one), verify and commit as `Fix branch review findings (<id>)`, rerun the gate (as above), then review once more.
   - `spec` must-fix, or still must-fix after the fix round: **stop before the push**: no push, no bead closing, keep worktree and branch, report the open findings (`spec` items: which bead needs fixing).
3. **Findings.** Run `next-task-findings` for anything collected during the run that isn't filed yet, plus anything the full gate or the overall diff (`git diff origin/{{baseBranch}}...HEAD`) shows outside the scope.
4. **Close the beads.**
   - Each child (or each bead given to `/next-task-beads`): `bd close <id> "<one line: what was done> (<commit hash>)"`. Only close beads whose acceptance criteria were verified.
   - Epic runs only: `bd close <epic> "<one line summary>"`, but only once every child is closed.
   - Beads that aren't done stay open, and the epic stays open too. Say so in the report.
5. **Write documentation.** Keep it short, following the CLAUDE.md rule:
   {{#if codeMap}}
   {{#if codeMap.folder}}
   - Code Map (`{{codeMap.path}}/`): check that every added, moved or removed file has a correct one-line entry in its module file, then run `{{codeMap.checkCommand}}` and fix every violation before committing (exit code 0 required).
   {{else}}
   - Code Map (`{{codeMap.path}}`): check that every added, moved or removed file has a correct one-line entry.
   {{/if}}
   {{/if}}
   - README.md: update only if setup, commands or features visible to users changed.
   - CLAUDE.md: update Build & Test or the rules only if they changed.
   - Export the beads right before this commit: `bd export -o .beads/issues.jsonl` (the file is only a snapshot; it is not updated on its own). Check that the line count did not drop against `origin/{{baseBranch}}` (`git diff --stat`): a big drop means this clone's database is behind, so stop and report instead of committing it.
   - Commit as `Document <epic title> (<epic-id>)` (bead runs: `Document <short summary> (<id>, <id>)`), including `.beads/issues.jsonl`.
6. **Push to {{baseBranch}}.**
   - `git fetch origin` and check `git merge-base --is-ancestor origin/{{baseBranch}} HEAD`. If {{baseBranch}} moved in the meantime, rebase again (step 1; conflicts stop). Then rerun the gate only for the areas that **both** the newly arrived commits (`git diff --name-only <old origin/{{baseBranch}}>..origin/{{baseBranch}}`) and this branch change, by the same area rules as `next-task-test full`. None in common: no rerun (each side was already tested on its own); say so in the report. The branch review is not repeated.
   - `git push origin HEAD:{{baseBranch}}`. This is a fast-forward push; never use `--force` or `--force-with-lease`. If it is rejected, stop and report.
   - Then push the beads: `bd dolt push`. If it is rejected because another clone pushed first, run `bd dolt pull` once and push again. If that fails too, report it (the code push stands) and don't retry with force.
7. **Clean up** after a successful push, from the main repo (`MAIN`, see `next-task-branch`):
   - `git -C "$MAIN" worktree remove <WT>`. Without `--force`: it refuses if anything is uncommitted; then stop and report.
   - Check `git -C "$MAIN" merge-base --is-ancestor <branch> origin/{{baseBranch}}`, then `git -C "$MAIN" branch -D <branch>`. The ancestor check is what makes `-D` safe; never skip it.
   - Update the local `{{baseBranch}}` only if no worktree has it checked out: `git -C "$MAIN" fetch origin {{baseBranch}}:{{baseBranch}}` (git refuses on its own otherwise; that's fine, mention it).
8. **CI** is not part of this skill. The optional `watch-ci` step belongs to the calling skill.

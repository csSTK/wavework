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
2. **Full test gate.** Run `next-task-test full` on the rebased branch. If anything fails, **stop**: don't close beads, don't push, and report the failure.
   **Branch review** (always): run the branch mode of `next-task-review` over `origin/{{baseBranch}}..HEAD`, giving the reviewer the output of `.claude/scripts/red-green-check.sh <WT> origin/{{baseBranch}}`.
   - PASS: continue. Out-of-scope items go to `next-task-findings` (step 3).
   - Must-fix: one fix round by an implementer (SendMessage, or a new one), verify and commit as `Fix branch review findings (<id>)`, rerun `next-task-test full`, then review once more.
   - Still Must-fix: **stop before the push**: no push, no bead closing, keep worktree and branch, report the open findings.
3. **Findings.** Run `next-task-findings` for anything collected during the run that isn't filed yet, plus anything the full gate or the overall diff (`git diff origin/{{baseBranch}}...HEAD`) shows outside the scope.
4. **Close the beads.**
   - Each child (or each bead given to `/next-task-beads`): `bd close <id> "<one line: what was done> (<commit hash>)"`. Only close beads whose acceptance criteria were verified.
   - Epic runs only: `bd close <epic> "<one line summary>"`, but only once every child is closed.
   - Beads that aren't done stay open, and the epic stays open too. Say so in the report.
5. **Write documentation.** Keep it short, following the CLAUDE.md rule:
   {{#if codeMap}}
   - Code Map (`{{codeMap.path}}`): check that every added, moved or removed file has a correct one-line entry.
   {{/if}}
   - README.md: update only if setup, commands or features visible to users changed.
   - CLAUDE.md: update Build & Test or the rules only if they changed.
   - Commit as `Document <epic title> (<epic-id>)` (bead runs: `Document <short summary> (<id>, <id>)`), including `.beads/issues.jsonl`.
6. **Push to {{baseBranch}}.**
   - `git fetch origin` and check `git merge-base --is-ancestor origin/{{baseBranch}} HEAD`. If {{baseBranch}} moved in the meantime, go back to step 1 (rebase and run the gate again).
   - `git push origin HEAD:{{baseBranch}}`. This is a fast-forward push; never use `--force` or `--force-with-lease`. If it is rejected, stop and report.
7. **Clean up** after a successful push, from the main repo (`MAIN`, see `next-task-branch`):
   - `git -C "$MAIN" worktree remove <WT>`. Without `--force`: it refuses if anything is uncommitted; then stop and report.
   - Check `git -C "$MAIN" merge-base --is-ancestor <branch> origin/{{baseBranch}}`, then `git -C "$MAIN" branch -D <branch>`. The ancestor check is what makes `-D` safe; never skip it.
   - Update the local `{{baseBranch}}` only if no worktree has it checked out: `git -C "$MAIN" fetch origin {{baseBranch}}:{{baseBranch}}` (git refuses on its own otherwise; that's fine, mention it).
8. **CI** is not part of this skill. The optional `watch-ci` step belongs to the calling skill.

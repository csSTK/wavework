---
name: next-task-beads
description: Implement one or more individual beads (tasks, bugs, chores, findings — not epics) end to end, like /next-task but without an epic. Creates a worktree branch, plans waves, hands each bead to an implementer sub-agent, records findings, closes the beads, pushes to {{baseBranch}}. Use when the user says "next-task-beads <id> [<id> ...]" or asks to implement specific beads.
---

# next-task-beads

Same pipeline as `next-task`, for a hand-picked set of beads instead of an epic's children. **Model check first:** before any other step or tool call, check the session model. If it isn't {{orchestrationModelName}} (Model Policy in CLAUDE.md), stop, say so and suggest `/model {{models.orchestration}}`. Don't create branches or claim beads first.

**Input:** one or more bead IDs, optionally with the flag `--watch-ci` (`$ARGUMENTS`; the whole-branch review before the push always runs, against the beads' descriptions and criteria). If none is given, stop and ask; never pick beads yourself. If an ID is an epic, stop and point to `/next-task` (or `/next-task-batch` for several epics).

**By invoking this skill the user authorizes** for these beads: creating and deleting one branch and worktree, committing, pushing it to `{{baseBranch}}` (fast-forward only) and filing `finding` beads. Nothing else: never force-push, never rewrite pushed history{{#if noAttribution}}, never add attribution lines{{/if}}.

## Steps

Follow `next-task` steps 1–8, with these differences:

{{#if dashboard}}
Record: the `run-start` uses `--kind beads --units <bead ids>`.
{{/if}}
1. **Branch:** `next-task-branch` with prefix `task`, unit ID = the first bead ID, title = that bead's title (one bead) or a short summary of the set. E.g. `{{taskBranchExample}}`.
2. **Check beads:** `next-task-plan` part 1 with the given beads as the work set. Beads without a `model:` label fail the check: stop and suggest `/text-to-task` or adding the label. (Findings filed by `next-task-findings` already carry one. To run a whole group of them, use `/next-task <findings-epic>`.) Dependencies between the given beads order the waves; an open blocker outside the set stops the run.
3. **Dependencies, plan, hand-off, verify, findings:** exactly as in `next-task` steps 3–6, including the **Red before green** check (a report without it is a must-fix) and the **Red-green check** script run (`.claude/scripts/red-green-check.sh <WT>` after re-running `next-task-test`, before the review; its output goes to the reviewer) and the `next-task-review` loop after each bead (max 3 rounds, then stop that bead and hand off) and the BLOCKED handling (blocked bead: status `blocked`, notes, worktree kept, dependents skipped, no finish; rerunning resumes in the worktree). Commit each bead as `<bead title> (<bead-id>)`.
4. **Finish:** `next-task-finish` as a bead run (no epic to close; docs commit `Document <short summary> (<ids>)`).
5. **Watch CI:** as `next-task` step 8.

## Report

As in `next-task`: each bead with its commit hash, test results, findings filed, push result, CI result. If stopped early: which step, why, branch and worktree state.

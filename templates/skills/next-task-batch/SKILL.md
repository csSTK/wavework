---
name: next-task-batch
description: Implement several beads epics in one run. Orders them by their dependencies, then runs the full /next-task pipeline for each epic one after another (each in its own worktree, each pushed to {{baseBranch}} before the next starts), and watches CI once at the end. Use when the user says "next-task-batch <epic-id> <epic-id> ..." or asks to implement multiple epics.
---

# next-task-batch

A loop over `next-task`. **Model check first:** before any other step or tool call, check the session model. If it isn't {{orchestrationModelName}} (Model Policy in CLAUDE.md), stop, say so and suggest `/model {{models.orchestration}}`. Don't create branches or claim beads first.

**Input:** two or more epic IDs, optionally with the flag `--watch-ci` (`$ARGUMENTS`). Every epic's `next-task` run includes the whole-branch review before its push; an epic whose review leaves must-fix findings stops as in step 4. If any ID is missing or not an epic (`bd show`), stop and ask before starting anything; point to `/next-task-beads` for non-epic beads. Never add epics yourself.

**By invoking this skill the user authorizes** for each listed epic what `next-task` authorizes for one. Nothing more.

## Steps

1. **Check all epics up front:** run `next-task-plan` part 1 for every epic before starting the first one, so a broken bead late in the batch is found now. If any fails, stop and report all failures together.
2. **Order:** epics run **sequentially**, one finished and pushed before the next starts. That way each epic branches from a `{{baseBranch}}` that already contains the earlier ones, and conflicts can't pile up. Keep the user's order, except move an epic after any other listed epic it depends on (`bd dep list`, including dependencies of its children on the other epic's children). A dependency on an open epic that is not in the batch: that epic is skipped (see 4). Show the final order before starting.
3. **Run each epic:** follow `next-task` steps 1–7 for it (own worktree via `next-task-branch`, the **Red before green** check and the `next-task-review` loop after each child with its 3-round cap, findings, `next-task-finish`). Don't watch CI per epic.
   {{#if dashboard}}
   Record: `<BATCH-RUN>` = `batch.<first epic id in the final order>`. Right after `next-task-branch` creates the first epic's worktree, from that `<WT>`: `node tools/pipeline-dashboard/record.mjs run-start --run <BATCH-RUN> --kind batch --units <epic ids>` (no `--worktree`, so a cwd lookup never matches the batch run). Each epic's `run-start` adds `--parent <BATCH-RUN>`; its `run-end` for the batch is in `next-task-finish`.
   {{/if}}
4. **When an epic stops** (failed gate, blocked child, review still failing after 3 rounds, open must-fix findings of the branch review, conflict, unclear bead, rejected push): leave its branch and worktree as they are, mark it stopped, and also skip every later epic that depends on it. Continue with the independent ones. Never retry or resolve a stopped epic yourself.
5. **Watch CI once** after the last epic, only if at least one was pushed: with `--watch-ci` run `watch-ci` for `{{baseBranch}}`; without it ask once with AskUserQuestion ("Skip" first and default, "Watch CI" second).

## Report

A table: epic, status (pushed / stopped / skipped), children with commit hashes, findings filed. Then the test results per epic, for stopped ones the step, reason and worktree path, and the CI result or "CI not watched".

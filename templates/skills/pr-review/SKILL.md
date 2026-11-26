---
name: pr-review
description: Review, test and merge a GitHub pull request. Reviews the PR for bugs (and suggests fixes), rebases it if needed, runs the whole test suite, fixes test failures, posts a summary comment and merges only after the user confirms. Use it whenever the user asks to merge a pull request, in any words ("merge PR 12", "merge this PR", "can we merge #4", "land the PR"), or types /pr-review. Never merge a pull request without this skill.
---

# pr-review

**Input:** a PR number, PR URL or head branch name (`$ARGUMENTS`). None given: the open PR of the current branch (`gh pr view --json number`); none found: stop and ask for one. Never pick a PR yourself.

**By invoking this skill the user authorizes** for this PR: creating and deleting one worktree, committing fixes to the PR branch, pushing it (a force-push with lease only right after this skill rebased it), filing `finding` beads and posting **one** summary comment. **Merging is not authorized by the request itself**: merge only after the user picks a merge option in step 9 of this run. Never `gh pr merge --admin` or `--auto`, never bypass branch protection, never merge a PR whose checks fail{{#if noAttribution}}, never add attribution lines to commits or the comment (see CLAUDE.md){{/if}}.

**Keep your context small.** Run checks as `next-task-test` says ("Running a command": log to a file, read only the tail) and keep only the verdicts of sub-agent reports in your notes.

## Steps

1. **Preflight.**
   - `command -v gh` and `gh auth status`. Missing: stop with "Install the GitHub CLI (https://cli.github.com), then `! gh auth login`." Not logged in: stop with "Run `! gh auth login`."
   - `gh pr view <pr> --json number,title,url,body,state,isDraft,baseRefName,headRefName,headRefOid,isCrossRepository,maintainerCanModify,mergeable,mergeStateStatus,reviewDecision`.
   - `state` is not `OPEN`: stop and say so. `isDraft`: ask (AskUserQuestion) whether to continue anyway.
   - Read CLAUDE.md for the repository's branch and merge rules (e.g. which branch may merge into which, required merge method). A PR that breaks them (wrong base branch, wrong source): stop and say which rule. The usual base branch is `{{baseBranch}}`; another base is fine when CLAUDE.md allows it.
   - **Can you push?** Only when the head branch is in this repository (`isCrossRepository` false). For a fork, nothing is pushed: step 5 rebases only your local copy (to test it), and steps 4 and 7 never fix; the comment names the fixes and the rebase the PR needs.

2. **Worktree.** Find the main repo once: `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"` is `<MAIN>`; the worktree path `<WT>` is `<MAIN>`'s parent directory plus `/<MAIN's directory name>-pr-<n>` (`<n>` = PR number). Shell variables don't survive between Bash calls, so from here on write both as **literal paths** in every command. `git -C <MAIN> fetch origin <base>`, `git -C <MAIN> fetch origin pull/<n>/head`, then `git -C <MAIN> worktree add -B pr-review/<n> <WT> FETCH_HEAD`. If `<WT>` already exists: reuse it when it is clean and its `HEAD` is `headRefOid`, otherwise ask. Start every Bash command in the worktree with `cd <WT> &&`. Note `headRefOid` as `<old-head>`.

3. **Review for bugs.** Run `.claude/scripts/red-green-check.sh <WT> <fork-point>` with `<fork-point>` = `git merge-base origin/<base> HEAD` (not `origin/<base>`: before the rebase, its newer commits would count as the PR's changes), then run the **branch review** of `next-task-review` (the code lens plus every branch lens that applies, fresh read-only reviewers in parallel, same output format and merge) on `git diff -U10 origin/<base>...HEAD`, with these changes to the reviewer prompt:
   - Instead of a bead's acceptance criteria, the reviewers check the PR against its title and description (and the beads it names, `bd show <id>`, read-only), plus the open review comments (`gh pr view <n> --comments`, and `gh api repos/{owner}/{repo}/pulls/<n>/comments` for inline ones).
   - Each must-fix also carries a **suggested fix**: the concrete change (a short code snippet or exact edit), not just a direction.
   - Out-of-scope findings go to `next-task-findings` as usual.
   Merged verdict `PASS`: go on to step 5.

4. **Bugs found: suggest, then fix only on a yes.** Show the merged must-fix list, one item per finding: `file:line`, what is wrong, why, the suggested fix. Then AskUserQuestion:
   - "Apply the fixes" (only when you can push, step 1): an `implementer-{{models.implementers.default}}` sub-agent applies the `impl` items in `<WT>` (prompt: the worktree, the merged list, "fix only these, run `next-task-test` for the changed area, commit with a message that names the fixes, don't push"). Then review again (the code lens and every lens that said FIX). At most **2 fix rounds**; still must-fix after that: stop and report.
   - "Stop and post the findings": post them as the summary comment (step 8, verdict "Changes requested"), clean up (step 10) and stop.
   - "Stop without a comment": clean up and stop.
   `spec` items (the PR does the wrong thing, or a decision nobody made) are never fixed by an agent: list them and offer only the two stop options.

5. **Rebase if needed.** `git fetch origin <base>`, then `git merge-base --is-ancestor origin/<base> HEAD`: exit 0 means up to date, skip. Otherwise `git rebase origin/<base>` (if CLAUDE.md says to update branches by merging instead, merge `origin/<base>`). On a conflict, resolve it only when the intent of both sides is clear from the code, then `git rebase --continue` and say what you resolved; otherwise `git rebase --abort`, report the conflicting files and stop.

6. **Whole test suite.** Run it in a sub-agent (`implementer-{{models.implementers.default}}`; the logs never enter your context). Its prompt: the worktree and branch, "run every command under 'Whole test suite' of `.claude/skills/pr-review/SKILL.md` in its area's directory, regardless of what changed, as `.claude/skills/next-task-test/SKILL.md` says under 'Running a command', and apply the flaky rule of `.claude/skills/next-task-finish/SKILL.md` step 2; change no files, commit nothing", and the report format `Suite: PASS | FAIL | FLAKY`, per area the passed/failed counts, and per failing test its name, whether the PR touches it or the code it tests, and up to 10 error lines.

   `PASS`: go on. `FLAKY`: file each flaky test with `next-task-findings` (category `tests`), name it in the comment and go on. `FAIL`: step 7.

7. **Fix test failures.** For each failing test, first check whether it also fails on the base: run just that test in a temporary detached worktree of `origin/<base>` (remove it afterwards).
   - **Fails on the base too:** not this PR's bug. Don't fix it here; file it with `next-task-findings` (category `tests`), and say so in the comment and in the merge question.
   - **Caused by the PR** (or by the rebase): an `implementer-{{models.implementers.default}}` sub-agent fixes the root cause in `<WT>` (prompt: the worktree, the failing tests with their error lines, "fix the cause; never delete, skip or weaken a test or its assertion to make it pass, unless the PR intentionally changed that behaviour and the test still expects the old one; run `next-task-test` for the changed area; commit; don't push"). Review the fix with the code lens (one round), then rerun step 6.
   - At most **3 fix rounds** in total. Still failing: stop, don't push, report the failures and the worktree path. For a fork, never fix: report and stop.

8. **Push, wait for CI and comment.**
   - **Push**, only if you can push and the branch changed (fixes or a rebase): after a rebase `git push --force-with-lease=<headRef>:<old-head> origin HEAD:<headRef>`, otherwise `git push origin HEAD:<headRef>`. After every push, the commit you pushed becomes `<old-head>`, so a later push (a CI fix) leases against it. A rejected push means someone else pushed: stop and report, never force without the lease.
   - **CI:** wait for the PR's checks on the new head: `gh pr checks <n> --watch --fail-fast` in the background (`run_in_background`), not a foreground `sleep`. A failing check is a test failure: fix it as in step 7 (counts toward its 3 rounds) or stop. A PR without checks: say "no CI checks".
   - **Summary comment:** write the body to a file in the scratchpad and post it with `gh pr comment <n> --body-file <file>`. Content, short and factual:
     - **Review:** the lenses run, the verdict, each must-fix with how it was fixed (commit SHA) or that it is open, out-of-scope findings with their bead IDs.
     - **Rebase:** onto which `<base>` commit, conflicts resolved, or "up to date".
     - **Tests:** per area the full command and passed/failed counts, flaky tests (bead IDs), failures that also fail on the base (bead IDs), fix commits.
     - **CI:** the checks' result.
     - **Verdict:** "Ready to merge" or "Changes requested" with what is left.

9. **Ask before merging.** Only when the review passed, the suite passed (or only failed on tests that also fail on the base) and the checks are green. Re-read `gh pr view <n> --json mergeable,mergeStateStatus,reviewDecision,headRefOid`: when GitHub reports the PR as blocked (required reviews, required checks, conflicts), say why and stop; never use `--admin`. Read the allowed methods with `gh repo view --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed` and CLAUDE.md's rules for this base branch. Then AskUserQuestion with a one-paragraph summary (PR title, review verdict, test result, CI, anything still open) and the options: each allowed merge method (the one CLAUDE.md requires, or else the repository's usual one, first and marked "(Recommended)"), and "Don't merge". Only after the user picks a method: `gh pr merge <n> --<merge|squash|rebase> --match-head-commit <headRefOid>`. Delete the head branch only when the user asks. "Don't merge": leave the PR open.

10. **Clean up** from the main repo, not inside the worktree: `git -C <MAIN> worktree remove <WT>` (never `--force`) and `git -C <MAIN> branch -D pr-review/<n>` (only after a merge, a stop without unpushed work, or with nothing uncommitted; otherwise keep the worktree and name it in the report). After a merge, `git -C <MAIN> fetch origin <base>`.

## Whole test suite

The **Full** command of every area:

{{fullChecksList}}
{{#if hasE2e}}

Then every e2e command:

{{e2eList}}
{{/if}}

## Report

- PR number, title and URL, and whether it was merged (method, merge commit) or why not
- review: lenses run, must-fix found and fixed, open items
- rebase result, test result per area, fixes pushed (SHAs), CI result
- the comment's URL, filed finding beads, and the kept worktree path, if any

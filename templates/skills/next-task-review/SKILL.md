---
name: next-task-review
description: Review step after each child bead in /next-task, /next-task-beads and /next-task-batch. Fresh read-only reviewer sub-agents (never the implementer), one per applicable review lens (code always; security, UI, UX and others when they apply), run in parallel, review the child's diff against the bead's acceptance criteria and the CLAUDE.md rules, and return must-fix (impl or spec) vs out-of-scope findings, merged into one list. Normally invoked by those skills, not directly.
---

# next-task-review

Independent review of one child's work before it is committed. Each reviewer is a **fresh** implementer agent, never the one that implemented the child. It only reads and reports.

## Lenses

A review is split into **lenses**: each lens is one reviewer with one checklist, so no checklist gets lost in a long one. Pick the lenses that apply, then start their reviewers **in parallel** (one message, several Agent calls).

{{reviewLenses}}

- **Runs for:** per-bead lenses run in the review after each child; branch lenses run in the branch review of `next-task-finish`.
- **Runs when:** a path condition applies when a changed file of the diff starts with one of the prefixes. A text condition is your judgement on the diff; when in doubt, run the lens. "always" lenses always run.
- Name the lenses you start and the ones you skipped (one line, with the reason) in the run report.

## Input

- bead ID, worktree path `<WT>`, branch name
- the output of `.claude/scripts/red-green-check.sh <WT>` (run by the orchestrator; for the branch review: `... <WT> origin/{{baseBranch}}`)
- diff range: the child's uncommitted changes (`git diff HEAD` plus untracked files from `git status --short`) in `<WT>`; if already committed, `<base>..HEAD`

## Reviewer prompt

Give each reviewer: the input above, its lens name and checklist (from the table; for the code lens the list under "Code lens"), and these instructions.

0. Check `<WT>` and branch as in `next-task-implement` step 0. Start every Bash command with `cd <WT> &&`.
1. `bd show <id>` for the acceptance criteria. **Don't** claim or update the bead.
2. Read the diff first, with context: `git diff -U10 HEAD` (or `git diff -U10 <range>`). Read untracked files in full. Read more of a changed file only where the diff isn't enough to judge (callers of a changed function, the surrounding class, a test's fixtures), with line ranges or grep, not the whole file. Read the whole file when it is small or the change rewrites most of it. Read whatever your lens's checklist needs. Check only your lens; leave the other lenses' topics to their reviewers.
3. **Read-only:** no Edit/Write, no commits, no `git add`/`stash`/`checkout`, no `bd` writes, no test or build runs that change files. Re-checking with read-only commands is fine.

### Code lens

- every acceptance criterion is met and covered by a meaningful test
- would it pass on the old code: use the red-green script output (you can't run it read-only). Every `GREEN-ON-OLD` test is must-fix unless the bead is a stated exception (pure refactor/docs/config) or the implementer's report justifies it as a deliberate regression guard. `RED-COMPILE` is accepted. Exit code 2 or no output: ask the orchestrator for a rerun. `UNCHANGED` rows are untouched tests, ignore them. E2E specs are not covered; judge those from the diff (e.g. asserting only on mocks with no real outcome).
- CLAUDE.md Working Rules, Security, Architecture and Testing rules{{#if uiSkill}} (the UI lens covers the `{{uiSkill.name}}` skill in depth){{/if}}
{{#if codeMap}}
{{#if codeMap.folder}}
- Code Map entries in the module files under `{{codeMap.path}}/` match the added, moved or removed files: flag missing, stale or over-limit entries (a description over {{codeMap.maxDescription}} characters). Run `{{codeMap.checkCommand}}` (read-only) and report its violations
{{else}}
- Code Map entries in `{{codeMap.path}}` match the added, moved or removed files
{{/if}}
{{/if}}
- no scope creep, no secrets in code, logs or tests

## Output

At most ~150 words plus one line per finding. No summary of the diff, no praise, no restating the checklist.

```
Lens: <name>
Worktree: <path> / <branch>
Verdict: PASS | FIX
Must-fix:
- [impl|spec] <file:line> <what is wrong> / <why> / <expected fix>
Out-of-scope:
- <file:line> <what> / <why>
```

- **Must-fix** = a problem **within the child's scope** that blocks the commit: a criterion not met, a rule violation, a bug, a missing or meaningless test (including one that would also pass on the pre-change code). Be concrete; no style nitpicks. Each one is typed:
  - `impl`: the code or tests are wrong; the implementer can fix it within the bead as written.
  - `spec`: the bead itself is the problem: an acceptance criterion is wrong, missing, contradicts CLAUDE.md or another criterion, or needs a decision nobody made. The implementer can't fix that without guessing.
- **Out-of-scope** = problems outside the child's scope. The orchestrator records them via `next-task-findings`.
- `Verdict: PASS` only when Must-fix is empty. "None" for empty lists.

## Merge (the orchestrator's side)

When all reviewers of a round are back, merge their outputs into **one** list before acting: drop duplicates (same file:line and problem, keep the most concrete wording), keep each item's type and lens. The round's verdict is FIX if any lens says FIX. Keep only the merged list in your notes, not the raw reviewer outputs.

## Branch review (always)

Run by `next-task-finish` before the push, once per run. The code lens plus every branch lens that applies, in parallel, with the whole branch as input: diff `origin/{{baseBranch}}..HEAD` in `<WT>`, checked against the epic's (or all given beads') description and acceptance criteria as a whole. The code lens looks for gaps between children, inconsistent behaviour, missing wiring{{#if codeMap}}{{#if codeMap.folder}} or code map entries under `{{codeMap.path}}/`{{else}} or `{{codeMap.path}}` lines{{/if}}{{/if}}. Same checklists (including the red-green script output), same output format and the same merge. This is the biggest diff: read it as in step 2 (`git diff -U10 origin/{{baseBranch}}..HEAD`), with targeted reads only where it isn't enough. One fix round only, no 3-round loop (see `next-task-finish`).

## Loop (the orchestrator's side)

1. After the implementer reports and you verified its result, start the applicable lenses' reviewers and merge their outputs.
2. Out-of-scope items: `next-task-findings`.
3. **`spec` must-fix items** go back to planning, not to the implementer: stop that child uncommitted, `bd update <child> --status blocked --append-notes "spec: <each spec item>"`, and treat it like a BLOCKED child (`next-task` step 6: dependents skipped, independent children continue). The report tells the user to fix the bead (`/text-to-task` or `bd update`) and rerun, which resumes in the worktree. `impl` items found in the same round go into the notes too.
4. **`impl` must-fix items** (and no `spec` item): send the merged list to the **same implementer** (SendMessage; if it can't be reached, start a new implementer with the findings), then re-verify and review again. The next round runs the code lens and every lens that said FIX.
5. **Max 3 review rounds** per child. If the third review still has must-fix items, stop that child: don't commit, report the open findings with the worktree path and let the user decide.
6. Commit the child only after a PASS of every lens of the round.

{{#if dashboard}}
Record: `review --bead <id> --verdict <PASS|FIX> --mustFix <n> --round <n> --lenses <name,name>` once per round after the merge (merged verdict and must-fix count; branch review: `--bead branch`, with `step-start/step-end --step review` around it).
{{/if}}

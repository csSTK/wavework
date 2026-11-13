---
name: next-task-review
description: Review step after each child bead in /next-task, /next-task-beads and /next-task-batch. A fresh read-only implementer-{{models.implementers.default}} sub-agent (never the implementer) reviews the child's diff against the bead's acceptance criteria and the CLAUDE.md rules, and returns must-fix vs out-of-scope findings. Normally invoked by those skills, not directly.
---

# next-task-review

Independent review of one child's work before it is committed. The reviewer is a **fresh** `implementer-{{models.implementers.default}}` agent, never the one that implemented the child. It only reads and reports.

## Input

- bead ID, worktree path `<WT>`, branch name
- the output of `.claude/scripts/red-green-check.sh <WT>` (run by the orchestrator; for the branch review: `... <WT> origin/{{baseBranch}}`)
- diff range: the child's uncommitted changes (`git diff HEAD` plus untracked files from `git status --short`) in `<WT>`; if already committed, `<base>..HEAD`

## Reviewer prompt

Give the agent: the input above and these instructions.

0. Check `<WT>` and branch as in `next-task-implement` step 0. Start every Bash command with `cd <WT> &&`.
1. `bd show <id>` for the acceptance criteria. **Don't** claim or update the bead.
2. Read the diff and the changed files. Check:
   - every acceptance criterion is met and covered by a meaningful test
   - would it pass on the old code: use the red-green script output (you can't run it read-only). Every `GREEN-ON-OLD` test is must-fix unless the bead is a stated exception (pure refactor/docs/config) or the implementer's report justifies it as a deliberate regression guard. `RED-COMPILE` is accepted. Exit code 2 or no output: ask the orchestrator for a rerun. `UNCHANGED` rows are untouched tests, ignore them. E2E specs are not covered; judge those from the diff (e.g. asserting only on mocks with no real outcome).
   - CLAUDE.md Working Rules, Security, Architecture and Testing rules{{#if uiSkill}} (and the `{{uiSkill.name}}` skill for UI under {{uiPaths}}){{/if}}
   {{#if codeMap}}
   {{#if codeMap.folder}}
   - Code Map entries in the module files under `{{codeMap.path}}/` match the added, moved or removed files: flag missing, stale or over-limit entries (a description over {{codeMap.maxDescription}} characters). Run `{{codeMap.checkCommand}}` (read-only) and report its violations
   {{else}}
   - Code Map entries in `{{codeMap.path}}` match the added, moved or removed files
   {{/if}}
   {{/if}}
   - no scope creep, no secrets in code, logs or tests
3. **Read-only:** no Edit/Write, no commits, no `git add`/`stash`/`checkout`, no `bd` writes, no test or build runs that change files. Re-checking with read-only commands is fine.

## Output

```
Worktree: <path> / <branch>
Verdict: PASS | FIX
Must-fix:
- <file:line> <what is wrong> / <why> / <expected fix>
Out-of-scope:
- <file:line> <what> / <why>
```

- **Must-fix** = a criterion not met, a rule violation, a bug or a missing or meaningless test **within the child's scope**, including a test that would also pass on the pre-change code (step 2). Be concrete; no style nitpicks.
- **Out-of-scope** = problems outside the child's scope. The orchestrator records them via `next-task-findings`.
- `Verdict: PASS` only when Must-fix is empty. "None" for empty lists.

## Branch review (always)

Run by `next-task-finish` before the push, once per run. Same reviewer, but the input is the whole branch: diff `origin/{{baseBranch}}..HEAD` in `<WT>`, checked against the epic's (or all given beads') description and acceptance criteria as a whole: gaps between children, inconsistent behaviour, missing wiring{{#if codeMap}}{{#if codeMap.folder}} or code map entries under `{{codeMap.path}}/`{{else}} or `{{codeMap.path}}` lines{{/if}}{{/if}}. Same checklist (including the red-green script output) and same output format. One fix round only, no 3-round loop (see `next-task-finish`).

## Loop (the orchestrator's side)

1. After the implementer reports and you verified its result, start the reviewer.
2. Out-of-scope items: `next-task-findings`.
3. Must-fix items: send them to the **same implementer** (SendMessage; if it can't be reached, start a new implementer with the findings), then re-verify and review again.
4. **Max 3 review rounds** per child. If the third review still has Must-fix items, stop that child: don't commit, report the open findings with the worktree path and let the user decide.
5. Commit the child only after a PASS.

{{#if dashboard}}
Record: `review --bead <id> --verdict <PASS|FIX> --mustFix <n> --round <n>` after each review (branch review: `--bead branch`, with `step-start/step-end --step review` around it).
{{/if}}

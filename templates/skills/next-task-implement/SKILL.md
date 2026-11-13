---
name: next-task-implement
description: The sequence an implementer sub-agent follows for one beads child task during /next-task. Check worktree, understand, write tests, code, e2e, run focused tests, report. Each step is its own skill. Read by {{implementerAgentsPlain}}.
---

# next-task-implement

You implement exactly one child bead. You don't plan, redesign or widen the scope. Read each step's skill (`.claude/skills/<name>/SKILL.md`) and follow it in order.

0. **Check the worktree.** Your prompt names a worktree path and a branch. Work only there: start every Bash command with `cd <worktree> &&`, use absolute paths under it for Read/Edit/Write, and never run `git switch`/`checkout`.
   - Run `cd <worktree> && git rev-parse --show-toplevel && git branch --show-current`. If either doesn't match the prompt, **stop** and report it. Don't write anything.
   - Repeat this check right before reporting back.
1. **Understand.**
   - `bd show <id>`, then `bd update <id> --claim`.
   {{#if codeMap}}
   {{#if codeMap.folder}}
   - Read `{{codeMap.indexPath}}` (path prefix to module file), then grep or read only the module file that covers your path to find the files (don't read the other module files). Only read code where the map isn't enough.
   {{else}}
   - Grep `{{codeMap.path}}` to find the files (don't read it whole). Only read code where the map isn't enough.
   {{/if}}
   {{else}}
   - Search the code for the files the bead names or implies. Read only what you need.
   {{/if}}
   - If the acceptance criteria are unclear or contradict CLAUDE.md, stop and report. Don't guess.
2. **Write tests:** `next-task-write-tests`. The tests must fail first.
3. **Implement:** `next-task-code`. Makes the tests pass{{#if codeMap}}{{#if codeMap.folder}} and updates your lines in the module file{{else}} and updates your `{{codeMap.path}}` lines{{/if}}{{/if}}.
4. **E2E:** `next-task-e2e`. Adds or extends specs for the user-visible flow, or reports n/a.
5. **Run focused tests:** `next-task-test`. The checks of your area, plus lint, type checks and e2e where configured. Everything must pass.
   - **Retry cap:** count every focused run (`next-task-test`) of this bead that fails after you changed code. After the **3rd failed run**, stop. Don't weaken tests, don't try a 4th time. Step 6 then reports BLOCKED.
6. **Report back. You're finished.** Don't commit, push or close the bead. Leave your changes uncommitted in the worktree. If blocked (retry cap, or a stop from steps 0–3), report **BLOCKED** instead of the success report: the reason, the failing command and the last ~40 lines of its failing output, the files changed so far, and findings. Otherwise report:
   - the worktree check result (path and branch)
   - the files changed
   - the criterion → test mapping
   - **Red before green:** the failing run captured in step 2 (test name + assertion line per test), or the stated exception (pure refactor, docs, config; with reason). A report without this section is incomplete. The orchestrator re-checks it with `.claude/scripts/red-green-check.sh`; a test that passes on the old code must be justified here (e.g. deliberate regression guard)
   - the exact test commands and results
   - the e2e status
   - each acceptance criterion: met or not
   - **Findings:** bugs or code-quality problems you noticed outside your bead's scope (file:line, what, why). Don't fix them and don't file beads; the orchestrator records them via `next-task-findings`. "None" if none.

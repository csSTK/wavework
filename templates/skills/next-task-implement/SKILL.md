---
name: next-task-implement
description: The sequence an implementer sub-agent follows for one beads child task during /next-task. Check worktree, understand, write tests, code, e2e, run focused tests, report. Each step is its own skill. Read by {{implementerAgentsPlain}}.
---

# next-task-implement

You implement exactly one child bead. You don't plan, redesign or widen the scope. Read each step's skill (`.claude/skills/<name>/SKILL.md`) and follow it in order.
{{#if dashboard}}

Record: at the start of steps 2–5, `cd <worktree> && node .claude/wavework/dashboard/record.mjs agent-step --bead <id> --skill <step skill> 2>/dev/null || true` (e.g. `--skill next-task-write-tests`), so the dashboard shows which step you are in. Fire-and-forget: never wait on or react to it.
{{/if}}

0. **Check the worktree.** Your prompt names a worktree path and a branch. Work only there: start every Bash command with `cd <worktree> &&`, use absolute paths under it for Read/Edit/Write, and never run `git switch`/`checkout`.
   - Run `cd <worktree> && git rev-parse --show-toplevel && git branch --show-current`. If either doesn't match the prompt, **stop** and report it. Don't write anything.
   - Repeat this check right before reporting back.
   - **The worktree is shared** with the other implementers of your wave. Never run `git stash`, `git reset`, `git checkout -- <file>`, `git clean` or anything else that touches files outside your file set, and never stop processes you didn't start yourself: no `pkill`/`pgrep`/`killall` by name or pattern, since other agents' test runs match the same pattern. Wait for and stop only your own commands, as `next-task-test` says.
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
   - **Root cause before each retry:** after a failed run, before you change code again, write one line: the root cause read from the failing output (the failing test or error, and why it fails) and the fix you will make. No retry without this line. If two consecutive failed runs show the same root cause, change the approach; don't repeat the same fix.
6. **Report back. You're finished.** Don't commit, push or close the bead. Leave your changes uncommitted in the worktree. The orchestrator keeps every report in its context for the whole run, so report **exactly in this format, nothing else**: one line per field, no narrative, no diff, no logs beyond the BLOCKED tail.

   ```
   Result: DONE | BLOCKED <reason>
   Worktree: <path> / <branch> (checked)
   Files: <path>, <path>, ...
   Criteria: <criterion short> -> <test name> (met|not met); ...
   Red before green: <test name>: <failing assertion line>; ... | exception: <refactor|docs|config> (<reason>)
   Tests: <command> -> <passed>/<failed>; ...
   E2E: <spec files> -> <passed>/<failed> | n/a (<reason>)
   Findings: <file:line> <what> / <why>; ... | none
   ```

   - **Red before green** is required. The orchestrator re-checks it with `.claude/scripts/red-green-check.sh`; a test that passes on the old code must be justified here (e.g. deliberate regression guard).
   - **Findings** are bugs or code-quality problems you noticed outside your bead's scope. Don't fix them and don't file beads; the orchestrator records them via `next-task-findings`.
   - **BLOCKED** (retry cap, or a stop from steps 0–3) adds, below the block: the failing command, the root-cause line of each failed run and the last ~40 lines of the failing output.

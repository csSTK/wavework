---
name: next-task-findings
description: Writes problems found outside the scope of the current task into the shared backlog as beads labelled `finding`, deduplicated and grouped under a few standing "Findings: <category>" epics so each epic can be run with /next-task. Used by the /next-task orchestrators after each child and before finishing; also usable on its own.
---

# next-task-findings

The shared backlog for findings is **beads with the label `finding`** (synced via Dolt, so every session and machine sees them). Not a markdown file: CLAUDE.md requires beads for all tracking. `BACKLOG.md` stays the list of Portainer features.

Findings are not loose beads. Each one is a **child of a category epic**, with a `model:` label and acceptance criteria, so `/next-task <findings-epic>` can run the whole group without further planning.

**Input:** the findings to record, each with a file/line, what is wrong and why it matters, and the bead it was discovered in (`<source-id>`). Sources:
- the "Findings" section of an implementer report
- the reviewer's "Out-of-scope" list
- your own review of the child's diff (`git diff` in the worktree) during verification

## What counts

- Something wrong or worth improving that is **outside the current bead's acceptance criteria**. A defect in the bead's own scope is not a finding: send it back to the implementer.
- Concrete and verifiable: a file, a scenario, a reason. No vague "could be cleaner".
- There is no per-run limit. The grouping into epics keeps the backlog workable.

## Categories

Two classes, four category epics. Pick exactly one category per finding.

| Class | Category | Slug | Typical content |
|---|---|---|---|
| Real | Security & authorization | `security` | auth, permission, token, egress, path, subprocess, secret handling, missing re-authorization |
| Real | Bugs & correctness | `bugs` | wrong behaviour, data loss, races, broken UX flows |
| Quality | Tests & CI stability | `tests` | flaky tests, missing malicious-case or edge tests, CI gaps |
| Quality | Code quality, UI & docs | `quality` | duplication, dead code, naming, design-system gaps, stale docs |

**Category epics are standing and never closed**, even when all children are done (no `bd close`, no `bd epic close-eligible` on them). One open epic per category.

Class "Real" = a bug, security issue, data-loss risk or CLAUDE.md rule violation. Everything else is "Quality". Quality items are never priority 1 or 2.

## Steps

1. **Deduplicate:** `bd search "<key words>"` and `bd list --label finding --status open`. If an open bead already covers it, add a note instead: `bd update <id> --notes "Seen again in <source-id>: <one line>"`.
2. **Find or create the category epic.** `bd list --type epic --status open --label fcat:<slug>`. Always use that one, even while it is being run: never create a second epic for the same category. If there is none at all, create it:

   ```bash
   bd create --type=epic --priority=<2 for security/bugs, 3 for tests/quality> \
     --title="Findings: <Category name>" --labels fcat:<slug> \
     --description="Standing backlog of <category> findings. Run with /next-task <id>." \
     --acceptance="All child findings closed or consciously dropped."
   ```
3. **File the finding under it:**

   ```bash
   bd create --title="<short claim>" --type=<bug|chore> --priority=<0-4> \
     --labels finding,model:<haiku|sonnet> \
     --parent <epic-id> \
     --deps discovered-from:<source-id> \
     --description="<file:line>. <what happens, concrete scenario>. <why it matters>." \
     --acceptance="<testable: how we know it's fixed, including the test that proves it>"
   ```

   - `bug` for wrong behaviour, `chore` for quality. Priority: 1 security or data loss, 2 user-visible bug, 3 quality, 4 nice to have.
   - `model:` by the Model Policy in CLAUDE.md: `haiku` for small, well-specified, low-risk fixes; `sonnet` for everything else and anything touching auth, permissions, remote host access or the audit log. When unsure, `sonnet`.
   - The description and criteria must be enough to run without a planning session. If a finding needs a design decision (an open question), don't file a runnable child: say so in the description and leave out the `model:` label so `next-task-plan` stops on it.
4. **Don't fix it here** and don't widen the running task. Findings never block the run, except priority 1: report those to the user at once.

## Report

One line per finding: bead ID (or the existing one it was added to), epic, priority, title.

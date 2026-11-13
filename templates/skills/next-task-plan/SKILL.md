---
name: next-task-plan
description: Steps 2 and 4 of /next-task and /next-task-beads. Validates the beads of a work set (an epic's children or a list of beads), then plans the implementation as parallel waves with a model and file set per child task, plus the hand-off prompt for implementer sub-agents. Normally invoked by the next-task skill, not directly.
---

# next-task-plan

The **work set** is either an epic's children (`/next-task`) or the beads passed to `/next-task-beads`. Below, "child" means a bead of the work set and "inside the set" replaces "inside the epic".

## Part 1: Check the beads tasks

1. Epic run: `bd show <epic>` must be an epic that's `open` or `in_progress`, and `bd list --parent <epic>` lists the children. Bead run: each given ID must exist and must not be an epic (point to `/next-task` for those).
2. Ignore beads that are already `closed`. On a rerun, `blocked` children count as open: re-plan them and reclaim each with `bd update <id> --status in_progress` before handing it off.
3. For each open child, `bd show <child>` must have:
   - a clear description and testable acceptance criteria
   - a {{modelLabelsOr}} label
   - no unresolved open decision

   If any child fails this, **stop** and tell the user which child and what's missing. Suggest `/text-to-task` to fix it. Don't patch the beads yourself.
4. Blockers outside the set, from `bd dep list <child>`: if a child depends on an issue outside the set that's still open, **stop** and report it.
5. If no open children are left, skip straight to `next-task-finish`. Its job is then only to close the epic (bead run: report that nothing is left and remove the empty worktree).

## Part 2: Plan the implementation

{{#if codeMap}}
{{#if codeMap.folder}}
Read `{{codeMap.indexPath}}` and grep or read only the module files that cover the paths named in each child (not the whole folder), plus those paths, to work out the **file set** each child will touch. Only read code where the map isn't enough.
{{else}}
Grep `{{codeMap.path}}` (read only the parts you need), plus the paths named in each child, to work out the **file set** each child will touch. Only read code where the map isn't enough.
{{/if}}
{{else}}
Search the code for the paths named in each child to work out the **file set** each child will touch. Read only what you need.
{{/if}}

Build **waves**:
- Wave 1 holds the children with no open dependencies inside the epic. The next wave holds the children whose dependencies are all in earlier waves. Continue the same way.
- Children in the same wave run in parallel only if their file sets don't overlap. Shared files count as overlapping: build and dependency manifests (lockfiles included), shared configuration, `CLAUDE.md`, `README.md`. If two overlap, move one into the next wave.
  {{#if codeMap}}
  {{#if codeMap.folder}}
  - Exception: Code Map lines in the module files under `{{codeMap.path}}/` (`index.md` changes only when a module file is added or removed). Tell parallel agents to edit only their own lines; you resolve conflicts while committing.
  {{else}}
  - Exception: Code Map lines in `{{codeMap.path}}`. Tell parallel agents to edit only their own lines; you resolve conflicts while committing.
  {{/if}}
  {{/if}}

Show the plan to the user as a short table: wave, child, model, file set, plus the worktree path. Then continue without waiting, unless the plan surfaced a problem.

## Hand-off prompt (one per child)

Use the agent matching the label ({{implementerAgentsOr}}) and send this prompt:

```
Implement bead <child-id> in worktree <absolute worktree path> on branch <branch>. Work only there: start every Bash command with `cd <worktree> &&`, use absolute paths under it, never switch branches. Follow .claude/skills/next-task-implement/SKILL.md exactly.
Your file set: <paths>. Other agents are working in parallel on: <other children's paths>. Don't touch those.
Do not commit, push or close the bead. Report back as that skill describes, including out-of-scope findings.
```

{{#if dashboard}}
Record: `child-start` (see `next-task` step 5) is written by the orchestrator when it sends this prompt.
{{/if}}

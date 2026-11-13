---
name: next-task-code
description: Implement a beads task until its (already written) tests pass, within the assigned file set and the CLAUDE.md architecture and security rules. Used by implementer sub-agents in /next-task.
---

# next-task-code

Write the production code that makes the tests from `next-task-write-tests` pass.

- **Stay in your file set.** If you need to change a file outside it, stop and report why. Don't just change it.
- **Follow CLAUDE.md:** its architecture, security and code-style rules apply to every line you write. If a rule and the bead disagree, stop and report. Don't guess.
{{#if uiSkill}}
- **UI changes** (under {{uiPaths}}): read `.claude/skills/{{uiSkill.name}}/SKILL.md` first and apply it. Add no new UI library unless the bead names it.
{{/if}}
- **Match the surrounding code style**, naming and comment density. No speculative abstractions, flags or configuration the bead doesn't ask for.
- **Don't weaken tests to get green.** If a test turns out to be wrong, fix it and say why in the report.
- **Out-of-scope work** you discover goes into a new bead (`bd create`, then `bd dep add`). Don't do it.
{{#if codeMap}}
{{#if codeMap.folder}}
- **Update the Code Map** in the same change, in the module file under `{{codeMap.path}}/` that covers your files (find it in `{{codeMap.indexPath}}`): only your own files' lines, one line each (`- path: what it is`), at most {{codeMap.maxDescription}} characters, no bead IDs, no history. A new module file must be linked from the index.
{{else}}
- **Update the Code Map** in `{{codeMap.path}}`, only your own files' lines, one short line each: `path: what it is`.
{{/if}}
{{/if}}

**Done when** the new tests and the existing tests in the area pass (`next-task-test`, focused). If they still fail after 3 failed focused runs, stop and report BLOCKED (see `next-task-implement`).

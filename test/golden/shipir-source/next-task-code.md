---
name: next-task-code
description: Implement a beads task until its (already written) tests pass, within the assigned file set and the CLAUDE.md architecture and security rules. Used by implementer sub-agents in /next-task.
---

# next-task-code

Write the production code that makes the tests from `next-task-write-tests` pass.

- **Stay in your file set.** If you need to change a file outside it, stop and report why. Don't just change it.
- **Follow CLAUDE.md:**
  - package-by-feature, and the dependency direction (`docker/` knows no other feature)
  - never pass docker-java types outward
  - DTOs are built in the service layer
  - `ProcessBuilder` with an argument list, never a shell
  - all file access goes through `PathValidationUtil`
  - no secrets in logs
  - Flyway owns the schema
- **Frontend UI** (components, styles, interactions): read `.claude/skills/apple-design/SKILL.md` first and apply it. Skip its "Initial Response" section; that's meant for interactive chats. Add no new UI library unless the bead names it.
- **No database writes** outside Testcontainers (see Database Access in CLAUDE.md). If the task needs one, e.g. running the app against the dev database, stop and report it. Don't attempt it.
- **Match the surrounding code style**, naming and comment density. No speculative abstractions, flags or configuration the bead doesn't ask for.
- **Don't weaken tests to get green.** If a test turns out to be wrong, fix it and say why in the report.
- **Out-of-scope work** you discover goes into a new bead (`bd create`, then `bd dep add`). Don't do it.
- **Update the Code Map** in `docs/CODE_MAP.md`, only your own files' lines, one short line each: `path: what it is`.

**Done when** the new tests and the existing tests in the area pass (`next-task-test`, focused). If they still fail after 3 failed focused runs, stop and report BLOCKED (see `next-task-implement`).

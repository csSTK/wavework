---
name: next-task-write-tests
description: Write failing tests from a beads task's acceptance criteria before implementing (test-first). Backend JUnit 5 / Testcontainers, frontend Vitest / Testing Library. Used by implementer sub-agents in /next-task; also usable on its own for any bead.
---

# next-task-write-tests

Turn every acceptance criterion of the bead into at least one test that **fails now**. Don't write production code in this step. The only exception is the minimum stub needed to compile, such as an empty method or class.

**Backend** (`backend/src/test/java/dev/bethge/shipir/<feature>/`):
- JUnit 5. One test class per class under test: `<ClassName>Test`.
- Anything touching the database or Docker uses Testcontainers through the shared test baseline. Don't start ad-hoc containers.
- Use Mockito only at module boundaries, such as the `docker/` port interfaces. Don't mock the class under test or the JPA layer.
- Security-relevant code always gets tests for the malicious cases:
  - path traversal: `../`, absolute paths, symlinks, URL-encoded variants
  - command or argument injection
  - missing or insufficient permissions

**Frontend** (`frontend/src/...`, test file next to the code as `<name>.test.ts(x)`):
- Vitest with Testing Library. Test behavior as a user sees it: roles, labels, text. Don't test implementation details.
- Mock the network at the `apiFetch` boundary. Don't mock React Query.

**Naming:** test names state the behavior, e.g. `rejectsPathOutsideBaseDirectory` or `shows error when start fails`.

**Done when:**
- every acceptance criterion maps to at least one test
- the new tests compile
- running them (`next-task-test`) shows them **failing for the expected reason**: an assertion or a missing behavior, not a typo or a setup error

**Red before green:** capture that failing run before coding: per new/changed test the test name and the failing assertion line (or error message). Only exception: pure refactor, docs-only or config-only beads, where the report states the exception and why no test can fail first. No silent skipping. The orchestrator verifies this mechanically with `.claude/scripts/red-green-check.sh` (runs your tests against the pre-change code), so a test that is green before the change will be flagged.

List the criterion → test mapping and the red evidence in your report.

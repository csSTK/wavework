---
name: next-task-write-tests
description: Write failing tests from a beads task's acceptance criteria before implementing (test-first). Follows each area's existing test framework. Used by implementer sub-agents in /next-task; also usable on its own for any bead.
---

# next-task-write-tests

Turn every acceptance criterion of the bead into at least one test that **fails now**. Don't write production code in this step. The only exception is the minimum stub needed to compile, such as an empty method or class.

The project's test conventions (frameworks, fixtures, mocking boundaries) are in CLAUDE.md; follow them.

**Backend and library code:**
- Use the area's existing test framework and layout; read neighbouring tests first. One test class or file per unit under test, named after it.
- Anything touching a database or other external service uses the project's shared test setup. Don't start ad-hoc infrastructure.
- Mock only at module boundaries. Don't mock the unit under test or the persistence layer.
- Security-relevant code always gets tests for the malicious cases:
  - path traversal: `../`, absolute paths, symlinks, URL-encoded variants
  - command or argument injection
  - missing or insufficient permissions

**UI code** (test file next to the code):
- Test behavior as a user sees it: roles, labels, text. Don't test implementation details.
- Mock the network at the API boundary. Don't mock the data-fetching library.

**Naming:** test names state the behavior, e.g. `rejectsPathOutsideBaseDirectory` or `shows error when start fails`.

**Done when:**
- every acceptance criterion maps to at least one test
- the new tests compile
- running them (`next-task-test`) shows them **failing for the expected reason**: an assertion or a missing behavior, not a typo or a setup error

**Red before green:** capture that failing run before coding: per new/changed test the test name and the failing assertion line (or error message). Only exception: pure refactor, docs-only or config-only beads, where the report states the exception and why no test can fail first. No silent skipping. The orchestrator verifies this mechanically with `.claude/scripts/red-green-check.sh` (runs your tests against the pre-change code), so a test that is green before the change will be flagged.

List the criterion → test mapping and the red evidence in your report.

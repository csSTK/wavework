---
name: next-task-e2e
description: Add or extend browser e2e tests for the user-visible flow of a beads task and run them. Used by implementer sub-agents in /next-task; also usable on its own.
---

# next-task-e2e

**Applies when** the task changes something a user can see or do in the UI. Backend-only and tooling tasks report `e2e: n/a (<reason>)`.

{{#if hasE2e}}
**If the e2e setup doesn't exist yet** (the area's e2e command can't run because the framework isn't set up), report `e2e: n/a (no e2e setup)`. Never set up the framework as part of another task.

## Conventions

The project's e2e conventions (fixtures, API mocking helper, ports) are in CLAUDE.md; follow them.

- **Tool:** the e2e framework the area already uses (see the commands below). Specs live next to the existing ones, one spec per feature flow: `<feature>.spec.ts`, e.g. `containers.spec.ts`.
- **Target:** the frontend with the backend API mocked at the network level, using the project's shared fixtures. An API call without a mock fails the test.
- **Scope:** test the user journey (open the page, act, see the result), including at least one error path. Leave edge cases to unit tests.
- **Selectors:** use roles, labels and text (`getByRole`, `getByLabel`). Use `data-testid` only when nothing semantic exists. Never use CSS or XPath structure.
- **No sleeps.** Rely on the framework's auto-waiting and web-first assertions (`await expect(...)`).

## Run

Commands per area:

{{e2eList}}

- Focused: the area's e2e command followed by the spec file
- Full: the area's e2e command as listed

Report the spec files added or changed and the pass/fail counts.
{{else}}
No area configures an e2e command, so there is no e2e setup. Report `e2e: n/a (no e2e setup)`. Never set up a framework as part of another task.
{{/if}}

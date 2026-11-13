---
name: text-to-task
description: Turn a free-text feature request, idea or bug description into beads tasks — one epic per request with child tasks that carry the implementation. First checks whether the text is scoped well enough; if not, asks the user targeted questions instead of creating vague tasks. Use when the user wants to plan work, create tasks/beads/issues from a description, or says "text-to-task".
---

# text-to-task

Turn the user's text into an epic with implementable child tasks in beads (`bd`). This is planning work: per the Model Policy in CLAUDE.md it belongs on Opus. If the session isn't on Opus, say so and suggest `/model opus` before continuing. Never implement anything here.

Input: the text after the command (`$ARGUMENTS`), or the user's latest message if that's empty.

## 1. Gather context (cheap, targeted)

- Read CLAUDE.md: Working Rules, Model Policy, Architecture, Security, Database & Flyway. Grep `docs/CODE_MAP.md` to find affected files; only open code if the map isn't enough.
- Read the open decisions in HANDOFF.md.
- Run `bd list --status open` and check for existing epics/tasks that already cover the request. Extend or reference them instead of creating duplicates.

## 2. Scope check — decide before creating anything

The text is **scoped enough** only if you can answer all of these without guessing:

1. **Goal:** what observable outcome is wanted, and for whom (role: ADMIN/OPERATOR/VIEWER)?
2. **Boundaries:** what is in and out of this request?
3. **Placement:** which feature module(s) (`docker/`, `host/`, `compose/`, …) and which layer (backend, frontend, both)?
4. **Acceptance:** can you write concrete, testable acceptance criteria for every child task?
5. **Decisions:** does it depend on an open decision from HANDOFF.md or something CLAUDE.md doesn't settle (e.g. JWT vs. session, data model choices)? Open decisions are never guessed.
6. **Conflicts:** does it contradict CLAUDE.md (out-of-scope items, security rules, architecture rules)?

If any answer is missing:
- **Do not create beads** for the unclear parts.
- Ask the user with AskUserQuestion: at most 4 specific questions, each with concrete options and your recommendation first. Never ask what CLAUDE.md, HANDOFF.md or the code already answers.
- If parts of the text are clear and independent of the open questions, say which ones and offer to create those now.
- If the text conflicts with CLAUDE.md, name the conflict and ask; don't silently adapt it.

Once the answers are in, re-run the check, then continue.

## 3. Break it down

**One epic per request** (`-t epic`): the "what and why". Description holds the goal, scope (in/out) and any decisions made during the scope check. Acceptance criteria describe the user-visible result. The epic carries no implementation itself.

**Child tasks** (`--parent <epic>`, `-t task`, or `-t bug` for defects) carry all the implementation. Each child must:
- Be completable by one implementer agent in one session: one coherent change, typically one module and layer. Split backend and frontend into separate children.
- Include its own tests (unit and/or Testcontainers integration) in the acceptance criteria. No separate "write tests" tasks.
- Name the files or packages to touch, taken from the Code Map or the architecture tree (for new files: the intended path).
- Have testable acceptance criteria as a bullet list.
- Carry a model label per the Model Policy: `model:haiku` for small, well-specified, low-risk changes; `model:sonnet` for everything else and **always** for auth, permissions, remote host access, audit, subprocess execution, path handling and streaming.
- For frontend UI children: name `apple-design` in the description and add an acceptance criterion such as "UI follows the apple-design skill: instant press feedback, reduced-motion handled, consistent typography and spacing". If the work needs a new library (e.g. `motion` for springs), say so explicitly in the child.
- Respect the build order in HANDOFF.md and the architecture rules (e.g. a Flyway migration is its own child, ahead of the entity/repository that needs it).

Wire ordering with dependencies between children (`bd dep add <later> <earlier>`) only where one truly needs the other first, so independent children stay parallelizable in `bd ready`.

Priority: inherit from the request (default P2). Use P1 only when the user says it's urgent or it blocks other work.

## 4. Create

Create the epic first, then the children, capturing IDs with `--silent`:

```bash
EPIC=$(bd create "<epic title>" -t epic -p 2 --silent \
  -d "<goal, scope in/out, decisions>" \
  --acceptance "<user-visible result>")

T1=$(bd create "<child title>" -t task -p 2 --parent "$EPIC" -l model:sonnet --silent \
  -d "<what and where: files/packages>" \
  --acceptance "- <criterion>
- <tests that must exist and pass>")

bd dep add "$T2" "$T1"   # only if T2 really needs T1 first
```

Titles: imperative and specific ("Add Flyway migration V2__create_docker_hosts", not "Hosts DB stuff").

## 5. Report

Keep it short. Show the tree (`bd list --parent <epic> --pretty`), mention any assumptions you made, list anything you deliberately left out or deferred, and name which children are ready to start. Do not commit; `.beads/issues.jsonl` is exported automatically.

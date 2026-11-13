---
name: next-task-deps
description: Step 3 of /next-task. Installs backend and frontend dependencies and applies safe (non-major) updates as a separate, verified commit. Normally invoked by the next-task skill, not directly.
---

# next-task-deps

The goal is a working install with current patch and minor versions, without mixing dependency churn into feature commits or taking on breaking upgrades unannounced.

## Frontend (`frontend/`, only if it exists)

1. `pnpm install --frozen-lockfile` checks that the lockfile matches `package.json`.
   - If it fails, run `pnpm install` and include the lockfile in the update commit.
2. `pnpm update` updates within the semver ranges in `package.json`. Never use `--latest`.
3. `pnpm outdated` shows what's left: major versions not taken.

## Backend (`backend/`, only if it exists)

1. Install and compile: `./backend/mvnw -f backend/pom.xml -q dependency:resolve test-compile`.
2. Report available updates: `./backend/mvnw -f backend/pom.xml -q versions:display-dependency-updates versions:display-plugin-updates`.
   - Apply only patch and minor bumps of versions pinned directly in `pom.xml`.
   - Leave versions managed by the Spring Boot parent alone. Bumping the parent itself, including a minor bump, is a separate decision.

## Verify and commit

- If anything changed, run the full checks once:
  - `pnpm lint && pnpm test && pnpm build` in `frontend/`
  - `./backend/mvnw -f backend/pom.xml verify`
- If they pass, commit only the dependency files (`package.json`, `pnpm-lock.yaml`, `pom.xml`) as `Update dependencies (patch/minor)`.
- If they fail, revert the updates (`git checkout -- <files>`), keep the plain install, and mention it in the report.
- **Major updates** and Spring Boot parent bumps are listed in the report, never applied here. Offer to file a bead for them.

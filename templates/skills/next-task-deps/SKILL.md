---
name: next-task-deps
description: Step 3 of /next-task. Installs the dependencies of every area and applies safe (non-major) updates as a separate, verified commit. Normally invoked by the next-task skill, not directly.
---

# next-task-deps

The goal is a working install with current patch and minor versions, without mixing dependency churn into feature commits or taking on breaking upgrades unannounced.

## Areas

{{depsSection}}

CLAUDE.md gives the project's dependency-update commands and what to leave alone; follow it.

For each area that exists, with the project's own package manager:

1. Install exactly what the lockfile says (frozen or locked mode where the tool has one).
   - If the lockfile is out of date, run a normal install and include the lockfile in the update commit.
2. Update within the version ranges the manifest already declares. Never use a "latest" or major-bumping flag.
3. List what is still outdated: major versions not taken.
   - Apply only patch and minor bumps of versions pinned directly in the project's manifests.
   - Leave versions managed by a framework parent or BOM alone. Bumping that itself, including a minor bump, is a separate decision.

## Verify and commit

- If anything changed, run the full checks once:
  {{fullChecksList}}
- If they pass, commit only the dependency files (manifests and lockfiles) as `Update dependencies (patch/minor)`.
- If they fail, revert the updates (`git checkout -- <files>`), keep the plain install, and mention it in the report.
- **Major updates** and framework parent bumps are listed in the report, never applied here. Offer to file a bead for them.

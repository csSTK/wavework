---
name: watch-ci
description: Watch the GitHub Actions run(s) for the current commit, branch or a given run ID and report the result, with the failing job, step and error tail on failure. Read-only. Use when the user says "watch ci", "check ci", "did the build pass" or /watch-ci.
---

# watch-ci

Argument (optional): a numeric run ID or a branch name. Default: the runs for `HEAD` on the current branch.

**Read-only.** Only `gh auth status`, `gh run list`, `gh run view` and `gh run watch` are used. Never re-run or cancel runs, edit code, commit or push. A bead is filed only after the user says yes.

## 1. Preflight

- `command -v gh`. If missing, stop: "gh is not installed. Run `brew install gh`, then `! gh auth login`."
- `gh auth status`. If not authenticated, stop: "gh is not logged in. Run `! gh auth login`."

## 2. Resolve the target

- Numeric argument: that run ID.
- Branch name argument: `gh run list --branch <name> --limit 5 --json databaseId,workflowName,status,conclusion,url,headSha`, take the newest run(s).
- No argument: `sha=$(git rev-parse HEAD)`, then `gh run list --commit "$sha" --json databaseId,workflowName,status,conclusion,url`.
  - No runs yet (just pushed): retry up to 5 times, ~10 seconds apart, using a background command or Monitor, not a foreground `sleep`.
  - Still none: say so. Also check whether HEAD is pushed (`git branch -r --contains "$sha"`); if not, say "HEAD is not pushed, so no run exists." Pull requests only start runs on the PR head commit.

## 3. Watch

- Completed runs need no waiting.
- For every `queued` or `in_progress` run (matrix jobs and several workflows included), run `gh run watch <id> --exit-status` in the background (`run_in_background`) or via Monitor, so the session is not blocked. Never use a foreground `sleep`. Wait for all runs.

## 4. Report

Per run: workflow, conclusion, duration (`gh run view <id> --json workflowName,conclusion,startedAt,updatedAt,url,jobs`), URL.

On failure: `gh run view <id> --log-failed`, then show only the failing job, the failing step and the relevant error lines (the tail, not the full log). Redact anything that looks like a secret, token or password.

## 5. On failure: offer a bug bead

Ask the user (AskUserQuestion) whether to file a bug bead. Only on yes:

`bd create -t bug` with the run URL, failing job and step, and the log excerpt in the description.

Then stop. Do not fix, re-run or push.

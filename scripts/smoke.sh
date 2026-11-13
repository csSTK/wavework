#!/usr/bin/env bash
# Smoke run of the packed wavework CLI, as a consumer repository would use it.
#
# Packs the package, installs the tarball into two throwaway git repositories and runs the
# commands that README.md documents, checking exit codes and the files they write. Used by the
# CI "smoke" job and locally (`bash scripts/smoke.sh`). Not part of the npm package (scripts/ is
# not in "files" in package.json).
#
# Coverage map (test/readme.test.mjs checks that every README command is a step here or is
# covered by a test file):
#   `npx wavework dashboard`  is not run here (it starts a long-running server). It is covered by
#                             test/dashboard-cli.test.mjs.
#
# Bash 3.2 compatible (macOS default) and bash 5 (CI).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/wavework-smoke.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

fail() {
  echo "smoke: FAIL: $*" >&2
  exit 1
}

# step "<label>": prints the README command the following lines run.
step() {
  echo "+ $1"
}

# expect_exit <code> "<label>" <command...>: runs the command and checks its exit code.
expect_exit() {
  local want="$1" label="$2" got=0
  shift 2
  echo "+ $label    (expect exit $want)"
  "$@" || got=$?
  [ "$got" -eq "$want" ] || fail "\"$label\" exited $got, expected $want"
}

assert_file() {
  local f
  for f in "$@"; do
    [ -f "$f" ] || fail "missing file: $f"
  done
}

# new_repo <dir>: a git repository with the packed wavework installed as a dev dependency.
new_repo() {
  mkdir -p "$1"
  git -C "$1" init -q -b main
  printf '{\n  "name": "smoke-consumer",\n  "version": "0.0.0",\n  "private": true\n}\n' > "$1/package.json"
  (cd "$1" && step "npm i -D <tarball>" && npm i -D "$TARBALL" --no-audit --no-fund >/dev/null) \
    || fail "npm install of the packed tarball failed"
}

VERSION="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version' "$ROOT/package.json")"

echo "== pack"
PACK_DIR="$WORK/pack"
mkdir -p "$PACK_DIR"
(cd "$ROOT" && npm pack --pack-destination "$PACK_DIR" --ignore-scripts >/dev/null)
TARBALL="$(ls "$PACK_DIR"/wavework-*.tgz)"
echo "packed $(basename "$TARBALL") (version $VERSION)"

echo "== repository A: bare init (starter config from origin/HEAD)"
A="$WORK/bare"
new_repo "$A"
git -C "$A" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
cd "$A"
step "npx wavework --version"
[ "$(npx wavework --version)" = "$VERSION" ] || fail "--version does not print $VERSION"
expect_exit 0 "npx wavework init" npx wavework init
assert_file .claude/wavework.json .claude/wavework.lock.json .claude/skills/next-task/SKILL.md
grep -q '"baseBranch": "main"' .claude/wavework.json || fail "starter config does not take baseBranch from origin/HEAD"
expect_exit 1 "npx wavework init" npx wavework init

echo "== repository B: init with --config, update, locally edited file"
B="$WORK/fixture"
new_repo "$B"
cd "$B"
expect_exit 0 "npx wavework init --config <file>" npx wavework init --config "$ROOT/test/fixtures/minimal.wavework.json"
cmp -s .claude/wavework.json "$ROOT/test/fixtures/minimal.wavework.json" || fail "--config file was not copied to .claude/wavework.json"
assert_file \
  .claude/skills/next-task/SKILL.md \
  .claude/skills/watch-ci/SKILL.md \
  .claude/agents/implementer-sonnet.md \
  .claude/agents/implementer-haiku.md \
  .claude/scripts/red-green-check.sh \
  .claude/wavework/dashboard/server.mjs \
  .claude/wavework/dashboard/config.json \
  .claude/settings.json
grep -q 'dashboard/hooks/session-start.mjs' .claude/settings.json || fail "dashboard hooks not registered in settings.json"

cp .claude/wavework.lock.json "$WORK/lock.before"
expect_exit 0 "npx wavework update --dry-run" npx wavework update --dry-run
cmp -s .claude/wavework.lock.json "$WORK/lock.before" || fail "--dry-run changed the lock file"
expect_exit 0 "npx wavework update" npx wavework update

# A locally edited skill whose upstream version changed: the edit is kept and the new version is
# written next to it as .wavework-new. The upstream change is simulated by setting the lock hash to
# one that matches neither the edited file nor the new template.
printf '\nlocal edit\n' >> .claude/skills/next-task/SKILL.md
node -e '
  const fs = require("fs");
  const lock = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  lock.files["skills/next-task/SKILL.md"] = "0".repeat(64);
  fs.writeFileSync(process.argv[1], JSON.stringify(lock, null, 2) + "\n");
' .claude/wavework.lock.json
expect_exit 2 "npx wavework update" npx wavework update
assert_file .claude/skills/next-task/SKILL.md.wavework-new
grep -q 'local edit' .claude/skills/next-task/SKILL.md || fail "the locally edited file was overwritten"

echo "smoke: OK (wavework $VERSION, node $(node -v))"

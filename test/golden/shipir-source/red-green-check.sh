#!/usr/bin/env bash
# Runs a child's new/changed tests against the pre-change code and classifies every test:
#   RED          failed on old code (good: the test proves something)
#   RED-COMPILE  old code does not compile / import against the test (accepted)
#   GREEN-ON-OLD passed on old code (suspicious: the test may prove nothing)
# Usage: red-green-check.sh <worktree> [<base-ref>]   (base-ref defaults to HEAD)
# Exit: 0 no GREEN-ON-OLD (or no changed tests), 1 any GREEN-ON-OLD, 2 tool/setup error.
# Writes only into a throwaway detached worktree in a temp dir (removed on exit). Never touches a real DB
# (backend tests use Testcontainers). Tests in a changed file that were not themselves changed are
# classified too: judge those by the diff.
set -o pipefail

die() { echo "red-green-check: $*" >&2; exit 2; }

[[ $# -ge 1 && $# -le 2 ]] || die "usage: $0 <worktree> [<base-ref>]"
WT="$(cd "$1" 2>/dev/null && pwd)" || die "worktree not found: $1"
BASE="${2:-HEAD}"
git -C "$WT" rev-parse --git-dir >/dev/null 2>&1 || die "not a git worktree: $WT"
git -C "$WT" rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || die "unknown base ref: $BASE"
command -v python3 >/dev/null || die "python3 is required"

# Changed files (added/copied/modified/renamed, tracked + untracked), NUL separated so names with spaces work.
CHANGED=()
while IFS= read -r -d '' f; do CHANGED+=("$f"); done < <(
  { git -C "$WT" diff --name-only -z --diff-filter=ACMR "$BASE" --; git -C "$WT" ls-files -z --others --exclude-standard; } | sort -zu
)

BE_TESTS=() BE_SUPPORT=() FE_TESTS=() FE_SUPPORT=()
for f in "${CHANGED[@]}"; do
  case "$f" in
    backend/src/test/*.java)
      case "$f" in *Test.java|*Tests.java|*IT.java) BE_TESTS+=("$f") ;; *) BE_SUPPORT+=("$f") ;; esac ;;
    backend/src/test/*) BE_SUPPORT+=("$f") ;;
    frontend/*.test.ts|frontend/*.test.tsx) FE_TESTS+=("$f") ;;
    frontend/src/test/*) FE_SUPPORT+=("$f") ;;
  esac
done

if [[ ${#BE_TESTS[@]} -eq 0 && ${#FE_TESTS[@]} -eq 0 ]]; then
  echo "no tests changed"
  exit 0
fi

TMP="$(mktemp -d)" || die "cannot create temp dir"
OLD="$TMP/old"
cleanup() {
  git -C "$WT" worktree remove --force "$OLD" >/dev/null 2>&1 || true
  git -C "$WT" worktree prune >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

git -C "$WT" worktree add --detach "$OLD" "$BASE" >/dev/null 2>&1 || die "cannot create worktree at $BASE"

for f in "${BE_TESTS[@]}" "${BE_SUPPORT[@]}" "${FE_TESTS[@]}" "${FE_SUPPORT[@]}"; do
  mkdir -p "$OLD/$(dirname "$f")" && cp -p "$WT/$f" "$OLD/$f" || die "cannot copy $f"
done

RESULTS="$TMP/results.tsv"   # status<TAB>name
: > "$RESULTS"

run_backend() {
  local classes=() f
  for f in "${BE_TESTS[@]}"; do f="${f##*/}"; classes+=("${f%.java}"); done
  local list; list="$(IFS=,; echo "${classes[*]}")"
  local log="$TMP/backend.log"
  ( cd "$OLD" && ./backend/mvnw -f backend/pom.xml test "-Dtest=$list" -Dsurefire.failIfNoSpecifiedTests=false ) >"$log" 2>&1
  local rc=$?
  local reports=( "$OLD"/backend/target/surefire-reports/TEST-*.xml )
  if [[ -e "${reports[0]}" ]]; then
    python3 -I - "$RESULTS" "${reports[@]}" <<'PY' || return 2
import sys, xml.etree.ElementTree as ET
out = open(sys.argv[1], "a")
for path in sys.argv[2:]:
    for tc in ET.parse(path).getroot().iter("testcase"):
        if tc.find("skipped") is not None:
            continue
        bad = tc.find("failure") is not None or tc.find("error") is not None
        cls = tc.get("classname").split("$")[0].rsplit(".", 1)[-1]
        out.write("%s\t%s.java\t%s\tbackend %s.%s\n" % ("RED" if bad else "GREEN-ON-OLD", cls, tc.get("name").split("(")[0], tc.get("classname"), tc.get("name")))
PY
    return 0
  fi
  if grep -q "COMPILATION ERROR" "$log"; then
    local c; for c in "${classes[@]}"; do printf 'RED-COMPILE\t%s.java\t\tbackend %s (old code does not compile)\n' "$c" "$c" >> "$RESULTS"; done
    return 0
  fi
  echo "backend run produced no reports (exit $rc); tail of output:" >&2
  tail -n 30 "$log" >&2
  return 2
}

run_frontend() {
  local rel=() f
  for f in "${FE_TESTS[@]}"; do rel+=("${f#frontend/}"); done
  local log="$TMP/frontend.log" json="$TMP/vitest.json"
  ( cd "$OLD/frontend" && pnpm install --frozen-lockfile --prefer-offline ) >"$log" 2>&1 || { echo "pnpm install failed; tail:" >&2; tail -n 30 "$log" >&2; return 2; }
  ( cd "$OLD/frontend" && pnpm vitest run "${rel[@]}" --reporter=json "--outputFile=$json" ) >>"$log" 2>&1
  if [[ ! -s "$json" ]]; then
    echo "vitest produced no JSON report; tail:" >&2; tail -n 30 "$log" >&2; return 2
  fi
  python3 -I - "$RESULTS" "$json" <<'PY' || return 2
import sys, json
out = open(sys.argv[1], "a")
for suite in json.load(open(sys.argv[2])).get("testResults", []):
    name = suite.get("name", "?")
    tests = suite.get("assertionResults", [])
    if not tests:
        if suite.get("status") == "failed":
            out.write("RED-COMPILE\tfrontend/%s\t\tfrontend %s (suite failed to load on old code)\n" % (name.split("/frontend/")[-1], name.split("/frontend/")[-1]))
        continue
    for t in tests:
        if t.get("status") in ("pending", "skipped", "todo"):
            continue
        rel = name.split("/frontend/")[-1]
        out.write("%s\tfrontend/%s\t%s\tfrontend %s > %s\n" % ("RED" if t.get("status") == "failed" else "GREEN-ON-OLD", rel, t.get("title", ""), rel, t.get("fullName", "?")))
PY
  return 0
}

STATUS=0
if [[ ${#BE_TESTS[@]} -gt 0 ]]; then run_backend || STATUS=2; fi
if [[ ${#FE_TESTS[@]} -gt 0 ]]; then run_frontend || STATUS=2; fi
[[ $STATUS -eq 2 ]] && die "could not run the tests on the old code (not a pass)"

# Added line numbers per changed test file (tracked: git diff -U0; untracked: every line), so a GREEN test
# only counts as GREEN-ON-OLD when the child touched it. Untouched tests in a changed file show as UNCHANGED.
ADDED="$TMP/added.tsv"   # path<TAB>line
: > "$ADDED"
for f in "${BE_TESTS[@]}" "${FE_TESTS[@]}"; do
  if git -C "$WT" ls-files --error-unmatch -- "$f" >/dev/null 2>&1 && git -C "$WT" cat-file -e "$BASE:$f" 2>/dev/null; then
    git -C "$WT" diff -U0 "$BASE" -- "$f" | python3 -I -c '
import sys, re
f = sys.argv[1]
for l in sys.stdin:
    m = re.match(r"@@ -\S+ \+(\d+)(?:,(\d+))? @@", l)
    if m:
        a, n = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
        for i in range(a, a + n):
            print("%s\t%d" % (f, i))
' "$f" >> "$ADDED"
  else
    awk -v f="$f" '{ printf "%s\t%d\n", f, NR }' "$WT/$f" >> "$ADDED"
  fi
done

echo "red-green-check: base=$BASE"
python3 -I - "$WT" "$RESULTS" "$ADDED" <<'PY'
import sys, re, os, collections
wt, results, added = sys.argv[1:4]
touched = collections.defaultdict(set)
for l in open(added):
    p, n = l.rstrip("\n").rsplit("\t", 1)
    touched[p].add(int(n))
starts = re.compile(r"^\s*(@Test|@ParameterizedTest|@RepeatedTest|it\(|it\.each|test\(|it\.skip|test\.each)")
def segment_touched(path, title):
    path = next((k for k in touched if k == path or k.endswith("/" + path)), path)
    if not title or path not in touched:
        return True
    try:
        lines = open(os.path.join(wt, path), errors="replace").read().split("\n")
    except OSError:
        return True
    idx = [i + 1 for i, l in enumerate(lines) if starts.match(l)] + [len(lines) + 1]
    for a, b in zip(idx, idx[1:]):
        if any(title in l for l in lines[a - 1:b - 1]):
            return any(a <= n < b for n in touched[path])
    return True   # title not found: stay conservative
rows, green = [], 0
for l in open(results):
    st, path, title, disp = l.rstrip("\n").split("\t", 3)
    if st == "GREEN-ON-OLD":
        # a test in a changed file that the child did not touch is not evidence of anything
        if not segment_touched(path, title):
            st = "UNCHANGED"
        else:
            green += 1
    rows.append((st, disp))
order = {"GREEN-ON-OLD": 0, "RED-COMPILE": 1, "RED": 2, "UNCHANGED": 3}
for st, disp in sorted(rows, key=lambda r: (order[r[0]], r[1])):
    print("%-13s %s" % (st, disp))
print("RESULT: %s" % ("GREEN-ON-OLD tests found (suspicious)" if green else "all changed tests are red on old code"))
sys.exit(1 if green else 0)
PY
exit $?

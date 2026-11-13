#!/usr/bin/env bash
# Shell test for red-green-check.sh with a throwaway git repo and stubbed mvnw/pnpm.
# Needs only bash, git and node: no Maven, pnpm, Docker, database or network. It sets its own area table
# (RED_GREEN_AREAS), so it tests the generic parts: argument parsing, test discovery, RED / GREEN-ON-OLD /
# RED-COMPILE classification and the SKIP of unsupported areas. Usage: .claude/scripts/red-green-check.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/red-green-check.sh"
TMP="$(mktemp -d)"
export RED_GREEN_AREAS="backend|maven|backend
frontend|vitest|frontend
svc|unsupported|svc"
trap 'rm -rf "$TMP"' EXIT
FAILS=0
check() { # description, condition result (0 = ok)
  if [[ "$2" -eq 0 ]]; then echo "ok   - $1"; else echo "FAIL - $1"; FAILS=$((FAILS + 1)); fi
}

# Stub mvnw: a test class "*RedTest" fails unless backend/src/main/feature.txt exists, "*GreenTest" always passes.
# BREAK file -> compilation error; FAIL_TOOL file -> exit 1 with no report.
make_repo() {
  local r="$1"
  mkdir -p "$r/backend/src/main" "$r/backend/src/test/java/x" "$r/frontend/src" "$r/svc" "$r/bin"
  echo lock > "$r/frontend/pnpm-lock.yaml"
  cat > "$r/backend/mvnw" <<'STUB'
#!/usr/bin/env bash
root="$(cd "$(dirname "$0")/.." && pwd)"
[[ -e "$root/backend/src/main/FAIL_TOOL" ]] && { echo "Docker not running"; exit 1; }
[[ -e "$root/backend/src/main/BREAK" ]] && { echo "[ERROR] COMPILATION ERROR :"; exit 1; }
for a in "$@"; do [[ "$a" == -Dtest=* ]] && list="${a#-Dtest=}"; done
mkdir -p "$root/backend/target/surefire-reports"
echo '<testsuite>' > "$root/backend/target/surefire-reports/TEST-all.xml"
IFS=, read -ra cls <<< "$list"
for c in "${cls[@]}"; do
  if [[ "$c" == *NoiseTest ]]; then
    # realistic surefire output: properties block, passing test with entities in its name, noise in system-out/err
    echo "<properties><property name=\"x\" value=\"<error>\"/></properties>"
    echo "<testcase classname=\"x.$c\" name=\"it&apos;s &#233; &#x41;\" time=\"0.1\"><system-out><![CDATA[<failure> noise <error>]]></system-out><system-err>&lt;skipped&gt; <failure></system-err></testcase>"
  elif [[ "$c" == *RedTest && ! -e "$root/backend/src/main/feature.txt" ]]; then
    echo "<testcase classname=\"x.$c\" name=\"works\"><failure message=\"boom\"/></testcase>"
  else
    echo "<testcase classname=\"x.$c\" name=\"works\"/>"
  fi
done >> "$root/backend/target/surefire-reports/TEST-all.xml"
echo '</testsuite>' >> "$root/backend/target/surefire-reports/TEST-all.xml"
STUB
  chmod +x "$r/backend/mvnw"
  # pnpm stub (put on PATH): install is a no-op; vitest writes JSON, failing "red space.test.ts" when feature.txt is absent.
  cat > "$r/bin/pnpm" <<'STUB'
#!/usr/bin/env bash
[[ "$1" == install ]] && exit 0
out=""; files=()
for a in "$@"; do
  case "$a" in --outputFile=*) out="${a#--outputFile=}" ;; vitest|run|--reporter=json) ;; *) files+=("$a") ;; esac
done
root="$(cd ../ && pwd)"
printf '{"testResults":[' > "$out"; sep=""
for f in "${files[@]}"; do
  st=passed
  [[ "$f" == *red* && ! -e "$root/backend/src/main/feature.txt" ]] && st=failed
  printf '%s{"name":"%s/frontend/%s","assertionResults":[{"fullName":"does it","status":"%s"}]}' "$sep" "$root" "$f" "$st" >> "$out"; sep=","
done
printf ']}' >> "$out"
STUB
  chmod +x "$r/bin/pnpm"
  ( cd "$r" && git init -q && git config user.email t@t && git config user.name t \
    && echo base > README && git add -A -f && git commit -qm base )
}

run() { ( cd "$1" && PATH="$1/bin:$PATH" "$SCRIPT" "$1" "${@:2}" ) ; }

# 1. failing on old code -> RED, exit 0 (backend + frontend, file name with spaces)
R1="$TMP/r1"; make_repo "$R1"
echo 'class T {}' > "$R1/backend/src/test/java/x/FooRedTest.java"
echo 'x' > "$R1/frontend/src/red space.test.ts"
touch "$R1/backend/src/main/feature.txt"   # the "implementation", present only in the working tree
set +e; OUT="$(run "$R1" 2>&1)"; RC=$?; set -e
check "red tests exit 0" $([[ $RC -eq 0 ]]; echo $?)
check "backend RED reported" $([[ "$OUT" == *"RED "*"backend x.FooRedTest.works"* ]]; echo $?)
check "frontend RED with spaces in name" $([[ "$OUT" == *"RED "*"red space.test.ts"* ]]; echo $?)

# 2. passing on old code -> GREEN-ON-OLD, exit 1
R2="$TMP/r2"; make_repo "$R2"
echo 'class T {}' > "$R2/backend/src/test/java/x/BarGreenTest.java"
set +e; OUT="$(run "$R2" 2>&1)"; RC=$?; set -e
check "green-on-old exits 1" $([[ $RC -eq 1 ]]; echo $?)
check "GREEN-ON-OLD reported" $([[ "$OUT" == *"GREEN-ON-OLD"*"BarGreenTest"* ]]; echo $?)

# 3. old code does not compile -> RED-COMPILE, exit 0 (BREAK is committed in base)
R3="$TMP/r3"; make_repo "$R3"
touch "$R3/backend/src/main/BREAK"; ( cd "$R3" && git add -f -A && git commit -qm brk )
echo 'class T {}' > "$R3/backend/src/test/java/x/NewGreenTest.java"
set +e; OUT="$(run "$R3" 2>&1)"; RC=$?; set -e
check "red-compile exits 0" $([[ $RC -eq 0 ]]; echo $?)
check "RED-COMPILE reported" $([[ "$OUT" == *"RED-COMPILE"* ]]; echo $?)

# 4. no changed tests -> exit 0
R4="$TMP/r4"; make_repo "$R4"; echo change >> "$R4/README"
set +e; OUT="$(run "$R4" 2>&1)"; RC=$?; set -e
check "no tests changed exits 0" $([[ $RC -eq 0 && "$OUT" == *"no tests changed"* ]]; echo $?)

# 5. tool failure -> exit 2
R5="$TMP/r5"; make_repo "$R5"
touch "$R5/backend/src/main/FAIL_TOOL"; ( cd "$R5" && git add -f -A && git commit -qm tool )
echo 'class T {}' > "$R5/backend/src/test/java/x/AnyGreenTest.java"
set +e; OUT="$(run "$R5" 2>&1)"; RC=$?; set -e
check "tool failure exits 2" $([[ $RC -eq 2 ]]; echo $?)

# 6. worktree untouched and temp worktree removed
BEFORE="$(git -C "$R2" status --porcelain)"
set +e; run "$R2" >/dev/null 2>&1; set -e
check "git status unchanged" $([[ "$BEFORE" == "$(git -C "$R2" status --porcelain)" ]]; echo $?)
check "no leftover worktrees" $([[ "$(git -C "$R2" worktree list | wc -l | tr -d ' ')" == 1 ]]; echo $?)

# 7. frontend test that passes on old code -> GREEN-ON-OLD, exit 1 (stub passes anything not named *red*)
R7="$TMP/r7"; make_repo "$R7"
echo 'x' > "$R7/frontend/src/ok.test.ts"
set +e; OUT="$(run "$R7" 2>&1)"; RC=$?; set -e
check "frontend green-on-old exits 1" $([[ $RC -eq 1 && "$OUT" == *"GREEN-ON-OLD"*"frontend src/ok.test.ts"* ]]; echo $?)

# 8. changed files of an unsupported area are skipped with a clear message, not run and not a failure
R8="$TMP/r8"; make_repo "$R8"
echo 'def test_x(): pass' > "$R8/svc/test_x.py"
set +e; OUT="$(run "$R8" 2>&1)"; RC=$?; set -e
check "unsupported area: SKIP, exit 0" $([[ $RC -eq 0 && "$OUT" == *"SKIP svc: unsupported"* && "$OUT" == *"no tests changed"* ]]; echo $?)

# 9. a supported area alongside an unsupported one: tests run, SKIP is still reported
R9="$TMP/r9"; make_repo "$R9"
echo 'def test_x(): pass' > "$R9/svc/test_x.py"
echo 'class T {}' > "$R9/backend/src/test/java/x/BazGreenTest.java"
set +e; OUT="$(run "$R9" 2>&1)"; RC=$?; set -e
check "mixed areas: SKIP plus GREEN-ON-OLD" $([[ $RC -eq 1 && "$OUT" == *"SKIP svc"* && "$OUT" == *"GREEN-ON-OLD"*"BazGreenTest"* ]]; echo $?)

# 10. helper files (not tests) alone do not count as changed tests
R10="$TMP/r10"; make_repo "$R10"
echo 'class H {}' > "$R10/backend/src/test/java/x/Helper.java"
set +e; OUT="$(run "$R10" 2>&1)"; RC=$?; set -e
check "support file only: no tests changed" $([[ $RC -eq 0 && "$OUT" == *"no tests changed"* ]]; echo $?)

# 10b. noise in <system-out>/CDATA and entities in names: passing test stays GREEN-ON-OLD, name is decoded
R10B="$TMP/r10b"; make_repo "$R10B"
echo 'class T {}' > "$R10B/backend/src/test/java/x/QuietNoiseTest.java"
set +e; OUT="$(run "$R10B" 2>&1)"; RC=$?; set -e
check "system-out noise is not a failure" $([[ $RC -eq 1 && "$OUT" == *"GREEN-ON-OLD"*"it's é A"* && "$OUT" != *"RED "* ]]; echo $?)

# 11. argument errors exit 2
set +e; "$SCRIPT" >/dev/null 2>&1; RC1=$?; "$SCRIPT" "$R4" no-such-ref >/dev/null 2>&1; RC2=$?; "$SCRIPT" "$TMP/missing" >/dev/null 2>&1; RC3=$?; set -e
check "usage, unknown ref and missing worktree exit 2" $([[ $RC1 -eq 2 && $RC2 -eq 2 && $RC3 -eq 2 ]]; echo $?)

[[ $FAILS -eq 0 ]] && echo "all passed" || { echo "$FAILS failed"; exit 1; }

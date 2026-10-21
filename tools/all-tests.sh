#!/bin/sh
# Runs every test suite and prints one summary line each (CLAUDE.md lists them). Exit code is non-zero if any fails.
cd "$(dirname "$0")/.." || exit 1
fail=0
for t in "typecheck" "test" "test:mobile" "test:plan" "test:plan -- --mobile" "test:panel" "test:leaks" "test:leaks -- --look" "test:demo"; do
  out=$(npm run $t 2>&1); code=$?
  [ $code -ne 0 ] && fail=1
  printf '%-24s %s\n' "$t" "$(echo "$out" | grep -E 'passed|FAIL|Error' | tail -3 | tr '\n' ' ')"
done
# the integration's Python tests need Home Assistant's test package (pip install -r requirements_test.txt; PYTHON= picks
# the interpreter that has it)
if ${PYTHON:-python3} -c "import pytest_homeassistant_custom_component" 2>/dev/null; then
  out=$(npm run test:py 2>&1) || fail=1
  printf '%-24s %s\n' "test:py" "$(echo "$out" | grep -E 'passed|failed|error' | tail -1)"
else
  printf '%-24s %s\n' "test:py" "skipped: pip install -r requirements_test.txt"
fi
exit $fail

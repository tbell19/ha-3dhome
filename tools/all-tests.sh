#!/bin/sh
# Runs every test suite and prints one summary line each (CLAUDE.md lists them). Exit code is non-zero if any fails.
cd "$(dirname "$0")/.." || exit 1
fail=0
for t in "test" "test:mobile" "test:plan" "test:plan -- --mobile" "test:leaks" "test:leaks -- --look" "test:demo"; do
  out=$(npm run $t 2>&1); code=$?
  [ $code -ne 0 ] && fail=1
  printf '%-24s %s\n' "$t" "$(echo "$out" | grep -E 'passed|FAIL|Error' | tail -3 | tr '\n' ' ')"
done
exit $fail

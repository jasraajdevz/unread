#!/usr/bin/env bash
# D21: this is the canonical gate. CI is a copy of it that has never run.
#
#   bash tools/gate.sh
#
# Exits non-zero on the first failure. Everything here runs on any machine with
# python3, node and a Chromium that Playwright can drive.

set -u
cd "$(dirname "$0")/.."

FAILED=0
step() {
  printf '\n=== %s\n' "$1"
  shift
  if "$@"; then
    printf '    ok\n'
  else
    printf '    FAILED\n'
    FAILED=1
  fi
}

PY=python3
command -v python3 >/dev/null 2>&1 || PY=python

step "story + schema"            $PY tools/validate_story.py Resources/story.json
step "rule 15 (engine audit)"    $PY tools/validate_story.py Resources/story.json --engine src/engine.html
step "content templates"         $PY tools/validate_story.py Resources/story.json --content content
step "story shape"               $PY tools/beat_duration.py Resources/story.json
step "build"                     $PY tools/build.py
step "build is reproducible"     $PY tools/build.py --check
step "determinism + decay"       node tools/check_run.js
step "beats, days, persistence"  npx playwright test

printf '\n=================================\n'
if [ "$FAILED" -eq 0 ]; then
  printf 'GATE GREEN\n'
else
  printf 'GATE RED\n'
fi
exit "$FAILED"

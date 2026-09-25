#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
work=$(mktemp -d /tmp/shellos-ssh-reconnect-test.XXXXXX)
cleanup() {
  case "$work" in /tmp/shellos-ssh-reconnect-test.*) rm -rf -- "$work" ;; esac
}
trap cleanup EXIT

fixture="$work/main.js"
cp "$REPO/tests/fixtures/terminal-browser-ssh-main.js" "$fixture"

SHELLOS_FULL_REINSTALL=1 \
  "$REPO/scripts/patch-terminal-browser-ssh-reconnect.sh" "$fixture"
SHELLOS_FULL_REINSTALL=1 \
  "$REPO/scripts/patch-terminal-browser-ssh-reconnect.sh" "$fixture"
SHELLOS_FULL_REINSTALL=1 \
  "$REPO/scripts/patch-terminal-browser-ssh-reconnect.sh" --check "$fixture"

node "$REPO/tests/fixtures/terminal-browser-ssh-harness.js" "$fixture"
echo "patch-terminal-browser-ssh-reconnect: ok"

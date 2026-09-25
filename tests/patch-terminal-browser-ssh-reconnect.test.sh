#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
work=$(mktemp -d /tmp/shellos-ssh-reconnect-test.XXXXXX)
cleanup() {
  case "$work" in /tmp/shellos-ssh-reconnect-test.*) rm -rf -- "$work" ;; esac
}
trap cleanup EXIT

cli_fixture="$work/cli-main.js"
browser_fixture="$work/browser-main.js"
cp "$REPO/tests/fixtures/terminal-browser-ssh-main.js" "$cli_fixture"
cp "$REPO/tests/fixtures/terminal-browser-ssh-browser.js" "$browser_fixture"

SHELLOS_FULL_REINSTALL=1 \
  "$REPO/scripts/patch-terminal-browser-ssh-reconnect.sh" "$cli_fixture" "$browser_fixture"
SHELLOS_FULL_REINSTALL=1 \
  "$REPO/scripts/patch-terminal-browser-ssh-reconnect.sh" "$cli_fixture" "$browser_fixture"
SHELLOS_FULL_REINSTALL=1 \
  "$REPO/scripts/patch-terminal-browser-ssh-reconnect.sh" --check \
    "$cli_fixture" "$browser_fixture"

node "$REPO/tests/fixtures/terminal-browser-ssh-harness.js" "$cli_fixture"
node "$REPO/tests/fixtures/terminal-browser-ssh-browser-harness.js" "$browser_fixture"
echo "patch-terminal-browser-ssh-reconnect: ok"

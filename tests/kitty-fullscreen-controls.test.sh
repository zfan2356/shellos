#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d /tmp/shellos-controls-test.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
xcrun clang -fblocks -Wall -Wextra -Werror -framework Cocoa \
  "$REPO/tests/kitty-fullscreen-controls.test.m" -o "$WORK/test"
"$WORK/test"
if [[ $# == 1 ]]; then
  BACKEND="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
  xcrun clang -fblocks -Wall -Wextra -Werror -framework Cocoa \
    "$REPO/tests/kitty-cocoa-integration.test.m" "$BACKEND" \
    -Wl,-rpath,"$(dirname "$BACKEND")" -o "$WORK/integration"
  "$WORK/integration"
fi

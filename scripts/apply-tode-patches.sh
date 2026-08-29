#!/usr/bin/env bash
# Apply only committed and pulled Tode patches from ShellOS.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-}"

if [[ -n "$MODE" && "$MODE" != "--check" && "$MODE" != "--reapply" ]]; then
  echo "usage: $0 [--check|--reapply]" >&2
  exit 2
fi

"$REPO/scripts/assert-repo-first.sh"

if [[ "$(uname -s)" == "Darwin" && "$MODE" != "--check" ]]; then
  defaults write dev.zenbu.terminal-browser NSAppSleepDisabled -bool YES
fi

if [[ "$MODE" == "--check" ]]; then
  "$REPO/scripts/patch-terminal-browser.sh" --check
  "$REPO/scripts/patch-tode-cmd-right-click.sh" --check
else
  "$REPO/scripts/patch-terminal-browser.sh"
  "$REPO/scripts/patch-tode-cmd-right-click.sh" "$MODE"
fi

echo "ShellOS Tode patches verified. Restart Tode to load changed install files."

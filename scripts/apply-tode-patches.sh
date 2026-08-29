#!/usr/bin/env bash
# Internal full-reinstall helper: apply every tracked Tode patch.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-}"

if [[ "${SHELLOS_FULL_REINSTALL:-}" != 1 ]]; then
  echo "do not patch an installed artifact selectively; run the complete ShellOS reinstall" >&2
  exit 1
fi

if [[ -n "$MODE" && "$MODE" != "--check" && "$MODE" != "--reapply" ]]; then
  echo "usage: $0 [--check|--reapply]" >&2
  exit 2
fi

if [[ "$(uname -s)" == "Darwin" && "$MODE" != "--check" ]]; then
  defaults write dev.zenbu.terminal-browser NSAppSleepDisabled -bool YES
fi

if [[ "$MODE" == "--check" ]]; then
  "$SCRIPT_DIR/patch-terminal-browser.sh" --check
  "$SCRIPT_DIR/patch-tode-cmd-right-click.sh" --check
else
  "$SCRIPT_DIR/patch-terminal-browser.sh"
  "$SCRIPT_DIR/patch-tode-cmd-right-click.sh" "$MODE"
fi

echo "ShellOS Tode patches verified. Restart Tode to load changed install files."

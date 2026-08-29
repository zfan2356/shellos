#!/usr/bin/env bash
# Install the canonical editor config into both editors' User dirs.
# Internal full-reinstall helper. Copies deliberately replace the old live
# symlinks so a checkout edit cannot mutate an installed machine before push.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${SHELLOS_FULL_REINSTALL:-}" != 1 ]]; then
  echo "do not deploy selectively; run $REPO/scripts/reinstall-shellos.sh" >&2
  exit 1
fi

install_config() { # $1 repo-file  $2 dest
  mkdir -p "$(dirname "$2")"
  if [[ -e "$2" && ! -L "$2" ]] && ! cmp -s "$1" "$2"; then
    cp -p "$2" "$2.bak-$(date +%Y%m%d-%H%M%S)"
  fi
  rm -f "$2"
  install -m 644 "$1" "$2"
  echo "installed: $1 -> $2"
}

install_config "$REPO/editor/settings.json"            ~/.local/share/tode/vscode/user-data/User/settings.json
install_config "$REPO/editor/keybindings.tode.json"    ~/.local/share/tode/vscode/user-data/User/keybindings.json
install_config "$REPO/editor/settings.json"            ~/Library/Application\ Support/Cursor/User/settings.json
install_config "$REPO/editor/keybindings.cursor.json"  ~/Library/Application\ Support/Cursor/User/keybindings.json

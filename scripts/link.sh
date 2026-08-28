#!/usr/bin/env bash
# Symlink the shared editor config into both editors' User dirs.
# Idempotent; backs up any real file it replaces.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

link() { # $1 repo-file  $2 dest
  mkdir -p "$(dirname "$2")"
  if [ -e "$2" ] && [ ! -L "$2" ]; then mv "$2" "$2.bak-$(date +%Y%m%d-%H%M%S)"; fi
  ln -sfn "$1" "$2"
  echo "linked: $2 -> $1"
}

link "$REPO/editor/settings.json"            ~/.local/share/tode/vscode/user-data/User/settings.json
link "$REPO/editor/keybindings.tode.json"    ~/.local/share/tode/vscode/user-data/User/keybindings.json
link "$REPO/editor/settings.json"            ~/Library/Application\ Support/Cursor/User/settings.json
link "$REPO/editor/keybindings.cursor.json"  ~/Library/Application\ Support/Cursor/User/keybindings.json

if command -v tode >/dev/null 2>&1 && command -v node >/dev/null 2>&1 \
  && command -v npx >/dev/null 2>&1; then
  "$REPO/scripts/install-worktree-review.sh"
else
  echo "skipped bundled Worktree Review install: tode, node, or npx is unavailable"
fi

#!/usr/bin/env bash
# Snapshot the live kitty + tode config into this repo.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

KITTY=~/.config/kitty
TODE_DATA=~/.local/share/tode
TODE_USER="$TODE_DATA/vscode/user-data/User"

cp "$KITTY/kitty.conf" "$KITTY/current-theme.conf" \
   "$KITTY/macos-launch-services-cmdline" "$REPO/kitty/"
# ssh.conf is local-only (private host aliases) — deliberately not synced.
cp "$KITTY/tode/keybinds.kitty.conf" "$REPO/kitty/tode/"

cp "$TODE_USER/settings.json" "$TODE_USER/keybindings.json" "$REPO/tode/"
cp "$TODE_DATA/shortcuts.json" "$REPO/tode/"
cp "$TODE_DATA/palette.json" "$TODE_DATA/live-theme.json" "$TODE_DATA/inject.css" \
   "$REPO/tode/theme/"

python3 - "$REPO" <<'EOF'
import json, sys
repo = sys.argv[1]
path = f"{__import__('os').path.expanduser('~')}/.local/share/tode/vscode/extensions/extensions.json"
ids = sorted({e["identifier"]["id"] for e in json.load(open(path))
              if not e["identifier"]["id"].startswith("tode.")})
open(f"{repo}/tode/extensions.txt", "w").write("\n".join(ids) + "\n")
EOF

cd "$REPO"
git --no-pager diff --stat
echo "Synced. Review the diff above, then: git add -A && git commit"

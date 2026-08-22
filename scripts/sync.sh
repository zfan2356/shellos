#!/usr/bin/env bash
# Snapshot the parts of the live environment where the MACHINE is the source
# of truth: kitty config, tode shortcut decisions, tode theme files.
# Editor settings/keybindings/extensions flow the OTHER way — they are
# canonical in editor/; scripts/link.sh deploys the symlinked files.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

KITTY=~/.config/kitty
TODE_DATA=~/.local/share/tode

cp "$KITTY/kitty.conf" "$KITTY/current-theme.conf" \
   "$KITTY/macos-launch-services-cmdline" "$REPO/kitty/"
cp "$KITTY/tode/keybinds.kitty.conf" "$REPO/kitty/tode/"
# ssh.conf is local-only (private host aliases) — deliberately not synced.

cp "$TODE_DATA/shortcuts.json" "$REPO/tode/"
cp "$TODE_DATA/palette.json" "$TODE_DATA/live-theme.json" "$TODE_DATA/inject.css" \
   "$REPO/tode/theme/"

cd "$REPO"
git --no-pager diff --stat
echo "Synced. Review the diff, run scripts/redline.sh, then commit."

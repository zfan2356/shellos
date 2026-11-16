#!/usr/bin/env bash
# Reinstall the repository pin even when Homebrew has moved to a newer release.
set -euo pipefail
[[ "${SHELLOS_FULL_REINSTALL:-}" == 1 ]] || { echo "run the complete ShellOS reinstall" >&2; exit 1; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(git -C "$REPO/third-party/kitty" describe --tags --exact-match)
case "$VERSION" in
  v0.49.2) SHA256=e524b894145d89cb76b584e3a9691196ae56bfa31d51384a44aa774252b7cef7 ;;
  *) echo "No verified macOS archive recorded for $VERSION" >&2; exit 1 ;;
esac
BACKUP="${1:?backup directory required}"
WORK=$(mktemp -d /tmp/shellos-kitty.XXXXXX)
cleanup() {
  hdiutil detach "$WORK/mount" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
ARCHIVE="$WORK/kitty.dmg"
for cached in "$HOME"/Library/Caches/Homebrew/downloads/*--kitty-"${VERSION#v}".dmg; do
  [[ ! -f "$cached" ]] || { cp "$cached" "$ARCHIVE"; break; }
done
if [[ ! -f "$ARCHIVE" ]]; then
  curl -fL --retry 3 "https://github.com/kovidgoyal/kitty/releases/download/$VERSION/kitty-${VERSION#v}.dmg" -o "$ARCHIVE"
fi
printf '%s  %s\n' "$SHA256" "$ARCHIVE" | shasum -a 256 -c - >/dev/null
mkdir "$WORK/mount"
hdiutil attach -readonly -nobrowse -mountpoint "$WORK/mount" "$ARCHIVE" >/dev/null
bash "$REPO/scripts/build-kitty-app.sh" "$WORK/mount/kitty.app" "$WORK/kitty.app"
[[ "$("$WORK/kitty.app/Contents/MacOS/kitty" --version | awk '{print $2}')" == "${VERSION#v}" ]]
mkdir -p "$BACKUP/apps"
[[ ! -d /Applications/kitty.app ]] || mv /Applications/kitty.app "$BACKUP/apps/kitty.app"
if ! mv "$WORK/kitty.app" /Applications/kitty.app; then
  [[ ! -d "$BACKUP/apps/kitty.app" ]] || mv "$BACKUP/apps/kitty.app" /Applications/kitty.app
  exit 1
fi
echo "Installed pinned kitty $VERSION with ShellOS fullscreen controls"

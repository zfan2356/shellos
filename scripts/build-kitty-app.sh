#!/usr/bin/env bash
# Stage a locally signed app with the source-built backend; never replace a live app.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${1:?usage: build-kitty-app.sh original.app new.app}"
OUTPUT="${2:?output app required}"
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || {
  echo "the custom kitty app requires macOS arm64" >&2
  exit 1
}
[[ ! -e "$OUTPUT" ]] || { echo "output already exists: $OUTPUT" >&2; exit 1; }
PIN=$(git -C "$REPO" rev-parse HEAD:third-party/kitty)
VERSION=$(git -C "$REPO/third-party/kitty" describe --tags --exact-match "$PIN")
codesign --verify --deep --strict "$BASE"
[[ "v$("$BASE/Contents/MacOS/kitty" --version | awk '{print $2}')" == "$VERSION" ]] || {
  echo "base kitty app must match $VERSION" >&2
  exit 1
}
ditto "$BASE" "$OUTPUT"
BACKEND="$OUTPUT/Contents/Resources/Python/lib/kitty-extensions/kitty.glfw-cocoa.so"
bash "$REPO/scripts/build-kitty-cocoa.sh" "$BACKEND"
{
  echo "kitty_revision=$PIN"
  echo "shellos_revision=$(git -C "$REPO" rev-parse HEAD)"
  echo "backend_sha256=$(shasum -a 256 "$BACKEND" | awk '{print $1}')"
  echo "controls_sha256=$(shasum -a 256 "$REPO/kitty/fullscreen-controls.m" | awk '{print $1}')"
  echo "bridge_sha256=$(shasum -a 256 "$REPO/kitty/fullscreen-controls.patch" | awk '{print $1}')"
} > "$OUTPUT/Contents/Resources/shellos-cocoa-build.txt"
codesign --force --deep --sign - --preserve-metadata=identifier,entitlements,flags "$OUTPUT"
codesign --verify --deep --strict "$OUTPUT"
echo "Staged locally signed kitty app: $OUTPUT"
echo "Launching this locally signed app may require approval in macOS Privacy & Security."

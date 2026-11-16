#!/usr/bin/env bash
# Compile the pinned Cocoa backend in scratch space; never mutate an app bundle.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="${1:?usage: build-kitty-cocoa.sh output.so}"
SOURCE="$REPO/third-party/kitty"
PIN=$(git -C "$REPO" rev-parse HEAD:third-party/kitty)
WORK=$(mktemp -d /tmp/shellos-cocoa.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
git -C "$SOURCE" archive "$PIN" glfw kitty 3rdparty | tar -x -C "$WORK"
patch -s -d "$WORK" -p1 < "$REPO/kitty/fullscreen-controls.patch"
cp "$REPO/kitty/fullscreen-controls.m" "$WORK/glfw/shellos_fullscreen_controls.m"

sources=()
while IFS= read -r source; do
  sources+=("$WORK/glfw/$source")
done < <(python3 - "$WORK/glfw/source-info.json" <<'PY'
import json
import sys
with open(sys.argv[1]) as stream:
    info = json.load(stream)
print("\n".join(info["common"]["sources"] + info["cocoa"]["sources"]))
PY
)

mkdir -p "$(dirname "$OUTPUT")"
xcrun clang -std=gnu11 -O2 -fPIC -fvisibility=hidden -fblocks \
  -D_GLFW_COCOA -D_GLFW_BUILD_DLL -DGL_SILENCE_DEPRECATION -DNDEBUG \
  -mmacosx-version-min=11.0 -arch arm64 -dynamiclib \
  -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers \
  "${sources[@]}" -framework Cocoa -framework IOKit -framework CoreFoundation \
  -framework CoreVideo -framework UniformTypeIdentifiers \
  -install_name @rpath/kitty.glfw-cocoa.so -o "$OUTPUT"
echo "Built ShellOS Cocoa backend from kitty $PIN: $OUTPUT"

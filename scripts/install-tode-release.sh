#!/usr/bin/env bash
# Internal full-reinstall helper: install the terminal-code release pinned by
# shellos. The optional version argument is used by the remote deployer, which
# does not copy the Git submodule to the remote host.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-}"

if [[ "${SHELLOS_FULL_REINSTALL:-}" != 1 ]]; then
  echo "do not install tode selectively; run $REPO/scripts/reinstall-shellos.sh" >&2
  exit 1
fi

if [[ -z "$VERSION" ]]; then
  VERSION=$(git -C "$REPO/third-party/terminal-code" describe --tags --exact-match)
fi
if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "invalid terminal-code release pin: $VERSION" >&2
  exit 1
fi

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) TARGET=darwin-arm64 ;;
  Linux-x86_64|Linux-amd64) TARGET=linux-x64 ;;
  Linux-aarch64|Linux-arm64) TARGET=linux-arm64 ;;
  *)
    echo "tode does not support $(uname -s) $(uname -m)" >&2
    exit 1
    ;;
esac

for command in curl tar awk sed; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "required command not found: $command" >&2
    exit 1
  }
done

# The pinned upstream installer is used only as the signed release manifest.
# Download bytes from the matching immutable GitHub release, not workers.dev.
MANIFEST=$(curl -fsSL --retry 3 "https://tode.sh/install/v/$VERSION")
REPORTED_VERSION=$(printf '%s\n' "$MANIFEST" |
  sed -n 's/^VERSION="\([^"]*\)".*/\1/p' | head -n 1)
if [[ "$REPORTED_VERSION" != "$VERSION" ]]; then
  echo "release manifest reported $REPORTED_VERSION, expected $VERSION" >&2
  exit 1
fi

TABLE=$(printf '%s\n' "$MANIFEST" |
  sed -n '/^PLATFORMS="/,/"$/p' |
  sed 's/^PLATFORMS="//; s/"$//')
ROW=$(printf '%s\n' "$TABLE" | awk -v target="$TARGET" '$1 == target && NF == 4')
SHA256=$(printf '%s\n' "$ROW" | awk '{print $3}')
if [[ -z "$SHA256" ]]; then
  echo "release $VERSION has no checksum for $TARGET" >&2
  exit 1
fi

WORK=$(mktemp -d /tmp/shellos-tode.XXXXXX)
cleanup() {
  case "$WORK" in /tmp/shellos-tode.*) rm -rf -- "$WORK" ;; esac
}
trap cleanup EXIT

TARBALL="$WORK/tode.tar.gz"
URL="https://github.com/zenbu-labs/terminal-code/releases/download/$VERSION/tode-$TARGET.tar.gz"
echo "installing tode $VERSION for $TARGET from GitHub"
curl -fL --retry 3 --retry-delay 2 --progress-bar "$URL" -o "$TARBALL"
if command -v sha256sum >/dev/null 2>&1; then
  printf '%s  %s\n' "$SHA256" "$TARBALL" | sha256sum -c - >/dev/null
else
  printf '%s  %s\n' "$SHA256" "$TARBALL" | shasum -a 256 -c - >/dev/null
fi

APP="$HOME/.local/lib/tode"
BIN_HOME="${XDG_BIN_HOME:-$HOME/.local/bin}"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"

rm -rf -- "$APP.new"
mkdir -p "$APP.new"
tar -xzf "$TARBALL" -C "$APP.new" --strip-components 1
[[ -f "$APP.new/dist/main.js" && -x "$APP.new/bin/tode" ]] || {
  echo "release archive is missing required tode files" >&2
  exit 1
}

rm -rf -- "$APP.old"
[[ ! -d "$APP" ]] || mv "$APP" "$APP.old"
mv "$APP.new" "$APP"
rm -rf -- "$APP.old"

mkdir -p "$BIN_HOME" "$STATE_HOME/tode"
rm -f -- "$BIN_HOME/tode"
ln -s "$APP/bin/tode" "$BIN_HOME/tode"
cat > "$STATE_HOME/tode/install.json" <<EOF
{
  "version": "$VERSION",
  "channel": "stable",
  "target": "$TARGET",
  "root": "$APP",
  "installed": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

if [[ "$(uname -s)" == Linux ]]; then
  MISSING=$(ldd "$APP/vendor/terminal-browser/electron/electron" 2>/dev/null |
    awk '/not found/{print $1}' | sort -u || true)
  if [[ -n "$MISSING" ]]; then
    echo "warning: missing system libraries:" >&2
    printf '  %s\n' $MISSING >&2
  fi
fi

"$BIN_HOME/tode" --version

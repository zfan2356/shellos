#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cwd=$(pwd -P)
work=$(mktemp -d /tmp/shellos-direct-wrapper.XXXXXX)
trap 'rm -rf "$work"' EXIT
cat > "$work/pixel" <<'EOF'
#!/bin/sh
printf '%s\n' "$@"
EOF
chmod +x "$work/pixel"
result=$(TODE_PIXEL_BIN="$work/pixel" "$REPO/scripts/tode-remote-wrapper" --version)
[[ "$result" == --version ]]
if TODE_PIXEL_BIN="$work/pixel" KITTY_LISTEN_ON=unix:test "$REPO/scripts/tode-remote-wrapper" /tmp >"$work/log" 2>&1; then
  echo 'remote wrapper still opens a local window' >&2; exit 1
fi
grep -Fq "tode-remote <ssh-alias> \"$cwd\"" "$work/log"
if TODE_PIXEL_BIN="$work/pixel" TODE_SSH_ALIAS=cvm "$REPO/scripts/tode-remote-wrapper" /tmp >"$work/log" 2>&1; then
  echo 'remote wrapper unexpectedly opened a local window with an injected alias' >&2; exit 1
fi
grep -Fq "tode-remote cvm \"$cwd\"" "$work/log"
if TODE_PIXEL_BIN="$work/pixel" "$REPO/scripts/tode-remote-wrapper" --ssh host >"$work/log" 2>&1; then
  echo 'remote wrapper still allows SSH transport' >&2; exit 1
fi
echo 'remote wrapper: no forwarding; maintenance commands preserved'

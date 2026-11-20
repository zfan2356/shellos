#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
work=$(mktemp -d /tmp/shellos-tode-wrapper-test.XXXXXX)
cleanup() {
  case "$work" in /tmp/shellos-tode-wrapper-test.*) rm -rf -- "$work" ;; esac
}
trap cleanup EXIT

mkdir -p "$work/bin" "$work/home/.config/shellos" "$work/home/.local/bin" \
  "$work/project with spaces"
cat > "$work/home/.config/shellos/remote-tode.env" <<'EOF'
TODE_REMOTE_SSH_HOST='CVM'
EOF
cat > "$work/bin/kitten" <<'EOF'
#!/bin/sh
while [ "$#" -gt 0 ] && [ "$1" != /bin/sh ]; do
  shift
done
"$@"
exit 0
EOF
cat > "$work/home/.local/bin/tode" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" > "$TODE_TEST_ARGS"
exit "${TODE_TEST_STATUS:-0}"
EOF
chmod +x "$work/bin/kitten" "$work/home/.local/bin/tode"

run_wrapper() {
  HOME="$work/home" \
    PATH="$work/bin:/usr/bin:/bin" \
    KITTY_LISTEN_ON=unix:test \
    KITTY_WINDOW_ID=1 \
    TODE_TEST_ARGS="$work/args" \
    TODE_TEST_STATUS="${1:-0}" \
    "$REPO/scripts/tode-remote-wrapper" "$work/project with spaces"
}

output=$(run_wrapper)
[[ "$output" == "opening locally in the current kitty window: $work/project with spaces" ]]
diff -u <(printf '%s\n' --ssh 'ssh CVM' "$work/project with spaces") "$work/args"

failure=$(printf '\n' | run_wrapper 23 2>&1)
grep -Fq "tode could not open $work/project with spaces through SSH target CVM (exit 23)" \
  <<< "$failure"
if grep -Fq "opened locally" <<< "$failure"; then
  echo "wrapper still reports a failed launch as opened" >&2
  exit 1
fi

cat > "$work/home/.local/bin/tode-pixel" <<'EOF'
#!/bin/sh
printf '%s\n' 'http://127.0.0.1:12345/?folder=%2Fproject+with+spaces'
EOF
chmod +x "$work/home/.local/bin/tode-pixel"
run_wrapper >/dev/null
diff -u <(printf '%s\n' --ssh 'ssh CVM' --ready-url 'http://127.0.0.1:12345/?folder=%2Fproject+with+spaces') "$work/args"

mkdir -p "$work/home/.local/lib/tode/vendor/terminal-browser/bin" "$work/home/.local/share/tode"
cp "$work/home/.local/bin/tode" "$work/home/.local/lib/tode/vendor/terminal-browser/bin/terminal-browser"
touch "$work/home/.local/share/tode/browser-preload.js" "$work/home/.local/share/tode/browser-main.js"
run_wrapper >/dev/null
diff -u <(printf '%s\n' open --app-mode --ssh 'ssh CVM' \
  'http://127.0.0.1:12345/?folder=%2Fproject+with+spaces' \
  "--preload=$work/home/.local/share/tode/browser-preload.js" \
  "--main-script=$work/home/.local/share/tode/browser-main.js") "$work/args"

echo "tode remote wrapper tests: ok"

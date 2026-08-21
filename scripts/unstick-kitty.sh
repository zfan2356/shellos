#!/usr/bin/env bash
# Rescue a kitty wedged in the GPU driver (symptom: kitty UI frozen, whole
# desktop laggy, `kitty @ ls` times out, kitty process in U state).
# Captures evidence first, then force-kills. Root cause seen 2026-08-21:
# giant tode full-frame texture upload stuck in glTexImage2D (GL->Metal).
set -uo pipefail

PID=$(pgrep -x kitty | head -1)
[ -z "${PID:-}" ] && { echo "kitty is not running"; exit 0; }

STATE=$(ps -o stat= -p "$PID" | tr -d ' ')
SOCK=$(ls /tmp/kitty-* 2>/dev/null | head -1)
if [ -n "$SOCK" ] && kitty @ --to "unix:$SOCK" ls >/dev/null 2>&1; then
  echo "kitty ($PID, state $STATE) responds on $SOCK — not stuck, refusing to kill"
  exit 1
fi

EVIDENCE=/tmp/kitty-stuck-$(date +%Y%m%d-%H%M%S).txt
echo "kitty $PID unresponsive (state $STATE); sampling to $EVIDENCE ..."
sample "$PID" 2 -file "$EVIDENCE" >/dev/null 2>&1 || true

kill -9 "$PID"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  ps -p "$PID" >/dev/null 2>&1 || break
  sleep 1
done
if ps -p "$PID" >/dev/null 2>&1; then
  echo "still not dead (deep uninterruptible sleep) — it will exit when the syscall returns"
else
  echo "kitty killed. evidence: $EVIDENCE"
fi
echo "next: tode --shutdown   # clear orphan tode daemons"
echo "      open -a kitty     # relaunch"

#!/usr/bin/env bash
# Pre-commit content check. Patterns that must never appear live in
# .redline-local (untracked; recreate from local notes if missing).
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
if [ -f "$REPO/.redline-local" ]; then
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    if grep -rn -i "$pat" "$REPO" --exclude-dir=third-party --exclude-dir=.git \
         --exclude=.redline-local; then
      echo "REDLINE HIT: '$pat'"; fail=1
    fi
  done < "$REPO/.redline-local"
else
  echo "warning: $REPO/.redline-local missing — internal-identifier check skipped" >&2
fi
if grep -rn -i -E '"(token|secret|password|apikey|api_key)"\s*:' "$REPO" \
     --exclude-dir=third-party --exclude-dir=.git --include="*.json" --include="*.conf"; then
  echo "REDLINE HIT: possible secret"; fail=1
fi
[ $fail -eq 0 ] && echo "redline: clean"
exit $fail

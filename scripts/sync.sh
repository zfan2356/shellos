#!/usr/bin/env bash
# Kept as a loud compatibility stop. Machine-to-repo synchronization violates
# the repository-first installation policy.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

echo "sync.sh is disabled: installed machines are never a source of truth" >&2
echo "edit an independent checkout, commit and push, pull $REPO, then run:" >&2
echo "  $REPO/scripts/reinstall-shellos.sh <ssh-alias> [port]" >&2
exit 1

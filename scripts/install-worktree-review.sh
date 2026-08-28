#!/usr/bin/env bash
# Build and install shellos' bundled Worktree Review extension locally or remotely.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SSH_HOST="${1:-}"

for command in node npx; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "required command not found: $command" >&2
    exit 1
  }
done

if [[ -n "$SSH_HOST" && ! "$SSH_HOST" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "usage: $0 [ssh-alias]" >&2
  exit 2
fi

work=$(mktemp -d /tmp/shellos-worktree-review.XXXXXX)
remote_work=""
cleanup() {
  case "$work" in /tmp/shellos-worktree-review.*) rm -rf -- "$work" ;; esac
  case "$remote_work" in
    /tmp/shellos-worktree-review.*)
      ssh "$SSH_HOST" "rm -rf -- '$remote_work'" >/dev/null 2>&1 || true
      ;;
  esac
}
trap cleanup EXIT

vsix="$work/worktree-review.vsix"
"$REPO/editor/extensions/worktree-review/scripts/package-vsix.sh" "$vsix"

if [[ -z "$SSH_HOST" ]]; then
  command -v tode >/dev/null 2>&1 || {
    echo "required command not found: tode" >&2
    exit 1
  }
  tode --install-extension "$vsix" --force
  exit
fi

for command in ssh scp; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "required command not found: $command" >&2
    exit 1
  }
done

remote_work=$(ssh "$SSH_HOST" 'mktemp -d /tmp/shellos-worktree-review.XXXXXX')
scp -q "$vsix" "$SSH_HOST:$remote_work/worktree-review.vsix"
ssh "$SSH_HOST" bash -s -- "$remote_work/worktree-review.vsix" <<'REMOTE'
set -euo pipefail
vsix=$1
code_server=$(
  find "$HOME/.local/share/tode/code-server" -type f -path '*/bin/code-server' -perm -111 \
    2>/dev/null | sort -V | tail -n 1
)
if [[ -z "$code_server" ]]; then
  echo "remote tode code-server not found" >&2
  exit 1
fi

"$code_server" \
  --install-extension "$vsix" \
  --force \
  --extensions-dir "$HOME/.local/share/tode/vscode/extensions" \
  --user-data-dir "$HOME/.local/share/tode/vscode/user-data"
REMOTE

#!/usr/bin/env bash
# Refuse deployment from uncommitted or unpushed ShellOS state.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_REF="${SHELLOS_DEPLOY_REF:-origin/main}"

required=(
  scripts/assert-repo-first.sh
  scripts/apply-tode-patches.sh
  scripts/patch-terminal-browser.sh
  scripts/patch-tode-cmd-right-click.sh
)

for file in "${required[@]}"; do
  git -C "$REPO" ls-files --error-unmatch "$file" >/dev/null 2>&1 || {
    echo "refusing deployment: required script is not tracked: $file" >&2
    exit 1
  }
done

if [[ -n "$(git -C "$REPO" status --porcelain --untracked-files=all)" ]]; then
  echo "refusing deployment: ShellOS working tree is not clean" >&2
  echo "commit and push every intended change before deploying" >&2
  exit 1
fi

head_commit=$(git -C "$REPO" rev-parse HEAD)
remote_commit=$(git -C "$REPO" rev-parse --verify "$REMOTE_REF^{commit}" 2>/dev/null) || {
  echo "refusing deployment: missing $REMOTE_REF; fetch and pull first" >&2
  exit 1
}

if [[ "$head_commit" != "$remote_commit" ]]; then
  echo "refusing deployment: HEAD does not match $REMOTE_REF" >&2
  echo "push the change, then pull it into this checkout before deploying" >&2
  exit 1
fi

echo "repo-first check passed: $head_commit"

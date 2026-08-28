#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(node -p "require('$ROOT/package.json').version")
OUTPUT="${1:-$ROOT/dist/worktree-review-$VERSION.vsix}"

mkdir -p "$(dirname "$OUTPUT")"
cd "$ROOT"
npx --yes @vscode/vsce package \
  --no-dependencies \
  --out "$OUTPUT"

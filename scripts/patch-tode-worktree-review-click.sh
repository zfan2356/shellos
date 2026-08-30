#!/usr/bin/env bash
# Let Worktree Review handle changed Explorer files before VS Code opens them.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${SHELLOS_FULL_REINSTALL:-}" != 1 ]]; then
  echo "do not patch an installed artifact directly; run $REPO/scripts/reinstall-shellos.sh" >&2
  exit 1
fi

MODE="${1:-}"
if [[ -n "$MODE" && "$MODE" != "--check" && "$MODE" != "--reapply" ]]; then
  echo "usage: $0 [--check|--reapply]" >&2
  exit 2
fi

WORKBENCH="${TODE_WORKBENCH_BUNDLE:-}"
if [[ -z "$WORKBENCH" ]]; then
  CODE_SERVER_ROOT="${TODE_CODE_SERVER_ROOT:-$HOME/.local/share/tode/code-server}"
  WORKBENCH=$(find "$CODE_SERVER_ROOT" -type f \
    -path '*/lib/vscode/out/vs/workbench/workbench.web.main.internal.js' \
    2>/dev/null | sort -V | tail -n 1)
fi
[[ -n "$WORKBENCH" && -f "$WORKBENCH" ]] || {
  echo "Tode workbench bundle not found" >&2
  exit 1
}

NODE=$(command -v node || true)
if [[ -z "$NODE" ]]; then
  for candidate in "$HOME"/.local/share/tode/code-server/*/lib/node; do
    [[ -x "$candidate" ]] && NODE="$candidate" && break
  done
fi
[[ -n "$NODE" ]] || { echo "node not found" >&2; exit 1; }

"$NODE" - "$WORKBENCH" "$MODE" <<'JS'
const fs = require("fs");
const [target, mode] = process.argv.slice(2);
const mark = "/* shellos: worktree-review Explorer pre-open v1 */";
const anchor = 'this.delegate?.willOpenElement(c.browserEvent),await this.editorService.openEditor({resource:l.resource,options:{preserveFocus:c.editorOptions.preserveFocus,pinned:c.editorOptions.pinned,source:1}},c.sideBySide?Kn:cr)';
const replacement = 'this.delegate?.willOpenElement(c.browserEvent);' + mark + 'let shellosReviewHandled=!1;try{shellosReviewHandled=await this.commandService.executeCommand("worktreeReview.interceptExplorerOpen",l.resource,{preserveFocus:c.editorOptions.preserveFocus,pinned:c.editorOptions.pinned,sideBySide:c.sideBySide})===!0}catch{}if(!shellosReviewHandled)await this.editorService.openEditor({resource:l.resource,options:{preserveFocus:c.editorOptions.preserveFocus,pinned:c.editorOptions.pinned,source:1}},c.sideBySide?Kn:cr)';

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function verify(source) {
  if (occurrences(source, mark) !== 1) {
    throw new Error(`expected one Worktree Review Explorer patch marker in ${target}`);
  }
  if (occurrences(source, anchor) !== 0) {
    throw new Error(`unpatched Explorer open path remains in ${target}`);
  }
  if (occurrences(source, 'worktreeReview.interceptExplorerOpen') !== 1) {
    throw new Error(`Worktree Review Explorer hook is missing or duplicated in ${target}`);
  }
}

let source = fs.readFileSync(target, "utf8");
const backup = `${target}.orig`;

if (mode === "--check") {
  verify(source);
  console.log(`verified Worktree Review Explorer pre-open patch: ${target}`);
  process.exit(0);
}

if (source.includes(mark) && mode !== "--reapply") {
  verify(source);
  console.log(`Worktree Review Explorer pre-open patch already applied: ${target}`);
  process.exit(0);
}

if (fs.existsSync(backup)) {
  const pristine = fs.readFileSync(backup, "utf8");
  if (pristine.includes(mark)) {
    throw new Error(`backup is patched: ${backup}`);
  }
  source = pristine;
  fs.writeFileSync(target, source);
} else {
  if (source.includes(mark)) {
    throw new Error(`patched without pristine backup: ${target}`);
  }
  fs.copyFileSync(target, backup);
}

const count = occurrences(source, anchor);
if (count !== 1) {
  throw new Error(`Explorer open anchor matched ${count} times in ${target}`);
}

const patched = source.replace(anchor, replacement);
verify(patched);
fs.writeFileSync(target, patched);
console.log(`patched Worktree Review Explorer pre-open: ${target}`);
JS

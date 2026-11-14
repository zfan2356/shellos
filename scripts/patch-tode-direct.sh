#!/usr/bin/env bash
set -euo pipefail
[[ "${SHELLOS_FULL_REINSTALL:-}" == 1 ]] || { echo "run the complete ShellOS reinstall" >&2; exit 1; }
MODE="${1:-}"
[[ "$MODE" != --check ]] || shift
ROOT="${1:-$HOME/.local/lib/tode}"
NODE=$(command -v node || true)
if [[ -z "$NODE" ]]; then
  for candidate in "$HOME"/.local/share/tode/code-server/*/lib/node; do
    [[ ! -x "$candidate" ]] || { NODE="$candidate"; break; }
  done
fi
"$NODE" - "$ROOT" "$MODE" <<'JS'
const fs = require("node:fs"), path = require("node:path");
const root = process.argv[2], check = process.argv[3] === "--check";
const mark = "/* shellos: direct HTTPS only v1 */";
for (const [name, anchors] of [
  ["dist/ssh.js", ["function sshOpen(runtime, target, options) {", "function sshForward(target, args) {"]],
  ["vendor/terminal-browser/cli/dist/main.js", ["async function openSshTunnel(target, status) {"]],
]) {
  const file = path.join(root, name);
  let text = fs.readFileSync(file, "utf8");
  for (const anchor of anchors) {
    const replacement = `${anchor}\n    ${mark}\n    throw new Error("SSH tunneling is disabled. Use tode-remote <host> <folder> for direct HTTPS.");`;
    if (text.includes(replacement)) continue;
    if (check || text.split(anchor).length !== 2) throw new Error("Missing direct-only guard: " + name);
    text = text.replace(anchor, replacement);
  }
  if (!check) fs.writeFileSync(file, text);
}
JS
"$NODE" --check "$ROOT/dist/ssh.js"
"$NODE" --check "$ROOT/vendor/terminal-browser/cli/dist/main.js"
echo "Direct HTTPS guards verified"

#!/usr/bin/env bash
set -euo pipefail
MODE="${1:-}"
[[ "$MODE" != --check ]] || shift
[[ "${SHELLOS_FULL_REINSTALL:-}" == 1 ]] || { echo "run the complete ShellOS reinstall" >&2; exit 1; }
ROOT="${1:-$HOME/.local/lib/tode/vendor/terminal-browser}"
NODE=$(command -v node || true)
if [[ -z "$NODE" ]]; then
  for candidate in "$HOME"/.local/share/tode/code-server/*/lib/node; do
    [[ ! -x "$candidate" ]] || { NODE="$candidate"; break; }
  done
fi
[[ -n "$NODE" ]] || { echo "node not found" >&2; exit 1; }
"$NODE" - "$ROOT" "$MODE" <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const mark = "/* shellos: parallel-startup v1 */";
const files = ["cli/dist/main.js", "browser/dist/main.js"].map((file) => path.join(process.argv[2], file));
const sources = files.map((file) => fs.readFileSync(file, "utf8"));
function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error("startup anchor changed: " + anchor);
  return source.replace(anchor, replacement);
}
if (process.argv[3] === "--check") {
  for (const source of sources) if (!source.includes(mark)) throw new Error("parallel-startup patch missing");
} else {
  if (!sources[0].includes(mark)) {
    sources[0] = replaceOnce(sources[0], "async function openHere(argv) {", `async function openHere(argv) {
  ${mark}
  const daemonReady = daemonSocket().catch(() => null);`);
    sources[0] = replaceOnce(sources[0], `  return attachHere(argv, tunnel).catch`, `  const warmed = await daemonReady;
  warmed?.destroy();
  return attachHere(argv, tunnel).catch`);
    sources[0] = replaceOnce(sources[0], "      await sleep2(200);", "      await sleep2(25);");
  }
  if (!sources[1].includes(mark)) {
    sources[1] = replaceOnce(sources[1], "var IDLE_EXIT_MS = 15e3;", `var IDLE_EXIT_MS = 15 * 60e3;`);
    sources[1] = replaceOnce(sources[1], "async function runDaemon(cdpPort) {", `async function runDaemon(cdpPort) {
  ${mark}
  import_electron9.app.on("window-all-closed", () => {});`);
  }
  for (const [index, file] of files.entries()) {
    if (!fs.existsSync(file + ".startup.orig")) fs.copyFileSync(file, file + ".startup.orig");
    fs.writeFileSync(file, sources[index]);
  }
}
console.log("parallel-startup patch verified");
JS
"$NODE" --check "$ROOT/cli/dist/main.js"
"$NODE" --check "$ROOT/browser/dist/main.js"

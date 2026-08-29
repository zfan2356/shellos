#!/usr/bin/env bash
# Bind Cmd+right-click (Ctrl+right-click on Linux) to Go Back in Tode.
set -euo pipefail

MODE="${1:-}"
if [[ -n "$MODE" && "$MODE" != "--check" && "$MODE" != "--reapply" ]]; then
  echo "usage: $0 [--check|--reapply]" >&2
  exit 2
fi

ROOT="${TODE_INSTALL_ROOT:-$HOME/.local/lib/tode}"
PRELOAD="$ROOT/dist/browser/preload.js"
MAIN="$ROOT/dist/browser/mainscript.js"
BRIDGE="$ROOT/dist/bridge/extension.js"

for file in "$PRELOAD" "$MAIN"; do
  [[ -f "$file" ]] || { echo "not found: $file" >&2; exit 1; }
done

NODE=$(command -v node || true)
if [[ -z "$NODE" ]]; then
  for candidate in "$HOME"/.local/share/tode/code-server/*/lib/node; do
    [[ -x "$candidate" ]] && NODE="$candidate" && break
  done
fi
[[ -n "$NODE" ]] || { echo "node not found" >&2; exit 1; }

"$NODE" - "$PRELOAD" "$MAIN" "$BRIDGE" "$MODE" <<'JS'
const fs = require("fs");
const [preloadPath, mainPath, bridgePath, mode] = process.argv.slice(2);
const mark = "/* shellos: cmd-right-click navigateBack v2 */";
const oldMarks = ["/* shellos: cmd-right-click navigateBack v1 */"];

function pristineSource(target) {
  const current = fs.readFileSync(target, "utf8");
  const backup = `${target}.orig`;

  if (mode === "--check") return current;
  if (current.includes(mark) && mode !== "--reapply") return current;

  if (fs.existsSync(backup)) {
    const pristine = fs.readFileSync(backup, "utf8");
    if (pristine.includes(mark) || oldMarks.some((item) => pristine.includes(item))) {
      throw new Error(`backup is patched: ${backup}`);
    }
    fs.writeFileSync(target, pristine);
    return pristine;
  }

  if (current.includes(mark) || oldMarks.some((item) => current.includes(item))) {
    throw new Error(`patched without pristine backup: ${target}`);
  }
  fs.copyFileSync(target, backup);
  return current;
}

function requireAnchor(source, anchor, target) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) {
    throw new Error(`anchor matched ${count} times in ${target}`);
  }
}

function restoreLegacyBridge() {
  if (!fs.existsSync(bridgePath)) return;
  const source = fs.readFileSync(bridgePath, "utf8");
  if (!source.includes("request.navigateBack")) return;
  if (mode === "--check") throw new Error("legacy navigateBack bridge hook remains");
  const backup = `${bridgePath}.orig`;
  if (!fs.existsSync(backup)) throw new Error(`missing pristine backup: ${backup}`);
  const pristine = fs.readFileSync(backup, "utf8");
  if (pristine.includes("request.navigateBack")) throw new Error(`backup is patched: ${backup}`);
  fs.writeFileSync(bridgePath, pristine);
}

restoreLegacyBridge();

if (mode !== "--check") {
  let preload = pristineSource(preloadPath);
  if (!preload.includes(mark)) {
    const anchor = "    if (window !== window.top)\n        return;\n    const send = () => {";
    requireAnchor(preload, anchor, preloadPath);
    preload = preload.replace(
      anchor,
      `    if (window !== window.top)
        return;
    ${mark}
    const definitionModifierHeld = (event) => {
        if (event.altKey || event.shiftKey)
            return false;
        const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
        return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    };
    const onCmdRightClick = (event) => {
        if (!definitionModifierHeld(event))
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        deliver({ type: "navigateBack" });
    };
    window.addEventListener("contextmenu", onCmdRightClick, true);
    const send = () => {`
    );
    fs.writeFileSync(preloadPath, preload);
  }

  let main = pristineSource(mainPath);
  if (!main.includes(mark)) {
    const anchor = `    ipcMain.on("tode:message", (_event, message) => {
        const timed = message;
        if (timed && timed.type === "timing" && timed.page) {
            try {
                fs.writeFileSync(ctx.timingFile, JSON.stringify(timed.page));
            }
            catch { }
            return;
        }
        const themed = message;`;
    requireAnchor(main, anchor, mainPath);
    main = main.replace(
      anchor,
      `    ipcMain.on("tode:message", (_event, message) => {
        const timed = message;
        if (timed && timed.type === "timing" && timed.page) {
            try {
                fs.writeFileSync(ctx.timingFile, JSON.stringify(timed.page));
            }
            catch { }
            return;
        }
        ${mark}
        if (message && message.type === "navigateBack") {
            try {
                _event.sender.sendInputEvent({ type: "keyDown", keyCode: "-", modifiers: ["control"] });
                _event.sender.sendInputEvent({ type: "keyUp", keyCode: "-", modifiers: ["control"] });
            }
            catch { }
            return;
        }
        const themed = message;`
    );
    fs.writeFileSync(mainPath, main);
  }
}

const preload = fs.readFileSync(preloadPath, "utf8");
const main = fs.readFileSync(mainPath, "utf8");
if (!preload.includes(mark) || !preload.includes("onCmdRightClick")) {
  throw new Error("preload patch is missing");
}
if (!main.includes(mark) || !main.includes("sendInputEvent")) {
  throw new Error("main-process patch is missing");
}
if (fs.existsSync(bridgePath) && fs.readFileSync(bridgePath, "utf8").includes("request.navigateBack")) {
  throw new Error("legacy bridge hook remains");
}
JS

"$NODE" --check "$PRELOAD"
"$NODE" --check "$MAIN"
echo "Cmd+right-click patch verified"

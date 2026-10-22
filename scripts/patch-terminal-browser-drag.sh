#!/usr/bin/env bash
# Forward Chromium drag sessions through the terminal's offscreen surface.
set -euo pipefail
MODE="${1:-}"
[[ "$MODE" != --check ]] || shift
[[ "${SHELLOS_FULL_REINSTALL:-}" == 1 ]] || { echo "run the complete ShellOS reinstall" >&2; exit 1; }
TARGET="${1:-$HOME/.local/lib/tode/vendor/terminal-browser/browser/dist/main.js}"
NODE=$(command -v node || true)
if [[ -z "$NODE" ]]; then
  for candidate in "$HOME"/.local/share/tode/code-server/*/lib/node; do
    [[ ! -x "$candidate" ]] || { NODE="$candidate"; break; }
  done
fi
[[ -n "$NODE" ]] || { echo "node not found" >&2; exit 1; }
"$NODE" - "$TARGET" "$MODE" <<'JS'
const fs = require("node:fs");
const [target, mode] = process.argv.slice(2);
const mark = "/* shellos: offscreen-drag v1 */";
let source = fs.readFileSync(target, "utf8");
function replaceOnce(anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error("drag anchor changed: " + anchor);
  source = source.replace(anchor, replacement);
}
function verify() {
  for (const marker of [mark, 'await this.cdp("Input.setInterceptDrags", { enabled: true })',
    'this.input.startDrag(params.data)', 'this.dragEvent("drop", data, pointer)']) {
    if (source.split(marker).length !== 2) throw new Error("drag patch missing or duplicated: " + marker);
  }
}
if (mode === "--check" || source.includes(mark)) {
  verify();
} else {
  replaceOnce("  pointer(event) {\n    this.syncFocus();", `  ${mark}
  dragData = null;
  dragPointer = null;
  dragQueue = Promise.resolve();
  dragEvent(type, data, pointer) {
    this.dragQueue = this.dragQueue.then(() => this.target.cdp("Input.dispatchDragEvent", {
      type, data, x: pointer.x, y: pointer.y, modifiers: pointer.modifiers
    })).catch((error) => {
      this.dragData = null;
      console.error("Offscreen drag failed:", error);
    });
  }
  startDrag(data) {
    const pointer = this.dragPointer;
    if (!pointer) return;
    this.dragData = data;
    this.dragEvent("dragEnter", data, pointer);
    this.dragEvent("dragOver", data, pointer);
    if (!this.pressed.has("left")) this.finishDrag(pointer);
  }
  finishDrag(pointer) {
    const data = this.dragData;
    this.dragData = null;
    this.dragEvent("dragOver", data, pointer);
    this.dragEvent("drop", data, pointer);
  }
  cancelDrag() {
    if (!this.dragData) return;
    const data = this.dragData;
    this.dragData = null;
    this.pressed.delete("left");
    this.dragEvent("dragCancel", data, this.dragPointer);
  }
  pointer(event) {
    this.syncFocus();`);
  replaceOnce("    for (const pressed of this.pressed) modifiers.push(`${pressed}buttondown`);", `    for (const pressed of this.pressed) modifiers.push(\`\${pressed}buttondown\`);
    this.dragPointer = { x, y, modifiers: cdpModifiers({ ...event.mods, super: this.superHeld || event.mods.super }) };
    if (this.dragData && (event.kind === "move" || (event.kind === "up" && button === "left"))) {
      if (event.kind === "move") this.dragEvent("dragOver", this.dragData, this.dragPointer);
      else {
        this.finishDrag(this.dragPointer);
        void this.dragQueue.then(() => this.send({ type: "mouseUp", x, y, button, clickCount: this.activeClickCount, modifiers }));
      }
      this.lastSentX = x;
      this.lastSentY = y;
      return;
    }`);
  replaceOnce("  releaseModifiers() {\n    this.superHeld = false;", "  releaseModifiers() {\n    this.cancelDrag();\n    this.superHeld = false;");
  replaceOnce("  releaseKeys() {\n    for (const key", "  releaseKeys() {\n    this.cancelDrag();\n    for (const key");
  replaceOnce("  key(event) {\n    this.rememberModifiers(event);", `  key(event) {
    if (event.key === "escape" && event.kind !== "release") this.cancelDrag();
    this.rememberModifiers(event);`);
  replaceOnce("      this.cdpEventHandlers.get(method)?.(params);", `      if (method === "Input.dragIntercepted") this.input.startDrag(params.data);
      this.cdpEventHandlers.get(method)?.(params);`);
  replaceOnce('    await this.cdp("Runtime.addBinding", { name: "__pixelEmit" });', `    await this.cdp("Input.setInterceptDrags", { enabled: true });
    await this.cdp("Runtime.addBinding", { name: "__pixelEmit" });`);
  verify();
  if (!fs.existsSync(target + ".drag.orig")) fs.copyFileSync(target, target + ".drag.orig");
  fs.writeFileSync(target, source);
}
console.log("offscreen drag patch verified");
JS
"$NODE" --check "$TARGET"

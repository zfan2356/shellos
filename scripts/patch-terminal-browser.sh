#!/usr/bin/env bash
# Patch tode's vendored terminal-browser to throttle offscreen rendering
# while the hosting terminal pane is unfocused.
#
# Why: terminal-browser renders the active tab at full display rate (120 Hz
# on ProMotion) for as long as the session lives, even when the terminal
# pane lost focus hours ago. A backgrounded editor that keeps changing
# (agents editing files, streaming output) therefore pumps full-rate pixel
# frames into a hidden terminal window indefinitely; on macOS that sustained
# churn — and the burst when the pane comes back — can wedge kitty's
# GL→Metal texture-upload path hard enough to stall the whole desktop.
#
# Fix: upstream already receives terminal focus events (engine "focus" →
# session onFocus → controller.setActive) but only uses them to blur input.
# This patch extends setActive to drop the active tab's webContents to 2 fps
# on focus loss and restore the normal rate on focus gain. Frames keep
# trickling while unfocused, so the terminal's last texture stays warm and
# no full-frame invalidate is needed on wake.
#
# Idempotent; keeps a .orig backup. Re-run after every tode upgrade
# (upgrades replace the install dir wholesale).
set -euo pipefail

TARGET="${1:-$HOME/.local/lib/tode/vendor/terminal-browser/browser/dist/main.js}"

if [ ! -f "$TARGET" ]; then
  echo "not found: $TARGET" >&2
  exit 1
fi

node - "$TARGET" <<'JS'
const fs = require("fs");
const target = process.argv[2];
let src = fs.readFileSync(target, "utf8");

const patchedMark = "/* shellos: unfocused-throttle */";
if (src.includes(patchedMark)) {
  console.log("already patched: " + target);
  process.exit(0);
}

const anchor = `  setActive(active) {
    if (!active) {
      this.blurContent();
      this.input.releaseModifiers();
    }
  }`;

const replacement = `  setActive(active) {
    if (!active) {
      this.blurContent();
      this.input.releaseModifiers();
    }
    ${patchedMark}
    if (this.stopped || this.framePinned) return;
    try {
      this.window.webContents.setFrameRate(active ? this.visible ? frameRate() : 4 : 2);
    } catch {
    }
  }`;

const count = src.split(anchor).length - 1;
if (count !== 1) {
  console.error(
    `anchor matched ${count} times (expected 1) — terminal-browser changed, ` +
      "re-derive the patch from browser/dist/main.js.map sources"
  );
  process.exit(1);
}

fs.copyFileSync(target, target + ".orig");
src = src.replace(anchor, replacement);
fs.writeFileSync(target, src);
console.log("patched: " + target);
console.log("backup:  " + target + ".orig");
JS

node --check "$TARGET"
echo "syntax ok — restart the tode daemon (tode --shutdown) to pick it up"

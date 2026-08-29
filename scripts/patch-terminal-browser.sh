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
# This patch extends setActive to STOP offscreen painting entirely on focus
# loss (Electron OSR stopPainting) and restore painting + one invalidate on
# focus gain. Merely lowering the frame rate is not enough: frames the
# terminal never draws (hidden window) are never consumed, so any nonzero
# rate accumulates transfer buffers for hours and the backlog wedges the
# terminal on wake. Zero frames while unfocused, one clean frame on return.
#
# Idempotent; keeps a .orig backup and migrates any older patch version by
# restoring from it first. Re-run after every tode upgrade (upgrades
# replace the install dir wholesale).
set -euo pipefail

MODE=""
if [[ "${1:-}" == "--check" ]]; then
  MODE="--check"
  shift
fi
TARGET="${1:-$HOME/.local/lib/tode/vendor/terminal-browser/browser/dist/main.js}"

if [ ! -f "$TARGET" ]; then
  echo "not found: $TARGET" >&2
  exit 1
fi

# node from PATH, or the copy code-server ships (always present next to tode)
NODE=$(command -v node || true)
if [ -z "$NODE" ]; then
  for candidate in "$HOME"/.local/share/tode/code-server/*/lib/node; do
    [ -x "$candidate" ] && NODE="$candidate" && break
  done
fi
if [ -z "$NODE" ]; then
  echo "node not found (PATH or code-server lib)" >&2
  exit 1
fi

"$NODE" - "$TARGET" "$MODE" <<'JS'
const fs = require("fs");
const target = process.argv[2];
const mode = process.argv[3];
let src = fs.readFileSync(target, "utf8");

const patchedMark = "/* shellos: unfocused-throttle v2 */";
const oldMark = "/* shellos: unfocused-throttle */";
if (mode === "--check") {
  if (!src.includes(patchedMark)) {
    console.error("unfocused-throttle v2 patch is missing: " + target);
    process.exit(1);
  }
  console.log("unfocused-throttle v2 patch verified: " + target);
  process.exit(0);
}
if (src.includes(patchedMark)) {
  console.log("already patched: " + target);
  process.exit(0);
}
if (src.includes(oldMark)) {
  const orig = fs.readFileSync(target + ".orig", "utf8");
  if (orig.includes(oldMark) || orig.includes(patchedMark)) {
    console.error(".orig backup is itself patched — reinstall tode to recover a pristine bundle");
    process.exit(1);
  }
  src = orig;
  console.log("migrating v1 patch: restored pristine source from .orig");
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
      const wc = this.window.webContents;
      if (active) {
        if (!wc.isPainting()) wc.startPainting();
        wc.setFrameRate(this.visible ? frameRate() : 4);
        if (this.visible) wc.invalidate();
      } else {
        wc.stopPainting();
      }
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

if (!fs.existsSync(target + ".orig")) fs.copyFileSync(target, target + ".orig");
src = src.replace(anchor, replacement);
fs.writeFileSync(target, src);
console.log("patched: " + target);
console.log("backup:  " + target + ".orig");
JS

"$NODE" --check "$TARGET"
echo "syntax ok — restart the tode daemon (tode --shutdown) to pick it up"

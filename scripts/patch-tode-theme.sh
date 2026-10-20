#!/usr/bin/env bash
# Keep the canonical ShellOS theme when Tode rebuilds its startup profile.
set -euo pipefail

MODE="${1:-}"
[[ "$MODE" != --check ]] || shift
[[ "${SHELLOS_FULL_REINSTALL:-}" == 1 ]] || {
  echo "run the complete ShellOS reinstall instead of patching an installation" >&2
  exit 1
}
ROOT="${1:-$HOME/.local/lib/tode}"
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
const root = process.argv[2];
const check = process.argv[3] === "--check";
const mark = "/* shellos: canonical-theme v1 */";
const patches = [
  ["theme/generate.js", "function generateTheme(palette) {", `function generateTheme(palette) {
    ${mark}
    const fs = require("node:fs");
    const path = require("node:path");
    const { DATA_DIR } = require("../runtime/paths");
    const file = path.join(DATA_DIR, "theme", "live-theme.json");
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));`],
  ["profile.js", `function installTheme(palette) {
    return installThemeJson((0, generate_1.generateTheme)(palette), (0, generate_1.paletteFingerprint)(palette));
}`, `function installTheme(palette) {
    ${mark}
    const theme = (0, generate_1.generateTheme)(palette);
    return installThemeJson(theme, (0, generate_1.themeFingerprint)(theme));
}`],
];
const pending = patches.map(([name, anchor, replacement]) => {
  const file = path.join(root, "dist", name);
  const source = fs.readFileSync(file, "utf8");
  if (source.includes(mark)) return { file, source };
  if (check) throw new Error(`canonical theme patch is missing: ${file}`);
  if (source.split(anchor).length !== 2) throw new Error(`canonical theme anchor changed: ${file}`);
  return { file, source: source.replace(anchor, replacement) };
});
if (!check) {
  for (const { file, source } of pending) fs.writeFileSync(file, source);
}
console.log("canonical theme patch verified");
JS
"$NODE" --check "$ROOT/dist/theme/generate.js"
"$NODE" --check "$ROOT/dist/profile.js"

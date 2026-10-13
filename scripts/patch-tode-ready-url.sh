#!/usr/bin/env bash
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
const mark = "/* shellos: ready-url v1 */";
function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error("ready-url anchor changed: " + anchor);
  return source.replace(anchor, replacement);
}
const files = ["main.js", "ssh.js"].map((name) => path.join(root, "dist", name));
const sources = files.map((file) => fs.readFileSync(file, "utf8"));
if (check) {
  for (const source of sources) {
    if (!source.includes(mark)) throw new Error("ready-url patch is missing");
  }
} else {
  if (!sources[0].includes(mark)) {
    sources[0] = replaceOnce(sources[0], "async function serveCommand(args) {", `async function serveCommand(args) {
    ${mark}
    if (takeBool(args, "--ready-url")) {
        const existing = await (0, server_1.currentServer)();
        if (!existing) return 1;
        const target = (0, target_1.resolveTarget)(args[0], process.cwd());
        process.stdout.write((0, target_1.workbenchUrl)((0, server_1.origin)(existing), target) + "\\n");
        return 0;
    }`);
    sources[0] = replaceOnce(sources[0], `    const unsupported = args.find((arg) => arg.startsWith("-"));`, `    const readyUrl = takeFlag(args, "--ready-url");
    if (readyUrl) {
        const parsed = new URL(readyUrl);
        if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !parsed.port || parsed.username || parsed.password)
            fail("--ready-url requires a remote loopback HTTP URL");
    }
    const unsupported = args.find((arg) => arg.startsWith("-"));`);
    sources[0] = replaceOnce(sources[0], `    const { palette } = await (0, profile_2.readPalette)();
    return (0, ssh_1.sshOpen)(runtime, target, {`, `    const { palette } = readyUrl ? {} : await (0, profile_2.readPalette)();
    return (0, ssh_1.sshOpen)(runtime, target, {
        readyUrl,`);
  }
  if (!sources[1].includes(mark)) {
    sources[1] = replaceOnce(sources[1], `    const bundle = writeBundle(options.palette, options.version, options.remotePath);`, `    ${mark}
    const bundle = options.readyUrl ? null : writeBundle(options.palette, options.version, options.remotePath);`);
    sources[1] = replaceOnce(sources[1], `        "--ssh-bundle",
        bundle,
        "--ssh-bundle-dir",
        "\${XDG_DATA_HOME:-$HOME/.local/share}/tode/bundles",`, `        ...(options.readyUrl ? [options.readyUrl] : [
            "--ssh-bundle", bundle, "--ssh-bundle-dir",
            "\${XDG_DATA_HOME:-$HOME/.local/share}/tode/bundles",
        ]),`);
  }
  for (const [index, file] of files.entries()) {
    if (!fs.existsSync(file + ".ready-url.orig")) fs.copyFileSync(file, file + ".ready-url.orig");
    fs.writeFileSync(file, sources[index]);
  }
}
console.log("ready-url patch verified");
JS
"$NODE" --check "$ROOT/dist/main.js"
"$NODE" --check "$ROOT/dist/ssh.js"

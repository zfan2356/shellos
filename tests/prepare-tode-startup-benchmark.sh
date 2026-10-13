#!/usr/bin/env bash
set -euo pipefail

work=$(mktemp -d /tmp/shellos-startup-remote.XXXXXX)
cp -a "$HOME/.local/lib/tode" "$work/install"
mkdir -p "$work/data/tode/vscode/user-data" "$work/state" "$work/project-one" "$work/project-two"
cp -a "$HOME/.local/share/tode/vscode/extensions" "$work/data/tode/vscode/"
cp -a "$HOME/.local/share/tode/vscode/user-data/User" "$work/data/tode/vscode/user-data/"
cp "$HOME/.local/share/tode/palette.json" "$work/palette.json"
export XDG_DATA_HOME="$work/data" XDG_STATE_HOME="$work/state" TODE_INSTALL_ROOT="$work/install"
export TODE_CODE_SERVER="$HOME/.local/share/tode/code-server/4.132.0/bin/code-server"
node_bin="$HOME/.local/share/tode/code-server/4.132.0/lib/node"
"$node_bin" - "$work" <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(process.argv[2], "data/tode/vscode/extensions");
const file = path.join(root, "extensions.json");
const extensions = JSON.parse(fs.readFileSync(file, "utf8"));
for (const extension of extensions) {
  if (extension.location) extension.location.path = path.join(root, extension.relativeLocation);
}
fs.writeFileSync(file, JSON.stringify(extensions));
for (const name of ["project-one", "project-two"]) {
  fs.writeFileSync(path.join(process.argv[2], name, "example.txt"), "Startup benchmark fixture\n");
}
JS
"$node_bin" "$work/install/dist/main.js" --serve --palette "$work/palette.json" "$work/project-one"
printf 'BENCHMARK_ROOT=%s\n' "$work"

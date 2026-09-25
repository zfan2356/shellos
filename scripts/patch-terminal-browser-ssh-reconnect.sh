#!/usr/bin/env bash
# Patch terminal-browser's SSH transport so a dead SOCKS master is recreated
# on the same local port. The browser keeps that port in its proxy settings,
# so preserving it lets existing WebSockets reconnect without reopening Tode.
#
# Idempotent and guarded by anchors from terminal-browser v0.14.0. It is only
# run by the complete ShellOS reinstall; never apply it to a live installation.
set -euo pipefail

MODE=""
if [[ "${1:-}" == "--check" ]]; then
  MODE="--check"
  shift
fi
REPO="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${SHELLOS_FULL_REINSTALL:-}" != 1 ]]; then
  echo "do not patch an installed artifact directly; run $REPO/scripts/reinstall-shellos.sh" >&2
  exit 1
fi
TARGET="${1:-$HOME/.local/lib/tode/vendor/terminal-browser/cli/dist/main.js}"

if [[ ! -f "$TARGET" ]]; then
  echo "not found: $TARGET" >&2
  exit 1
fi

# node from PATH, or the copy code-server ships (always present next to tode)
NODE=$(command -v node || true)
if [[ -z "$NODE" ]]; then
  for candidate in "$HOME"/.local/share/tode/code-server/*/lib/node; do
    [ -x "$candidate" ] && NODE="$candidate" && break
  done
fi
if [[ -z "$NODE" ]]; then
  echo "node not found (PATH or code-server lib)" >&2
  exit 1
fi

"$NODE" - "$TARGET" "$MODE" <<'JS'
const fs = require("fs");
const target = process.argv[2];
const mode = process.argv[3];
let src = fs.readFileSync(target, "utf8");

const patchedMark = "/* shellos: ssh-tunnel-reconnect v1 */";
if (mode === "--check") {
  if (!src.includes(patchedMark)) {
    console.error("ssh-tunnel-reconnect v1 patch is missing: " + target);
    process.exit(1);
  }
  console.log("ssh-tunnel-reconnect v1 patch verified: " + target);
  process.exit(0);
}
if (src.includes(patchedMark)) {
  console.log("already patched: " + target);
  process.exit(0);
}

const startAnchor = "async function openSshTunnel(target, status) {";
const endAnchor = "\nfunction validateBundleDir(dir) {";
const starts = src.split(startAnchor).length - 1;
const ends = src.split(endAnchor).length - 1;
if (starts !== 1 || ends !== 1) {
  console.error(
    `SSH tunnel anchors matched ${starts}/${ends} times (expected 1/1) — ` +
      "terminal-browser changed; re-derive the patch from cli/dist/main.js.map sources",
  );
  process.exit(1);
}
const start = src.indexOf(startAnchor);
const end = src.indexOf(endAnchor, start);
const original = src.slice(start, end);
for (const required of [
  '    "-f",\n    "-N",\n    "-M",',
  'const child = (0, import_node_child_process6.spawn)("ssh", args, { stdio: "inherit" });',
  "await waitForSocks(socksPort, destination);",
  'spawnSync)("ssh", ["-S", controlPath, "-O", "exit", destination]',
]) {
  if (!original.includes(required)) {
    console.error(
      `required SSH implementation fragment is missing (${JSON.stringify(required)}) — ` +
        "terminal-browser changed; re-derive the patch",
    );
    process.exit(1);
  }
}

async function shellosOpenSshTunnel(target, status) {
  /* shellos: ssh-tunnel-reconnect v1 */
  const { destination, hostArgs, aliasCommand } = resolveSshTarget(target);
  if (aliasCommand) status(`${target} is an alias for ssh ${aliasCommand}`);
  const controlPath = freshControlPath();
  const socksPort = await freePort();
  const args = [
    "-f",
    "-N",
    "-M",
    "-S",
    controlPath,
    "-D",
    `127.0.0.1:${socksPort}`,
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ConnectTimeout=15",
    ...hostArgs,
    destination,
  ];
  let stopped = false;
  let reconnecting = false;
  let retryTimer = null;

  const removeControlSocket = () => {
    try {
      import_node_fs12.default.unlinkSync(controlPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  };
  const closeMaster = () => {
    try {
      (0, import_node_child_process6.spawnSync)(
        "ssh",
        ["-S", controlPath, "-O", "exit", destination],
        { stdio: "ignore", timeout: 5e3 },
      );
    } catch {
    }
  };
  const startMaster = async () => {
    removeControlSocket();
    const code = await new Promise((resolve, reject) => {
      const child = (0, import_node_child_process6.spawn)("ssh", args, { stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (exitCode) => resolve(exitCode ?? 1));
    });
    if (code !== 0) throw new Error(`ssh to ${destination} failed`);
    await waitForSocks(socksPort, destination);
  };
  const pause = (ms) =>
    new Promise((resolve) => {
      retryTimer = setTimeout(resolve, ms);
    });

  status(`connecting to ${destination}`);
  await startMaster();
  status(`connected ${destination}`);

  const ensureConnected = async () => {
    if (stopped || reconnecting) return;
    const check = (0, import_node_child_process6.spawnSync)(
      "ssh",
      ["-S", controlPath, "-O", "check", destination],
      { stdio: "ignore", timeout: 5e3 },
    );
    if (check.status === 0 || stopped) return;
    try {
      await waitForSocks(socksPort, destination);
      return;
    } catch {
    }
    reconnecting = true;
    status(`connection to ${destination} lost; reconnecting`);
    let delay = 1e3;
    while (!stopped) {
      try {
        await startMaster();
        if (stopped) {
          closeMaster();
          removeControlSocket();
          break;
        }
        status(`reconnected ${destination}`);
        reconnecting = false;
        return;
      } catch (error) {
        if (stopped) break;
        const reason = error instanceof Error ? error.message : String(error);
        status(`reconnect failed (${reason}); retrying in ${Math.round(delay / 1e3)}s`);
        await pause(delay);
        delay = Math.min(delay * 2, 15e3);
      }
    }
    reconnecting = false;
  };
  const watcher = setInterval(() => void ensureConnected(), 5e3);
  watcher.unref?.();

  return {
    destination,
    socksPort,
    controlPath,
    stop: () => {
      stopped = true;
      clearInterval(watcher);
      if (retryTimer) clearTimeout(retryTimer);
      closeMaster();
      try {
        removeControlSocket();
      } catch {
      }
    },
  };
}

const replacement = shellosOpenSshTunnel
  .toString()
  .replace("shellosOpenSshTunnel", "openSshTunnel");
if (!fs.existsSync(target + ".orig")) fs.copyFileSync(target, target + ".orig");
src = src.slice(0, start) + replacement + src.slice(end);
fs.writeFileSync(target, src);
console.log("patched: " + target);
console.log("backup:  " + target + ".orig");
JS

"$NODE" --check "$TARGET"
echo "syntax ok — restart the tode daemon (tode --shutdown) to pick it up"

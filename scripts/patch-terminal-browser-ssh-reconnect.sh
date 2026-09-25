#!/usr/bin/env bash
# Patch terminal-browser's SSH transport and browser session together:
# recreate a dead SOCKS master on the same port, tell the owning browser
# session to discard stale connections and reload, isolate concurrent SSH
# windows from each other's proxies, and keep an emergency quit chord.
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
CLI_TARGET="${1:-$HOME/.local/lib/tode/vendor/terminal-browser/cli/dist/main.js}"
BROWSER_TARGET="${2:-$(cd "$(dirname "$CLI_TARGET")/../../browser/dist" 2>/dev/null && pwd)/main.js}"

for target in "$CLI_TARGET" "$BROWSER_TARGET"; do
  if [[ ! -f "$target" ]]; then
    echo "not found: $target" >&2
    exit 1
  fi
done

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

"$NODE" - "$CLI_TARGET" "$BROWSER_TARGET" "$MODE" <<'JS'
const fs = require("fs");
const cliTarget = process.argv[2];
const browserTarget = process.argv[3];
const mode = process.argv[4];
const patchedMark = "/* shellos: ssh-tunnel-reconnect v2 */";

function occurrences(src, value) {
  return src.split(value).length - 1;
}

function replaceOnce(src, anchor, replacement, label) {
  const count = occurrences(src, anchor);
  if (count !== 1) {
    console.error(
      `${label} anchor matched ${count} times (expected 1) — ` +
        "terminal-browser changed; re-derive the patch from dist source maps",
    );
    process.exit(1);
  }
  return src.replace(anchor, replacement);
}

function verify(src, target) {
  if (!src.includes(patchedMark)) {
    console.error("ssh-tunnel-reconnect v2 patch is missing: " + target);
    process.exit(1);
  }
}

let cli = fs.readFileSync(cliTarget, "utf8");
let browser = fs.readFileSync(browserTarget, "utf8");
if (mode === "--check") {
  verify(cli, cliTarget);
  verify(browser, browserTarget);
  console.log("ssh-tunnel-reconnect v2 patch verified: " + cliTarget);
  console.log("ssh-tunnel-reconnect v2 patch verified: " + browserTarget);
  process.exit(0);
}

if (!cli.includes(patchedMark)) {
  const startAnchor = "async function openSshTunnel(target, status) {";
  const endAnchor = "\nfunction validateBundleDir(dir) {";
  const starts = occurrences(cli, startAnchor);
  const ends = occurrences(cli, endAnchor);
  if (starts !== 1 || ends !== 1) {
    console.error(
      `SSH tunnel anchors matched ${starts}/${ends} times (expected 1/1) — ` +
        "terminal-browser changed; re-derive the patch from cli/dist/main.js.map sources",
    );
    process.exit(1);
  }
  const start = cli.indexOf(startAnchor);
  const end = cli.indexOf(endAnchor, start);
  const original = cli.slice(start, end);
  for (const required of [
    '    "-f",\n    "-N",\n    "-M",',
    'const child = (0, import_node_child_process6.spawn)("ssh", args, { stdio: "inherit" });',
    "await waitForSocks(socksPort, destination);",
    '["-S", controlPath, "-O", "exit", destination]',
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
    /* shellos: ssh-tunnel-reconnect v2 */
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
    let reconnectListener = null;
    let pendingRecovery = false;

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
    const notifyReconnect = () => {
      if (reconnectListener) reconnectListener();
      else pendingRecovery = true;
    };

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
      reconnecting = true;
      try {
        await waitForSocks(socksPort, destination);
        reconnecting = false;
        return;
      } catch {
      }
      if (stopped) {
        reconnecting = false;
        return;
      }
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
          status(`transport restored for ${destination}; reloading editor`);
          notifyReconnect();
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
      onReconnect: (listener) => {
        if (stopped) return;
        reconnectListener = listener;
        if (pendingRecovery) {
          pendingRecovery = false;
          reconnectListener();
        }
      },
      recoveryComplete: () => status(`reconnected ${destination}`),
      recoveryFailed: (reason) =>
        status(`editor recovery failed (${reason}); press Ctrl+Shift+Q to close it`),
      stop: () => {
        stopped = true;
        reconnectListener = null;
        pendingRecovery = false;
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
  cli = cli.slice(0, start) + replacement + cli.slice(end);

  cli = replaceOnce(
    cli,
    "async function attachHere(argv) {",
    "async function attachHere(argv, tunnel) {",
    "CLI attachHere signature",
  );
  cli = replaceOnce(
    cli,
    `  nextReply(socket, (message) => {
    if (message.event === "closed") process.exit(message.code ?? 0);
  });`,
    `  nextReply(socket, (message) => {
    if (message.event === "closed") process.exit(message.code ?? 0);
    else if (message.event === "proxy-recovered") tunnel?.recoveryComplete();
    else if (message.event === "proxy-recovery-failed") {
      tunnel?.recoveryFailed(message.error ?? "unknown browser error");
    }
  });
  tunnel?.onReconnect(() => {
    try {
      if (socket.destroyed) throw new Error("browser session is closed");
      socket.write('{"cmd":"proxy-reconnected"}\\n');
    } catch (error) {
      tunnel.recoveryFailed(error instanceof Error ? error.message : String(error));
    }
  });`,
    "CLI reconnect notification",
  );
  cli = replaceOnce(
    cli,
    `async function openHere(argv) {
  await sshSetup(argv).catch(
    (error) => fail(error instanceof Error ? error.message : String(error))
  );
  return attachHere(argv).catch((error) => fail(\`could not start the browser: \${String(error)}\`));
}`,
    `async function openHere(argv) {
  const tunnel = await sshSetup(argv).catch(
    (error) => fail(error instanceof Error ? error.message : String(error))
  );
  return attachHere(argv, tunnel).catch((error) => fail(\`could not start the browser: \${String(error)}\`));
}`,
    "CLI openHere tunnel handoff",
  );
  cli = replaceOnce(
    cli,
    `  for (const signal of signals) process.removeListener(signal, interrupt);
}
var DIRECTIONS`,
    `  for (const signal of signals) process.removeListener(signal, interrupt);
  return tunnel;
}
var DIRECTIONS`,
    "CLI sshSetup return",
  );
}

if (!browser.includes(patchedMark)) {
  browser = replaceOnce(
    browser,
    `function createSession(ctx) {
  const session2 = new Session(ctx);`,
    `function createSession(ctx) {
  /* shellos: ssh-tunnel-reconnect v2 */
  const session2 = new Session(ctx);`,
    "browser patch marker",
  );
  browser = replaceOnce(
    browser,
    `    close: (code = 0) => session2.shutdown(code),
    nudgeResize: () => session2.nudgeResize()
  };`,
    `    close: (code = 0) => session2.shutdown(code),
    nudgeResize: () => session2.nudgeResize(),
    recoverProxy: () => session2.recoverProxy()
  };`,
    "browser recoverProxy export",
  );
  browser = replaceOnce(
    browser,
    `function persistentPartition(partition) {
  return partition.startsWith("persist:") ? partition : \`persist:\${partition}\`;
}`,
    `function persistentPartition(partition) {
  if (partition.startsWith("shellos-ephemeral-ssh-")) return partition;
  return partition.startsWith("persist:") ? partition : \`persist:\${partition}\`;
}`,
    "browser ephemeral SSH partition",
  );
  browser = replaceOnce(
    browser,
    `    this.partition = flagValue(this.argv, "--partition") ?? (sshTarget ? \`ssh-\${sshTarget.replace(/[^A-Za-z0-9@._-]/g, "-")}\` : null);`,
    `    this.partition = flagValue(this.argv, "--partition") ?? (sshTarget ? \`shellos-ephemeral-ssh-\${ctx.key}\` : null);`,
    "browser per-window SSH partition",
  );
  browser = replaceOnce(
    browser,
    `  async start() {
    if (this.socksPort) await routeThroughSocksProxy(this.partition, this.socksPort);`,
    `  async recoverProxy() {
    if (!this.socksPort || this.shuttingDown) return;
    await routeThroughSocksProxy(this.partition, this.socksPort);
    const target = browserSession(this.partition);
    await target.closeAllConnections();
    this.tabs.eachController((controller) => {
      controller.window.webContents.stop();
      controller.window.webContents.reload();
    });
  }
  async start() {
    if (this.socksPort) await routeThroughSocksProxy(this.partition, this.socksPort);`,
    "browser session proxy recovery",
  );
  browser = replaceOnce(
    browser,
    `      const quitKey = event.key === "q" || process.platform === "darwin" && event.key === "c";
      if (!this.noShortcuts && event.mods.ctrl && quitKey) {
        this.shutdown();`,
    `      const quitKey = event.key === "q" || process.platform === "darwin" && event.key === "c";
      const emergencyQuit = event.mods.ctrl && event.mods.shift && event.key === "q";
      if (emergencyQuit || !this.noShortcuts && event.mods.ctrl && quitKey) {
        this.shutdown();`,
    "browser emergency quit chord",
  );
  browser = replaceOnce(
    browser,
    `        } else if (message.cmd === "resize") {
          session2?.nudgeResize();
        } else if (message.cmd === "close") {`,
    `        } else if (message.cmd === "proxy-reconnected") {
          if (!session2) {
            reply({ event: "proxy-recovery-failed", error: "browser session is not open" });
          } else {
            void session2.recoverProxy().then(
              () => reply({ event: "proxy-recovered" }),
              (error) => reply({
                event: "proxy-recovery-failed",
                error: error instanceof Error ? error.message : String(error)
              })
            );
          }
        } else if (message.cmd === "resize") {
          session2?.nudgeResize();
        } else if (message.cmd === "close") {`,
    "browser reconnect command",
  );
}

if (!fs.existsSync(cliTarget + ".orig")) fs.copyFileSync(cliTarget, cliTarget + ".orig");
if (!fs.existsSync(browserTarget + ".ssh-reconnect.orig")) {
  fs.copyFileSync(browserTarget, browserTarget + ".ssh-reconnect.orig");
}
fs.writeFileSync(cliTarget, cli);
fs.writeFileSync(browserTarget, browser);
console.log("patched: " + cliTarget);
console.log("patched: " + browserTarget);
console.log("backup:  " + cliTarget + ".orig");
console.log("backup:  " + browserTarget + ".ssh-reconnect.orig");
JS

"$NODE" --check "$CLI_TARGET"
"$NODE" --check "$BROWSER_TARGET"
echo "syntax ok — restart the tode daemon (tode --shutdown) to pick it up"

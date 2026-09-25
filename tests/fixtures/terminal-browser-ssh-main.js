const { EventEmitter } = require("node:events");

const state = globalThis.__sshTestState;
const import_node_child_process6 = {
  spawn(command, args, options) {
    state.spawns.push({ command, args, options });
    state.socksUp = true;
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  },
  spawnSync(command, args, options) {
    state.syncs.push({ command, args, options });
    if (args.includes("check")) return { status: state.masterUp ? 0 : 255 };
    if (args.includes("exit")) {
      state.masterUp = false;
      state.socksUp = false;
      return { status: 0 };
    }
    return { status: 0 };
  },
};
const import_node_fs12 = {
  default: {
    unlinkSync(value) {
      state.unlinked.push(value);
    },
  },
};

function resolveSshTarget(target) {
  return { destination: target, hostArgs: ["-p", "22"], aliasCommand: null };
}
function freshControlPath() {
  return "/tmp/tb-ssh/test-control";
}
async function freePort() {
  return 43123;
}
async function waitForSocks() {
  if (!state.socksUp) throw new Error("proxy is down");
}

async function openSshTunnel(target, status) {
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
    ...hostArgs,
    destination
  ];
  status(`connecting to ${destination}`);
  const code = await new Promise((resolve, reject) => {
    const child = (0, import_node_child_process6.spawn)("ssh", args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) throw new Error(`ssh to ${destination} failed`);
  await waitForSocks(socksPort, destination);
  status(`connected ${destination}`);
  return {
    destination,
    socksPort,
    controlPath,
    stop: () => {
      try {
        (0, import_node_child_process6.spawnSync)("ssh", ["-S", controlPath, "-O", "exit", destination], {
          stdio: "ignore",
          timeout: 5e3
        });
      } catch {
      }
    }
  };
}
function validateBundleDir(dir) {
  return dir;
}

module.exports = { openSshTunnel };

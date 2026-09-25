const { EventEmitter } = require("node:events");

const state = globalThis.__sshTestState;
const import_node_child_process6 = {
  spawn(command, args, options) {
    state.spawns.push({ command, args, options });
    state.masterUp = true;
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

function nextReply(socket, onLine) {
  socket.on("reply", onLine);
}
async function openSession() {
  return { socket: state.sessionSocket, reply: { ok: true, session: "test-session" } };
}
function ownTtyPath() {
  return "/dev/tty-test";
}
function fail(message) {
  throw new Error(message);
}
async function attachHere(argv) {
  const tty = ownTtyPath();
  if (!tty) throw new Error("not running on a tty");
  const { socket, reply } = await openSession(argv, tty);
  if (reply.ok === false || !reply.session) {
    socket.destroy();
    throw new Error(reply.error ?? "daemon refused the session");
  }
  nextReply(socket, (message) => {
    if (message.event === "closed") process.exit(message.code ?? 0);
  });
  socket.on("close", () => process.exit(0));
  socket.on("error", () => process.exit(1));
  process.on("SIGWINCH", () => {
    try {
      socket.write('{"cmd":"resize"}\n');
    } catch {
    }
  });
  const requestClose = () => {
    try {
      socket.write('{"cmd":"close"}\n');
    } catch {
      process.exit(0);
    }
    setTimeout(() => process.exit(0), 2e3);
  };
  process.on("SIGINT", requestClose);
  process.on("SIGTERM", requestClose);
  process.on("SIGHUP", requestClose);
  return new Promise(() => {
  });
}
async function openHere(argv) {
  await sshSetup(argv).catch(
    (error) => fail(error instanceof Error ? error.message : String(error))
  );
  return attachHere(argv).catch((error) => fail(`could not start the browser: ${String(error)}`));
}
function flagEq(argv, flag) {
  return argv.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
}
async function startBundle() {
  return { url: "http://127.0.0.1:12345", stop() {} };
}
async function sshSetup(argv) {
  const target = flagEq(argv, "--ssh");
  if (!target) return;
  const status = (line) => process.stdout.write(`ssh: ${line}
`);
  const interrupt = () => process.exit(130);
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, interrupt);
  let bundle = null;
  const tunnel = await openSshTunnel(target, status);
  process.on("exit", () => {
    try {
      bundle?.stop();
    } catch {
    }
    tunnel.stop();
  });
  argv.push(`--socks-port=${tunnel.socksPort}`);
  const bundleDir = flagEq(argv, "--ssh-bundle");
  if (bundleDir) {
    const remoteBase = flagEq(argv, "--ssh-bundle-dir");
    bundle = await startBundle(tunnel, bundleDir, status, remoteBase || void 0);
    if (!argv.some((arg) => !arg.startsWith("-"))) argv.unshift(bundle.url);
  }
  for (const signal of signals) process.removeListener(signal, interrupt);
}
var DIRECTIONS = ["right", "left", "down", "up"];

module.exports = { attachHere, openHere, openSshTunnel, sshSetup };

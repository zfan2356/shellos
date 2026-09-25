const state = globalThis.__sshBrowserTestState;

const targetSession = {
  async setProxy(config) {
    state.proxyCalls.push(config);
  },
  async closeAllConnections() {
    state.closeCalls += 1;
  },
};
const import_electron = {
  app: { on() {} },
  session: {
    defaultSession: targetSession,
    fromPartition(name) {
      state.partitions.push(name);
      return targetSession;
    },
  },
};
const socksProxied = new WeakSet();
let webrtcGuardInstalled = false;
async function routeThroughSocksProxy(partition, port) {
  const target = browserSession(partition);
  socksProxied.add(target);
  if (!webrtcGuardInstalled) {
    webrtcGuardInstalled = true;
    import_electron.app.on("web-contents-created", (_event, contents) => {
      if (socksProxied.has(contents.session)) {
        contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
      }
    });
  }
  await target.setProxy({
    proxyRules: `socks5://127.0.0.1:${port}`,
    proxyBypassRules: "<-loopback>"
  });
}
function browserSession(partition) {
  return partition ? import_electron.session.fromPartition(persistentPartition(partition)) : import_electron.session.defaultSession;
}
function persistentPartition(partition) {
  return partition.startsWith("persist:") ? partition : `persist:${partition}`;
}

function createSession(ctx) {
  const session2 = new Session(ctx);
  const ready = session2.start().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}
`);
    session2.shutdown(1);
  });
  return {
    ready,
    close: (code = 0) => session2.shutdown(code),
    nudgeResize: () => session2.nudgeResize()
  };
}
function flagValue(argv, flag) {
  return argv.find((argument) => argument.startsWith(`${flag}=`))?.slice(flag.length + 1) ?? null;
}
class Session {
  constructor(ctx) {
    this.ctx = ctx;
    this.argv = ctx.argv;
    this.shuttingDown = false;
    this.noShortcuts = true;
    const sshTarget = flagValue(this.argv, "--ssh");
    const socksPort = Number(flagValue(this.argv, "--socks-port"));
    this.socksPort = Number.isInteger(socksPort) && socksPort > 0 ? socksPort : null;
    this.partition = flagValue(this.argv, "--partition") ?? (sshTarget ? `ssh-${sshTarget.replace(/[^A-Za-z0-9@._-]/g, "-")}` : null);
    this.tabs = {
      eachController(fn) {
        for (const controller of state.controllers) fn(controller);
      },
    };
  }
  async start() {
    if (this.socksPort) await routeThroughSocksProxy(this.partition, this.socksPort);
  }
  nudgeResize() {
    state.resizes += 1;
  }
  shutdown() {
    this.shuttingDown = true;
    state.shutdowns += 1;
  }
  handleKey(event) {
    if (event.kind !== "release") {
      const quitKey = event.key === "q" || process.platform === "darwin" && event.key === "c";
      if (!this.noShortcuts && event.mods.ctrl && quitKey) {
        this.shutdown();
        return;
      }
    }
  }
}

function handleMessage(message, session2, reply) {
        if (message.cmd === "open" && !session2) {
          return;
        } else if (message.cmd === "resize") {
          session2?.nudgeResize();
        } else if (message.cmd === "close") {
          session2?.close();
        }
}

module.exports = { createSession, handleMessage, persistentPartition, Session };

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");

const fixture = path.resolve(process.argv[2]);
const intervals = [];
globalThis.__sshTestState = {
  spawns: [],
  syncs: [],
  unlinked: [],
  masterUp: true,
  socksUp: false,
  sessionSocket: Object.assign(new EventEmitter(), {
    destroyed: false,
    writes: [],
    write(value) {
      this.writes.push(value);
    },
    destroy() {
      this.destroyed = true;
    },
  }),
};
globalThis.setInterval = (callback, delay) => {
  const timer = { callback, delay, cleared: false, unref() {} };
  intervals.push(timer);
  return timer;
};
globalThis.clearInterval = (timer) => {
  timer.cleared = true;
};

const { attachHere, openSshTunnel, sshSetup } = require(fixture);
const state = globalThis.__sshTestState;
const statuses = [];
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

(async () => {
  const tunnel = await openSshTunnel("cvm", (line) => statuses.push(line));
  assert.equal(tunnel.socksPort, 43123);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, 5000);
  assert.equal(state.spawns.length, 1);
  assert.ok(state.spawns[0].args.includes("ConnectTimeout=15"));
  void attachHere([], tunnel);
  await flush();
  assert.deepEqual(state.sessionSocket.writes, [], "initial connection must not reload the browser");

  const firstDynamic = state.spawns[0].args[state.spawns[0].args.indexOf("-D") + 1];
  state.masterUp = false;
  state.socksUp = false;
  intervals[0].callback();
  intervals[0].callback();
  await flush();

  assert.equal(state.spawns.length, 2, "dead SSH master should be restarted");
  const secondDynamic = state.spawns[1].args[state.spawns[1].args.indexOf("-D") + 1];
  assert.equal(secondDynamic, firstDynamic, "reconnect must preserve the browser proxy port");
  assert.ok(statuses.includes("connection to cvm lost; reconnecting"));
  assert.ok(statuses.includes("transport restored for cvm; reloading editor"));
  assert.deepEqual(
    state.sessionSocket.writes,
    ['{"cmd":"proxy-reconnected"}\n'],
    "one transport recovery must notify the browser exactly once",
  );
  state.sessionSocket.emit("reply", { event: "proxy-recovered" });
  assert.ok(statuses.includes("reconnected cvm"));
  state.sessionSocket.emit("reply", { event: "proxy-recovery-failed", error: "reload failed" });
  assert.ok(
    statuses.includes("editor recovery failed (reload failed); press Ctrl+Shift+Q to close it"),
  );

  tunnel.stop();
  assert.equal(intervals[0].cleared, true);
  const spawnCount = state.spawns.length;
  intervals[0].callback();
  await flush();
  assert.equal(state.spawns.length, spawnCount, "a stopped tunnel must not reconnect");

  const pendingStatuses = [];
  const pendingTunnel = await openSshTunnel("cvm", (line) => pendingStatuses.push(line));
  state.masterUp = false;
  state.socksUp = false;
  intervals[1].callback();
  await flush();

  const pendingSocket = Object.assign(new EventEmitter(), {
    destroyed: false,
    writes: [],
    write(value) {
      this.writes.push(value);
    },
    destroy() {
      this.destroyed = true;
    },
  });
  state.sessionSocket = pendingSocket;
  void attachHere([], pendingTunnel);
  await flush();
  assert.deepEqual(
    pendingSocket.writes,
    ['{"cmd":"proxy-reconnected"}\n'],
    "recovery before browser attachment must be delivered when the session appears",
  );
  pendingTunnel.stop();

  const stoppedTunnel = await openSshTunnel("cvm", () => {});
  state.masterUp = false;
  state.socksUp = false;
  intervals[2].callback();
  await flush();
  stoppedTunnel.stop();
  let stoppedNotifications = 0;
  stoppedTunnel.onReconnect(() => {
    stoppedNotifications += 1;
  });
  assert.equal(stoppedNotifications, 0, "stopping clears an undelivered recovery notification");

  const argv = ["--ssh=cvm"];
  const setupTunnel = await sshSetup(argv);
  assert.equal(setupTunnel.socksPort, 43123, "sshSetup must return the tunnel to openHere");
  assert.ok(argv.includes("--socks-port=43123"));
  setupTunnel.stop();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

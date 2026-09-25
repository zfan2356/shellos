const assert = require("node:assert/strict");
const path = require("node:path");

const fixture = path.resolve(process.argv[2]);
const intervals = [];
globalThis.__sshTestState = {
  spawns: [],
  syncs: [],
  unlinked: [],
  masterUp: true,
  socksUp: false,
};
globalThis.setInterval = (callback, delay) => {
  const timer = { callback, delay, cleared: false, unref() {} };
  intervals.push(timer);
  return timer;
};
globalThis.clearInterval = (timer) => {
  timer.cleared = true;
};

const { openSshTunnel } = require(fixture);
const state = globalThis.__sshTestState;
const statuses = [];

(async () => {
  const tunnel = await openSshTunnel("cvm", (line) => statuses.push(line));
  assert.equal(tunnel.socksPort, 43123);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, 5000);
  assert.equal(state.spawns.length, 1);
  assert.ok(state.spawns[0].args.includes("ConnectTimeout=15"));

  const firstDynamic = state.spawns[0].args[state.spawns[0].args.indexOf("-D") + 1];
  state.masterUp = false;
  state.socksUp = false;
  intervals[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(state.spawns.length, 2, "dead SSH master should be restarted");
  const secondDynamic = state.spawns[1].args[state.spawns[1].args.indexOf("-D") + 1];
  assert.equal(secondDynamic, firstDynamic, "reconnect must preserve the browser proxy port");
  assert.ok(statuses.includes("connection to cvm lost; reconnecting"));
  assert.ok(statuses.includes("reconnected cvm"));

  tunnel.stop();
  assert.equal(intervals[0].cleared, true);
  const spawnCount = state.spawns.length;
  intervals[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.spawns.length, spawnCount, "a stopped tunnel must not reconnect");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

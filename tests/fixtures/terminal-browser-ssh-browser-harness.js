const assert = require("node:assert/strict");
const path = require("node:path");

const fixture = path.resolve(process.argv[2]);
const controllerEvents = [];
globalThis.__sshBrowserTestState = {
  closeCalls: 0,
  controllers: [
    {
      window: {
        webContents: {
          stop() {
            controllerEvents.push("stop:first");
          },
          reload() {
            controllerEvents.push("reload:first");
          },
        },
      },
    },
    {
      window: {
        webContents: {
          stop() {
            controllerEvents.push("stop:second");
          },
          reload() {
            controllerEvents.push("reload:second");
          },
        },
      },
    },
  ],
  partitions: [],
  proxyCalls: [],
  resizes: 0,
  shutdowns: 0,
};

const { createSession, handleMessage, persistentPartition, Session, partitionSessions } = require(fixture);
const state = globalThis.__sshBrowserTestState;
const flush = () => new Promise((resolve) => setImmediate(resolve));

(async () => {
  const first = createSession({
    key: "window-one",
    argv: ["--ssh=CVM", "--socks-port=43123"],
    onClose() {},
  });
  const second = createSession({
    key: "window-two",
    argv: ["--ssh=CVM", "--socks-port=43124"],
    onClose() {},
  });
  await Promise.all([first.ready, second.ready]);

  const [firstPartition, secondPartition] = [...new Set(state.partitions)];
  assert.notEqual(firstPartition, secondPartition);
  assert.ok(
    state.partitions.every((name) => name.startsWith("persist:shellos-ssh-")),
    "SSH windows must retain their Electron disk caches",
  );
  assert.equal(
    persistentPartition(firstPartition),
    firstPartition,
    "the BrowserWindow must use the same persistent partition as its proxy session",
  );
  assert.equal(persistentPartition("profile"), "persist:profile");
  assert.deepEqual(
    state.proxyCalls.map((call) => call.proxyRules),
    ["socks5://127.0.0.1:43123", "socks5://127.0.0.1:43124"],
    "each window must keep its own SOCKS port",
  );

  const replies = [];
  handleMessage({ cmd: "proxy-reconnected" }, first, (reply) => replies.push(reply));
  await flush();
  assert.deepEqual(replies, [{ event: "proxy-recovered" }]);
  assert.equal(state.closeCalls, 3, "startup and recovery must discard Chromium's stale connections");
  assert.deepEqual(controllerEvents, ["stop:first", "reload:first", "stop:second", "reload:second"]);
  assert.equal(state.proxyCalls.at(-1).proxyRules, "socks5://127.0.0.1:43123");

  const missingReplies = [];
  handleMessage({ cmd: "proxy-reconnected" }, null, (reply) => missingReplies.push(reply));
  assert.deepEqual(missingReplies, [
    { event: "proxy-recovery-failed", error: "browser session is not open" },
  ]);

  first.close();
  const overlapping = new Session({ key: "overlapping", argv: ["--ssh=CVM"], onClose() {} });
  assert.notEqual(overlapping.partition, firstPartition, "teardown must finish before reuse");
  await flush();
  const reused = new Session({ key: "reused", argv: ["--ssh=CVM", "--socks-port=43125"], onClose() {} });
  assert.equal(reused.partition, firstPartition, "closed windows must release reusable cache slots");
  await reused.start();
  assert.equal(state.proxyCalls.at(-1).proxyRules, "socks5://127.0.0.1:43125");
  assert.equal(partitionSessions.get(secondPartition).proxy, "socks5://127.0.0.1:43124");
  let unblockProxy;
  state.proxyGate = new Promise((resolve) => { unblockProxy = resolve; });
  const recovery = reused.recoverProxy();
  await flush();
  reused.shutdown();
  await flush();
  const duringRecovery = new Session({ key: "during-recovery", argv: ["--ssh=CVM"], onClose() {} });
  assert.notEqual(duringRecovery.partition, firstPartition, "pending recovery must retain its lease");
  const reloadsBefore = controllerEvents.length;
  unblockProxy();
  await recovery;
  await flush();
  state.proxyGate = null;
  assert.equal(controllerEvents.length, reloadsBefore, "shutdown must prevent late editor reloads");
  const afterRecovery = new Session({ key: "after-recovery", argv: ["--ssh=CVM"], onClose() {} });
  assert.equal(afterRecovery.partition, firstPartition);
  const failed = new Session({ key: "failed", argv: ["--ssh=failing-host", "--socks-port=43126"], onClose() {} });
  state.failProxy = true;
  await assert.rejects(failed.start(), /proxy setup failed/);
  failed.shutdown(1);
  await flush();
  state.failProxy = false;
  const retry = new Session({ key: "retry", argv: ["--ssh=failing-host"], onClose() {} });
  assert.equal(retry.partition, failed.partition, "failed startup must release its lease");
  const otherHost = new Session({ key: "other", argv: ["--ssh=other-host"], onClose() {} });
  assert.notEqual(otherHost.partition, firstPartition, "hosts must not share cached editor state");
  const punctuation = new Session({ key: "punctuation", argv: ["--ssh=other/host"], onClose() {} });
  assert.notEqual(punctuation.partition, otherHost.partition, "host names must not collapse when sanitized");
  const explicit = new Session({ key: "explicit", argv: ["--ssh=CVM", "--partition=chosen"], onClose() {} });
  assert.equal(explicit.partition, "chosen");
  const keyboardSession = new Session({ key: "keyboard", argv: [], onClose() {} });
  assert.equal(keyboardSession.partition, null);
  const shutdownsBefore = state.shutdowns;
  keyboardSession.handleKey({ kind: "press", key: "q", mods: { ctrl: true, shift: false } });
  assert.equal(state.shutdowns, shutdownsBefore, "app mode should keep ordinary Ctrl+Q disabled");
  keyboardSession.handleKey({ kind: "press", key: "q", mods: { ctrl: true, shift: true } });
  assert.equal(
    state.shutdowns,
    shutdownsBefore + 1,
    "Ctrl+Shift+Q must close the session even when app shortcuts are disabled",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

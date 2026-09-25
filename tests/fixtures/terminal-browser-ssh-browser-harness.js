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

const { createSession, handleMessage, persistentPartition, Session } = require(fixture);
const state = globalThis.__sshBrowserTestState;
const flush = () => new Promise((resolve) => setImmediate(resolve));

(async () => {
  const first = createSession({
    key: "window-one",
    argv: ["--ssh=CVM", "--socks-port=43123"],
  });
  const second = createSession({
    key: "window-two",
    argv: ["--ssh=CVM", "--socks-port=43124"],
  });
  await Promise.all([first.ready, second.ready]);

  assert.ok(state.partitions.includes("shellos-ephemeral-ssh-window-one"));
  assert.ok(state.partitions.includes("shellos-ephemeral-ssh-window-two"));
  assert.ok(
    state.partitions.every((name) => !name.startsWith("persist:")),
    "SSH windows must use non-persistent Electron partitions",
  );
  assert.equal(
    persistentPartition("shellos-ephemeral-ssh-window-one"),
    "shellos-ephemeral-ssh-window-one",
    "the BrowserWindow must use the same ephemeral partition as its proxy session",
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
  assert.equal(state.closeCalls, 1, "recovery must discard Chromium's stale connections");
  assert.deepEqual(controllerEvents, ["stop:first", "reload:first", "stop:second", "reload:second"]);
  assert.equal(state.proxyCalls.at(-1).proxyRules, "socks5://127.0.0.1:43123");

  const missingReplies = [];
  handleMessage({ cmd: "proxy-reconnected" }, null, (reply) => missingReplies.push(reply));
  assert.deepEqual(missingReplies, [
    { event: "proxy-recovery-failed", error: "browser session is not open" },
  ]);

  const keyboardSession = new Session({ key: "keyboard", argv: [] });
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

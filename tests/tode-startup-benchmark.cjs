const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

async function main() {
  const [root, target, project, readyUrl] = process.argv.slice(2);
  if (!root?.startsWith("/tmp/shellos-startup-local.")) throw new Error("a disposable local runtime is required");
  const kitten = process.env.KITTEN_BIN ?? "/Applications/kitty.app/Contents/MacOS/kitten";
  const control = process.env.KITTY_TEST_SOCKET;
  if (!control) throw new Error("set KITTY_TEST_SOCKET to an existing kitty control socket");
  const timing = path.join(root, "data/tode/inject.css.timing.json");
  fs.rmSync(timing, { force: true });
  const env = {
    TODE_INSTALL_ROOT: path.join(root, "install"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    ELECTRON_RUN_AS_NODE: "1",
    NODE_OPTIONS: `--require=${path.join(__dirname, "fixtures/tode-startup-probe.cjs")}`,
    SHELLOS_STARTUP_PROBE: path.join(root, "startup-probe.jsonl"),
  };
  const helper = path.join(root, "install/vendor/terminal-browser/electron/terminal-browser.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper");
  const command = process.env.SHELLOS_BENCH_DIRECT ? [
    path.join(root, "install/vendor/terminal-browser/bin/terminal-browser"),
    "open", "--app-mode", "--ssh", target, readyUrl,
    `--preload=${root}/data/tode/browser-preload.js`,
    `--main-script=${root}/data/tode/browser-main.js`,
  ] : [helper, path.join(root, "install/dist/main.js"), "--ssh", target,
    ...(readyUrl ? ["--ready-url", readyUrl] : [project])];
  const started = Date.now();
  const windowId = execFileSync(kitten, [
    "@", "--to", control, "launch", `--type=${process.env.KITTY_TEST_WINDOW ? "overlay-main" : "os-window"}`, "--title=ShellOS startup benchmark",
    ...(process.env.KITTY_TEST_WINDOW ? ["--match", `id:${process.env.KITTY_TEST_WINDOW}`] : []),
    ...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    ...command,
  ], { encoding: "utf8" }).trim();
  try {
    const deadline = started + 60000;
    while (Date.now() < deadline) {
      if (fs.existsSync(timing)) {
        const page = JSON.parse(fs.readFileSync(timing, "utf8"));
        const workbench = page.marks?.["code/didStartWorkbench"];
        if (workbench !== undefined && page.origin >= started) {
          console.log(JSON.stringify({ totalMs: page.origin + workbench - started, preNavigationMs: page.origin - started, workbenchMs: workbench, responseEndMs: page.responseEnd, scriptLoadedMs: page.marks["code/didLoadWorkbenchMain"], windowId }));
          if (process.env.SHELLOS_STARTUP_RESOURCES) {
            const states = path.join(root, "state/tode/browser/state");
            const logs = fs.readdirSync(states).map((name) => path.join(states, name, "logs/stderr.log"));
            const log = fs.readFileSync(logs[0], "utf8");
            let targetPage;
            for (const match of [...log.matchAll(/DevTools listening on (ws:\/\/[^\s]+)/g)].reverse()) {
              try {
                const pages = await (await fetch(`http://${new URL(match[1]).host}/json/list`)).json();
                targetPage = pages.find((item) => item.type === "page" && item.url.startsWith("http:"));
                if (targetPage) break;
              } catch {}
            }
            if (!targetPage) throw new Error("benchmark page has no live CDP endpoint");
            const socket = new WebSocket(targetPage.webSocketDebuggerUrl);
            await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
            const reply = new Promise((resolve) => socket.addEventListener("message", (event) => resolve(JSON.parse(event.data)), { once: true }));
            socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: 'performance.getEntriesByType("resource").filter(item=>item.duration>20).map(item=>({name:item.name,duration:Math.round(item.duration),start:Math.round(item.startTime),end:Math.round(item.responseEnd),transfer:item.transferSize,encoded:item.encodedBodySize}))', returnByValue: true } }));
            console.log(JSON.stringify((await reply).result?.result?.value));
            socket.close();
          }
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("workbench startup mark did not arrive within 60 seconds");
  } finally {
    execFileSync(kitten, ["@", "--to", control, "close-window", "--match", `id:${windowId}`]);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

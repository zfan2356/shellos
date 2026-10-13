const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

async function worker() {
  const { app, session } = require("electron");
  const [work, url, mode] = process.argv.slice(3);
  app.setPath("userData", path.join(work, "user-data"));
  app.setPath("sessionData", path.join(work, "session-data"));
  app.disableHardwareAcceleration();
  await app.whenReady();
  app.dock?.hide();
  const source = fs.readFileSync(path.join(work, "browser.js"), "utf8");
  const start = source.indexOf("var shellosSshPartitions = new Set();");
  const end = source.indexOf("function createSession(ctx)", start);
  assert.ok(start >= 0 && end > start);
  const acquire = require("node:vm").runInNewContext(
    source.slice(start, end) + "\nshellosAcquireSshPartition;",
    { require },
  );
  const partition = mode === "ephemeral" ? "shellos-ephemeral-ssh-baseline" : acquire("cache-test-host");
  const target = session.fromPartition(partition);
  const completed = new Promise((resolve) => target.webRequest.onCompleted(resolve));
  const started = performance.now();
  const response = await target.fetch(url);
  assert.equal(response.status, 200);
  const bytes = (await response.arrayBuffer()).byteLength;
  const elapsedMs = Math.round(performance.now() - started);
  const details = await completed;
  assert.equal(details.fromCache, mode === "warm", `${mode} cache behavior`);
  await target.closeAllConnections();
  target.flushStorageData();
  console.log(JSON.stringify({ mode, bytes, elapsedMs, fromCache: details.fromCache }));
  app.quit();
}

async function run() {
  const electron = process.env.ELECTRON_BIN;
  assert.ok(electron, "set ELECTRON_BIN to the Electron executable to run this optional integration test");
  const repo = path.resolve(__dirname, "..");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "shellos-electron-cache-test-"));
  const server = require("node:http").createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { "Cache-Control": "public, max-age=31536000", "Content-Type": "text/javascript" });
      response.end(" ".repeat(1024 * 1024));
    }, 300);
  });
  try {
    for (const [fixture, output] of [
      ["terminal-browser-ssh-main.js", "cli.js"],
      ["terminal-browser-ssh-browser.js", "browser.js"],
    ]) {
      fs.copyFileSync(path.join(__dirname, "fixtures", fixture), path.join(work, output));
    }
    execFileSync("bash", [
      path.join(repo, "scripts/patch-terminal-browser-ssh-reconnect.sh"),
      path.join(work, "cli.js"), path.join(work, "browser.js"),
    ], { env: { ...process.env, SHELLOS_FULL_REINSTALL: "1" }, stdio: "pipe" });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = process.env.SHELLOS_CACHE_TEST_URL ?? `http://127.0.0.1:${server.address().port}/editor.js`;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    for (const mode of ["cold", "warm", "ephemeral"]) {
      await new Promise((resolve, reject) => {
        const child = spawn(electron, [__filename, "--ssh-cache-worker", work, url, mode], { env, stdio: "inherit" });
        const timer = setTimeout(() => { child.kill(); reject(new Error(`${mode} timed out`)); }, 60000);
        child.on("error", (error) => { clearTimeout(timer); reject(error); });
        child.on("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`${mode} exited with ${code}`));
        });
      });
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(work, { recursive: true, force: true });
  }
}

(process.versions.electron ? worker() : run()).catch((error) => {
  console.error(error);
  if (process.versions.electron) require("electron").app.exit(1);
  else process.exitCode = 1;
});

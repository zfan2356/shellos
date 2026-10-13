const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "shellos-startup-test-"));
const repo = path.resolve(__dirname, "..");

function patch(script, root) {
  const command = path.join(repo, "scripts", script);
  const env = { ...process.env, SHELLOS_FULL_REINSTALL: "1" };
  execFileSync("bash", [command, root], { env });
  const snapshot = fs.readFileSync(path.join(root, "dist/main.js"), "utf8");
  execFileSync("bash", [command, root], { env });
  assert.equal(fs.readFileSync(path.join(root, "dist/main.js"), "utf8"), snapshot);
  execFileSync("bash", [command, "--check", root], { env });
}

async function main() {
  fs.mkdirSync(path.join(work, "dist"));
  fs.writeFileSync(path.join(work, "dist/main.js"), `
async function sshCommand(target, args) {
    const ready = "unused";
    const split = takeFlag(args, "--split");
    const size = takeFlag(args, "--size");
    const unsupported = args.find((arg) => arg.startsWith("-"));
    if (unsupported) fail("unsupported flag");
    const runtime = await (0, release_1.resolveRuntimeWithProgress)();
    const { palette } = await (0, profile_2.readPalette)();
    return (0, ssh_1.sshOpen)(runtime, target, {
        remotePath: args[0], palette, version: installedVersion(), split, size,
    });
}
async function serveCommand(args) {
    return "slow-path";
}
`);
  fs.writeFileSync(path.join(work, "dist/ssh.js"), `
function sshOpen(runtime, target, options) {
    const bundle = writeBundle(options.palette, options.version, options.remotePath);
    const scripts = (0, browserglue_1.writeBrowserScripts)();
    const argv = [
        "open", "--app-mode", "--ssh", target,
        "--ssh-bundle",
        bundle,
        "--ssh-bundle-dir",
        "\${XDG_DATA_HOME:-$HOME/.local/share}/tode/bundles",
        "--preload=/preload",
        "--main-script=/main",
    ];
    return node_child_process_1.spawn(runtime.bin, argv);
}
`);
  patch("patch-tode-ready-url.sh", work);
  let paletteReads = 0;
  let state = { injectorPort: 43210 };
  let output = "";
  const context = vm.createContext({
    URL,
    process: { stdout: { write(value) { output += value; } }, cwd() { return "/tmp"; } },
    fail(message) { throw new Error(message); },
    takeFlag(args, flag) { const index = args.indexOf(flag); return index < 0 ? undefined : args.splice(index, 2)[1]; },
    takeBool(args, flag) { const index = args.indexOf(flag); if (index < 0) return false; args.splice(index, 1); return true; },
    installedVersion() { return "v0.2.0"; },
    server_1: { currentServer: async () => state, origin: () => "http://127.0.0.1:43210/" },
    target_1: { resolveTarget: (folder) => folder, workbenchUrl: (origin, folder) => `${origin}?folder=${encodeURIComponent(folder)}` },
    release_1: { resolveRuntimeWithProgress: async () => ({ bin: "terminal-browser" }) },
    profile_2: { readPalette: async () => { paletteReads++; return { palette: {} }; } },
    ssh_1: { sshOpen: async (_runtime, _target, options) => options },
  });
  vm.runInContext(fs.readFileSync(path.join(work, "dist/main.js"), "utf8"), context);
  assert.equal(await context.serveCommand(["--ready-url", "/tmp/folder with spaces"]), 0);
  assert.equal(output, "http://127.0.0.1:43210/?folder=%2Ftmp%2Ffolder%20with%20spaces\n");
  state = null;
  output = "";
  assert.equal(await context.serveCommand(["--ready-url", "/tmp/project"]), 1);
  assert.equal(output, "");
  assert.equal(await context.serveCommand(["--prepare"]), "slow-path");
  const readyUrl = "http://127.0.0.1:43210/?folder=%2Ftmp%2Fproject";
  assert.equal((await context.sshCommand("ssh host", ["--ready-url", readyUrl])).readyUrl, readyUrl);
  assert.equal(paletteReads, 0);
  await context.sshCommand("host", ["/tmp/project"]);
  assert.equal(paletteReads, 1);
  for (const bad of ["file:///tmp/project", "http://example.com:1234/", "http://user:pass@127.0.0.1:1234/"]) {
    await assert.rejects(context.sshCommand("host", ["--ready-url", bad]));
  }
  let bundles = 0;
  const ssh = vm.createContext({
    writeBundle() { bundles++; return "/bundle"; },
    browserglue_1: { writeBrowserScripts: () => ({ preload: "/preload", mainScript: "/main" }) },
    node_child_process_1: { spawn: (_bin, args) => args },
  });
  vm.runInContext(fs.readFileSync(path.join(work, "dist/ssh.js"), "utf8"), ssh);
  const args = ssh.sshOpen({ bin: "browser" }, "ssh host", { readyUrl });
  assert.ok(args.includes(readyUrl));
  assert.ok(!args.includes("--ssh-bundle"));
  assert.equal(bundles, 0);
  assert.ok(ssh.sshOpen({ bin: "browser" }, "host", {}).includes("--ssh-bundle"));
  assert.equal(bundles, 1);

  const browserRoot = path.join(work, "browser");
  for (const name of ["cli", "browser"]) fs.mkdirSync(path.join(browserRoot, name, "dist"), { recursive: true });
  const cliFile = path.join(browserRoot, "cli/dist/main.js");
  const browserFile = path.join(browserRoot, "browser/dist/main.js");
  fs.writeFileSync(cliFile, `async function openHere(argv) {
  const tunnel = await sshSetup(argv);
  return attachHere(argv, tunnel).catch(() => {});
}
async function wait() {
      await sleep2(200);
}`);
  fs.writeFileSync(browserFile, `var IDLE_EXIT_MS = 15e3;
async function runDaemon(cdpPort) {
  return IDLE_EXIT_MS;
}`);
  const startupPatch = path.join(repo, "scripts/patch-terminal-browser-startup.sh");
  for (const args of [[browserRoot], [browserRoot], ["--check", browserRoot]]) {
    execFileSync("bash", [startupPatch, ...args], { env: { ...process.env, SHELLOS_FULL_REINSTALL: "1" } });
  }
  const events = [];
  let finishSsh;
  const parallel = vm.createContext({
    daemonSocket: async () => { events.push("daemon"); return { destroy() { events.push("probe-closed"); } }; },
    sshSetup: () => { events.push("ssh"); return new Promise((resolve) => { finishSsh = resolve; }); },
    attachHere: async () => { events.push("attached"); },
  });
  vm.runInContext(fs.readFileSync(cliFile, "utf8"), parallel);
  const opened = parallel.openHere([]);
  assert.deepEqual(events, ["daemon", "ssh"]);
  finishSsh({});
  await opened;
  assert.deepEqual(events, ["daemon", "ssh", "probe-closed", "attached"]);
  const app = new EventEmitter();
  const browser = vm.createContext({ import_electron9: { app } });
  vm.runInContext(fs.readFileSync(browserFile, "utf8"), browser);
  assert.equal(await browser.runDaemon(0), 900000);
  assert.equal(app.listenerCount("window-all-closed"), 1);
  console.log("tode startup tests: ok");
}
main().finally(() => fs.rmSync(work, { recursive: true, force: true })).catch((error) => { console.error(error); process.exitCode = 1; });

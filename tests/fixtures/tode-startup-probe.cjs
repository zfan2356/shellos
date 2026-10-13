const fs = require("node:fs");
const childProcess = require("node:child_process");
const file = process.env.SHELLOS_STARTUP_PROBE;
const log = (event, details = {}) => {
  if (file) fs.appendFileSync(file, JSON.stringify({ at: Date.now(), pid: process.pid, event, ...details }) + "\n");
};
log("process-start", { argv: process.argv });
for (const method of ["spawn", "spawnSync", "execFileSync"]) {
  const original = childProcess[method];
  childProcess[method] = function (...args) {
    const started = Date.now();
    log(method, { command: args[0], args: args[1] });
    const result = original.apply(this, args);
    if (method === "spawn") result.once("exit", () => log("child-exit", { command: args[0], elapsedMs: Date.now() - started }));
    else log(method + "-done", { command: args[0], elapsedMs: Date.now() - started });
    return result;
  };
}

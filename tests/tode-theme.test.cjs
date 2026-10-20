const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const repo = path.resolve(__dirname, "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "shellos-theme-test-"));
const env = { ...process.env, SHELLOS_FULL_REINSTALL: "1", PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` };

try {
  fs.mkdirSync(path.join(work, "dist/theme"), { recursive: true });
  fs.writeFileSync(path.join(work, "dist/theme/generate.js"), `
function generateTheme(palette) { return { source: "upstream", palette }; }
module.exports = { generateTheme };
`);
  fs.writeFileSync(path.join(work, "dist/profile.js"), `
function installTheme(palette) {
    return installThemeJson((0, generate_1.generateTheme)(palette), (0, generate_1.paletteFingerprint)(palette));
}
`);
  const patch = path.join(repo, "scripts/patch-tode-theme.sh");
  execFileSync("bash", [patch, work], { env });
  const source = fs.readFileSync(path.join(work, "dist/theme/generate.js"), "utf8");
  execFileSync("bash", [patch, work], { env });
  assert.equal(fs.readFileSync(path.join(work, "dist/theme/generate.js"), "utf8"), source);
  execFileSync("bash", [patch, "--check", work], { env });
  const data = path.join(work, "data");
  const sandbox = { module: { exports: {} }, require(name) {
    return name === "../runtime/paths" ? { DATA_DIR: data } : require(name);
  } };
  vm.runInNewContext(source, sandbox);
  const generate = sandbox.module.exports.generateTheme;
  assert.equal(generate({ background: "fallback" }).source, "upstream");
  fs.mkdirSync(path.join(data, "theme"), { recursive: true });
  const file = path.join(data, "theme/live-theme.json");
  const custom = { colors: { "editor.background": "#1e1f22" }, tokenColors: [] };
  fs.writeFileSync(file, JSON.stringify(custom));
  assert.equal(JSON.stringify(generate({})), JSON.stringify(custom));
  custom.colors["editor.background"] = "#2b2d30";
  fs.writeFileSync(file, JSON.stringify(custom));
  assert.equal(generate({}).colors["editor.background"], "#2b2d30");
  fs.writeFileSync(file, "{");
  assert.throws(() => generate({}));

  const profile = fs.readFileSync(path.join(work, "dist/profile.js"), "utf8");
  const ctx = { generate_1: {
    generateTheme: () => ({ colors: { accent: "new" } }),
    themeFingerprint: theme => JSON.stringify(theme),
    paletteFingerprint: () => "stale",
  }, installThemeJson: (theme, fingerprint) => fingerprint };
  vm.runInNewContext(profile, ctx);
  assert.equal(ctx.installTheme({}), JSON.stringify({ colors: { accent: "new" } }));

  const settings = JSON.parse(fs.readFileSync(path.join(repo, "editor/settings.json")));
  const theme = JSON.parse(fs.readFileSync(path.join(repo, "tode/theme/live-theme.json")));
  const palette = JSON.parse(fs.readFileSync(path.join(repo, "tode/theme/palette.json")));
  assert.deepEqual(settings["workbench.colorCustomizations"], theme.colors);
  assert.deepEqual(settings["editor.tokenColorCustomizations"]["[Terminal Code]"].textMateRules, theme.tokenColors);
  assert.deepEqual(settings["editor.semanticTokenColorCustomizations"]["[Terminal Code]"].rules, theme.semanticTokenColors);
  assert.equal(theme.colors["editor.background"], "#1e1f22");
  assert.deepEqual(palette.background, [30, 31, 34]);
  assert.match(fs.readFileSync(path.join(repo, "kitty/current-theme.conf"), "utf8"), /^background #1e1f22$/m);
  assert.match(fs.readFileSync(path.join(repo, "kitty/kitty.conf"), "utf8"), /^background_opacity 1\.0$/m);
  console.log("Theme persistence, fallback, identity, and palette consistency passed");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function fixture() {
  const uri = (scheme, name) => ({ scheme, fsPath: name, toString: () => `${scheme}:${name}` });
  const targets = new Map(["a.py", "b.py"].map((name) => [name, {
    repoRoot: "/repo", file: { path: name, statusKind: "M" },
  }]));
  const editor = (name) => ({ document: { uri: uri("file", `/repo/${name}`) } });
  const diffTab = (name) => ({ input: {
    original: uri("worktree-review", `/repo/${name}`),
    modified: uri("file", `/repo/${name}`),
  } });
  const group = { activeTab: diffTab("a.py"), tabs: [] };
  group.tabs.push(group.activeTab);
  const opened = [];
  const vscode = {
    Uri: { file: (name) => uri("file", name) },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => fallback }) },
    window: { activeTextEditor: editor("a.py"), tabGroups: {
      activeTabGroup: group, all: [group],
      close: async (tabs) => { group.tabs = group.tabs.filter(tab => !tabs.includes(tab)); },
    }, showWarningMessage: (message) => { throw new Error(message); } },
  };
  const branchScm = {
    findChangeForUri: (value) => targets.get(path.basename(value.fsPath)),
    resolveChangeForUri: async (value) => targets.get(path.basename(value.fsPath)),
    makeDiffEditorInput: (target) => diffTab(target.file.path).input,
    openChange: async (target) => {
      opened.push(target.file.path);
      group.activeTab = diffTab(target.file.path);
      group.tabs.push(group.activeTab);
      vscode.window.activeTextEditor = editor(target.file.path);
    },
  };
  const sandbox = { module: { exports: {} }, require(name) {
    if (name === "vscode") return vscode;
    if (name === "./branch-review-scm") return {};
    return require(name.startsWith(".") ? path.join(__dirname, "../src", name) : name);
  } };
  const source = fs.readFileSync(path.join(__dirname, "../src/extension.js"), "utf8");
  vm.runInNewContext(source + "\nmodule.exports.TestController = ReviewPresentationController;", sandbox);
  const controller = new sandbox.module.exports.TestController(branchScm);
  controller.currentTarget = targets.get("a.py");
  controller.reviewTab = group.activeTab;
  return { controller, vscode, group, opened, targets, editor, diffTab, uri };
}

test("a late editor event cannot undo an Explorer diff switch", async () => {
  const f = fixture();
  const oldEditor = f.vscode.window.activeTextEditor;
  await f.controller.resolveExplorerOpen(f.uri("file", "/repo/b.py"));
  f.group.activeTab = f.diffTab("b.py");
  f.group.tabs.push(f.group.activeTab);
  f.vscode.window.activeTextEditor = f.editor("b.py");

  await f.controller.handleActiveEditor(oldEditor);
  await f.controller.openQueue;

  assert.deepEqual(f.opened, []);
  assert.equal(f.controller.currentTarget.file.path, "b.py");
  assert.equal(f.group.activeTab.input.modified.fsPath, "/repo/b.py");
});

test("a late editor event reviews the selected source tab instead of the old document", async () => {
  const f = fixture();
  const oldEditor = f.vscode.window.activeTextEditor;
  f.group.activeTab = { input: { uri: f.uri("file", "/repo/b.py") } };
  f.vscode.window.activeTextEditor = f.editor("b.py");

  await f.controller.handleActiveEditor(oldEditor);
  await f.controller.openQueue;

  assert.deepEqual(f.opened, ["b.py"]);
  assert.equal(f.group.activeTab.input.modified.fsPath, "/repo/b.py");
});

test("a selected source tab is reviewed before activeTextEditor catches up", async () => {
  const f = fixture();
  f.group.activeTab = { input: { uri: f.uri("file", "/repo/b.py") } };
  f.group.tabs.push(f.group.activeTab);
  f.vscode.window.activeTextEditor = undefined;

  await f.controller.handleActiveEditor(undefined);

  assert.deepEqual(f.opened, ["b.py"]);
  assert.equal(f.group.activeTab.input.modified.fsPath, "/repo/b.py");
});

test("an old editor is not reopened while the active tab is temporarily absent", async () => {
  const f = fixture();
  const oldEditor = f.vscode.window.activeTextEditor;
  f.group.activeTab = undefined;
  await f.controller.handleActiveEditor(oldEditor);
  await f.controller.openQueue;
  assert.deepEqual(f.opened, []);
});

test("a non-text tab cannot reopen the previous review document", async () => {
  const f = fixture();
  f.group.activeTab = { input: {} };
  await f.controller.handleActiveEditor(f.vscode.window.activeTextEditor);
  await f.controller.openQueue;
  assert.deepEqual(f.opened, []);
});

test("a source selection is handled after its tab state catches up", async () => {
  const f = fixture();
  const selectedEditor = f.editor("b.py");
  f.vscode.window.activeTextEditor = selectedEditor;
  await f.controller.handleActiveEditor(selectedEditor);
  assert.deepEqual(f.opened, []);

  f.group.activeTab = { input: { uri: selectedEditor.document.uri } };
  f.group.tabs.push(f.group.activeTab);
  await f.controller.handleActiveEditor(f.vscode.window.activeTextEditor);

  assert.deepEqual(f.opened, ["b.py"]);
  assert.equal(f.group.activeTab.input.modified.fsPath, "/repo/b.py");
});

test("Explorer waits for the previous review open before switching", async () => {
  const f = fixture();
  let release;
  f.controller.openQueue = new Promise(resolve => { release = resolve; });
  let resolved = false;
  const switching = f.controller.resolveExplorerOpen(f.uri("file", "/repo/b.py"))
    .then(value => { resolved = true; return value; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(resolved, false);

  release();
  const input = await switching;
  assert.equal(input.modified.fsPath, "/repo/b.py");
  assert.equal(f.controller.currentTarget.file.path, "b.py");
});

test("events from either side of the active diff do not reopen it", async () => {
  const f = fixture();
  await f.controller.handleActiveEditor({ document: { uri: f.group.activeTab.input.original } });
  await f.controller.handleActiveEditor(f.vscode.window.activeTextEditor);
  assert.deepEqual(f.opened, []);
  assert.equal(f.controller.reviewTab, f.group.activeTab);
});

test("Explorer also waits for a review opened by the Git refresh", async () => {
  const f = fixture();
  let release;
  f.controller.branchScm.resolveChangeForUri = async () => {
    f.controller.openQueue = new Promise(resolve => { release = resolve; });
    return f.targets.get("b.py");
  };
  let resolved = false;
  const switching = f.controller.resolveExplorerOpen(f.uri("file", "/repo/b.py"))
    .then(value => { resolved = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolved, false);
  release();
  assert.equal((await switching).modified.fsPath, "/repo/b.py");
});

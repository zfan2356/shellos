"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const manifest = require("../package.json");

function visiblePaletteCommands() {
  const hidden = new Set(
    (manifest.contributes.menus.commandPalette || [])
      .filter((item) => item.when === "false")
      .map((item) => item.command)
  );
  return manifest.contributes.commands
    .map((command) => command.command)
    .filter((command) => !hidden.has(command));
}

test("removes custom view containers and generated focus commands", () => {
  assert.equal(manifest.contributes.viewsContainers, undefined);
  assert.equal(manifest.contributes.views, undefined);
  assert.equal(
    manifest.activationEvents.some((event) => event.startsWith("onView:")),
    false
  );

  const manifestText = JSON.stringify(manifest);
  assert.equal(manifestText.includes("Focus on"), false);
  assert.equal(manifestText.includes(".focus"), false);
});

test("removes worktree navigation and exposes only four primary controls", () => {
  const manifestText = JSON.stringify(manifest);
  assert.equal(manifestText.includes("selectWorktree"), false);
  assert.equal(manifestText.includes("includeCurrentWorktree"), false);
  assert.deepEqual(visiblePaletteCommands(), [
    "worktreeReview.selectBranchBaseRef",
    "worktreeReview.useSideBySideDiff",
    "worktreeReview.useSourceView",
    "worktreeReview.toggleReview",
  ]);
});

test("branch review defaults to dev-aware merge-base comparison", () => {
  const properties = manifest.contributes.configuration.properties;
  const base = properties["worktreeReview.branchChanges.baseRef"];

  assert.equal(base.default, "auto");
  assert.equal(base.scope, "resource");
  assert.match(base.description, /dev/);
  assert.match(base.description, /merge base/i);
});

test("review has exactly side-by-side and source layouts", () => {
  const properties = manifest.contributes.configuration.properties;
  assert.equal(properties["worktreeReview.enabled"].default, true);
  assert.equal(properties["worktreeReview.diffLayout"].default, "sideBySide");
  assert.deepEqual(properties["worktreeReview.diffLayout"].enum, [
    "sideBySide",
    "source",
  ]);
});

test("the toggle actively opens and closes the review", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "extension.js"),
    "utf8"
  );

  assert.match(
    source,
    /async toggleReview\(\)[\s\S]*?if \(enable\)[\s\S]*?showReview\(\)[\s\S]*?closeReview\(\)/
  );
  assert.match(
    source,
    /async setDiffLayout\(layout\)[\s\S]*?this\.enabled = true[\s\S]*?update\([\s\S]*?"enabled",[\s\S]*?true[\s\S]*?await this\.showReview\(\)/
  );
  assert.match(
    source,
    /async closeReview\(\)[\s\S]*?input\.original\.scheme === GIT_BLOB_SCHEME[\s\S]*?this\.diffLayout === "source"[\s\S]*?uriEquals\(input\.uri, targetUri\)[\s\S]*?tabGroups\.close\(openTabs, true\)/
  );
  assert.match(source, /statusBar\.command = "worktreeReview\.toggleReview"/);
});

test("Explorer resolves changed files into one atomic diff open", () => {
  const extensionSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "extension.js"),
    "utf8"
  );
  const scmSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "branch-review-scm.js"),
    "utf8"
  );
  const patchSource = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "scripts",
      "patch-tode-worktree-review-click.sh"
    ),
    "utf8"
  );

  assert.ok(
    manifest.activationEvents.includes(
      "onCommand:worktreeReview.resolveExplorerOpen"
    )
  );
  assert.match(
    extensionSource,
    /registerCommand\([\s\S]*?"worktreeReview\.resolveExplorerOpen"/
  );
  assert.match(
    extensionSource,
    /async resolveExplorerOpen\(uri, editorOptions = \{\}\)[\s\S]*?resolveChangeForUri\(uri\)[\s\S]*?makeDiffEditorInput\(target\)/
  );
  assert.match(scmSource, /"_workbench\.diff"[\s\S]*?\[viewColumn, editorOptions\]/);
  assert.doesNotMatch(scmSource, /"vscode\.diff"/);
  assert.match(patchSource, /Explorer atomic diff v2/);
  assert.match(
    patchSource,
    /original:\{resource:shellosReviewInput\.original\}[\s\S]*?modified:\{resource:shellosReviewInput\.modified\}/
  );
  assert.match(
    extensionSource,
    /openTarget\(target, options = \{\}\)[\s\S]*?this\.openQueue\.then/
  );
});

test("Explorer resolution waits for initial and scheduled change refreshes", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "branch-review-scm.js"),
    "utf8"
  );

  assert.match(
    source,
    /async resolveChangeForUri\(uri\)[\s\S]*?await this\.syncPromise[\s\S]*?entry\.timer[\s\S]*?await this\.refreshEntry\(entry\)[\s\S]*?entry\.refreshPromise/
  );
});

test("review opens the active change or the first current-branch change", () => {
  const extensionSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "extension.js"),
    "utf8"
  );
  const scmSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "branch-review-scm.js"),
    "utf8"
  );

  assert.match(
    extensionSource,
    /targetFromActiveEditor\(\)[\s\S]*?resolveCurrentTarget\(\)[\s\S]*?branchScm\.getFirstChange\(\)/
  );
  assert.match(scmSource, /getFirstChange\(\)[\s\S]*?makeOpenTarget/);
});

test("Git repository state changes refresh the current branch automatically", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "branch-review-scm.js"),
    "utf8"
  );

  assert.match(
    source,
    /repository\.state\.onDidChange\(\(\)\s*=>[\s\S]*?this\.scheduleForPath\(repository\.rootUri\.fsPath\)/
  );
  assert.match(source, /getCurrentRef[\s\S]*?branch[\s\S]*?--show-current/);
});

test("branch changes replace the review and close it when no changes remain", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "extension.js"),
    "utf8"
  );

  assert.match(
    source,
    /previousComparisons[\s\S]*?entry\.compareBaseRef[\s\S]*?entry\.headCommit/
  );
  assert.match(
    source,
    /if \(!this\.branchScm\.getFirstChange\(\)\) \{[\s\S]*?this\.closeReview\(\)/
  );
});

test("source mode opens files directly while deleted files keep an empty right side", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "branch-review-scm.js"),
    "utf8"
  );

  assert.match(
    source,
    /layout === "source"[\s\S]*?file\.statusKind !== "D"[\s\S]*?showTextDocument/
  );
  assert.match(source, /file\.statusKind === "D"[\s\S]*?makeEmptyUri/);
  assert.match(source, /"_workbench\.diff"/);
});

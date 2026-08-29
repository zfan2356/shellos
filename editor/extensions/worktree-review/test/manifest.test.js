"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const manifest = require("../package.json");
const {
  CHANGES_VIEW_ID,
  LEGACY_CHANGES_VIEW_ID,
  LEGACY_WORKTREES_VIEW_ID,
  WORKTREES_VIEW_ID,
  getChangesViewIds,
  getWorktreesViewIds,
} = require("../src/view-ids");

function contributedViewIds() {
  return Object.values(manifest.contributes.views)
    .flat()
    .map((view) => view.id);
}

function visiblePaletteCommands() {
  const hidden = new Set(
    manifest.contributes.menus.commandPalette
      .filter((item) => item.when === "false")
      .map((item) => item.command)
  );
  return manifest.contributes.commands
    .map((command) => command.command)
    .filter((command) => !hidden.has(command));
}

test("review sidebar contributes the runtime view ids", () => {
  assert.deepEqual(
    manifest.contributes.views.worktreeReview.map((view) => view.id),
    [CHANGES_VIEW_ID, WORKTREES_VIEW_ID]
  );
  assert.equal(contributedViewIds().includes(CHANGES_VIEW_ID), true);
  assert.equal(contributedViewIds().includes(WORKTREES_VIEW_ID), true);
});

test("activation events include primary review sidebar views", () => {
  assert.equal(
    manifest.activationEvents.includes(`onView:${CHANGES_VIEW_ID}`),
    true
  );
  assert.equal(
    manifest.activationEvents.includes(`onView:${WORKTREES_VIEW_ID}`),
    true
  );
});

test("runtime fallback keeps current ids before legacy ids", () => {
  assert.deepEqual(getChangesViewIds(), [CHANGES_VIEW_ID, LEGACY_CHANGES_VIEW_ID]);
  assert.deepEqual(getWorktreesViewIds(), [
    WORKTREES_VIEW_ID,
    LEGACY_WORKTREES_VIEW_ID,
  ]);
});

test("menu view clauses only reference contributed review view ids", () => {
  const ids = new Set(contributedViewIds());
  const clauses = [
    ...manifest.contributes.menus["view/title"],
    ...manifest.contributes.menus["view/item/context"],
  ];

  for (const item of clauses) {
    const matches = [...(item.when || "").matchAll(/view == ([\w.]+)/g)];
    for (const match of matches) {
      assert.equal(ids.has(match[1]), true, `${item.command} references ${match[1]}`);
    }
  }
});

test("branch changes contributes configuration, commands, and SCM title actions", () => {
  const properties = manifest.contributes.configuration.properties;
  const commands = new Set(
    manifest.contributes.commands.map((command) => command.command)
  );
  const scmTitleCommands = new Set(
    manifest.contributes.menus["scm/title"].map((item) => item.command)
  );

  assert.equal(properties["worktreeReview.branchChanges.enabled"].default, true);
  assert.equal(properties["worktreeReview.includeCurrentWorktree"].default, true);
  assert.equal(properties["worktreeReview.branchChanges.baseRef"].default, "auto");
  assert.equal(properties["worktreeReview.branchChanges.baseRef"].scope, "resource");
  assert.equal(commands.has("worktreeReview.refreshBranchChanges"), true);
  assert.equal(commands.has("worktreeReview.selectBranchBaseRef"), true);
  assert.equal(commands.has("worktreeReview.toggleBranchChanges"), true);
  assert.equal(scmTitleCommands.has("worktreeReview.refreshBranchChanges"), true);
  assert.equal(scmTitleCommands.has("worktreeReview.selectBranchBaseRef"), true);
});

test("command palette exposes only the four primary review controls", () => {
  assert.deepEqual(visiblePaletteCommands(), [
    "worktreeReview.selectBaseRef",
    "worktreeReview.useSideBySideDiff",
    "worktreeReview.useInlineDiff",
    "worktreeReview.toggleReview",
  ]);
});

test("review layout settings have stable defaults", () => {
  const properties = manifest.contributes.configuration.properties;

  assert.equal(properties["worktreeReview.enabled"].default, true);
  assert.equal(properties["worktreeReview.diffLayout"].default, "sideBySide");
  assert.deepEqual(properties["worktreeReview.diffLayout"].enum, [
    "sideBySide",
    "inline",
  ]);
});

test("both base-branch pickers synchronize the sidebar and SCM views", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "extension.js"),
    "utf8"
  );

  assert.match(
    source,
    /branchScm\.selectBaseRef\(sourceControl\)[\s\S]*?provider\.setBaseRef\(selection\.repoRoot, selection\.baseRef\)/
  );
  assert.match(
    source,
    /provider\.selectBaseRef\(node\)[\s\S]*?branchScm\.setBaseRef\(selection\.repoRoot, selection\.baseRef\)/
  );
});

test("obsolete mode and side-panel contributions are removed", () => {
  const manifestText = JSON.stringify(manifest);

  assert.equal(manifestText.includes("worktreeReview.selectMode"), false);
  assert.equal(manifestText.includes("worktreeReview.focusDiffPanel"), false);
  assert.equal(manifestText.includes("worktreeReview.secondaryDiff"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      manifest.contributes.viewsContainers,
      "secondarySidebar"
    ),
    false
  );
});

test("changed-file rows open diffs directly without a selection listener", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "extension.js"),
    "utf8"
  );

  assert.match(
    source,
    /item\.command\s*=\s*\{\s*command:\s*"worktreeReview\.openChangedFile"/
  );
  assert.equal(
    source.includes("changesRegistration.treeView.onDidChangeSelection"),
    false
  );
});

test("deleted files use an empty right side in native diffs", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "extension.js"),
    "utf8"
  );

  assert.match(
    source,
    /file\.statusKind === "D"\s*\? makeEmptyUri\([\s\S]*?\)\s*:\s*makeWorktreeFileUri/
  );
});

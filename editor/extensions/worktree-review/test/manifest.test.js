"use strict";

const assert = require("assert/strict");
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

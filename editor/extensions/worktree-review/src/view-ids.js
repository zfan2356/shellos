"use strict";

const REVIEW_VIEW_CONTAINER_ID = "worktreeReview";
const CHANGES_VIEW_ID = "worktreeReview.sidebar.changes";
const WORKTREES_VIEW_ID = "worktreeReview.sidebar.worktrees";

// Older development installs may keep the previous package.json contribution
// cached until the remote extension is fully rescanned. Keep these as runtime
// fallbacks so activation does not fail while VS Code catches up.
const LEGACY_CHANGES_VIEW_ID = "worktreeReview.changes";
const LEGACY_WORKTREES_VIEW_ID = "worktreeReview.worktrees";

function getChangesViewIds() {
  return [CHANGES_VIEW_ID, LEGACY_CHANGES_VIEW_ID];
}

function getWorktreesViewIds() {
  return [WORKTREES_VIEW_ID, LEGACY_WORKTREES_VIEW_ID];
}

module.exports = {
  CHANGES_VIEW_ID,
  LEGACY_CHANGES_VIEW_ID,
  LEGACY_WORKTREES_VIEW_ID,
  REVIEW_VIEW_CONTAINER_ID,
  WORKTREES_VIEW_ID,
  getChangesViewIds,
  getWorktreesViewIds,
};

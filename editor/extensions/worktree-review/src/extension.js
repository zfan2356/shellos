"use strict";

const cp = require("child_process");
const path = require("path");
const vscode = require("vscode");
const {
  BranchReviewScmController,
  OPEN_CHANGE_COMMAND,
} = require("./branch-review-scm");
const { formatError, statusInfo, trimTrailingNewline } = require("./git-utils");

const GIT_BLOB_SCHEME = "worktree-review";
const MAX_GIT_BUFFER = 20 * 1024 * 1024;
const REVIEW_LAYOUTS = {
  sideBySide: {
    label: "Side by Side",
  },
  source: {
    label: "Source",
  },
};

async function activate(context) {
  const git = new Git();
  const branchScm = new BranchReviewScmController(git, {
    makeEmptyUri,
    makeGitBlobUri,
  });
  const presentation = new ReviewPresentationController(branchScm);
  const decorations = new ExplorerDecorationProvider(presentation);
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );

  presentation.setDecorationProvider(decorations);
  presentation.setStatusBar(statusBar);

  context.subscriptions.push(
    branchScm,
    presentation,
    vscode.workspace.registerTextDocumentContentProvider(
      GIT_BLOB_SCHEME,
      new GitBlobContentProvider(git)
    ),
    vscode.window.registerFileDecorationProvider(decorations),
    statusBar,
    vscode.window.onDidChangeActiveTextEditor((editor) =>
      presentation.handleActiveEditor(editor)
    ),
    vscode.commands.registerCommand("worktreeReview.refreshBranchChanges", () =>
      branchScm.refreshAll(true)
    ),
    vscode.commands.registerCommand(
      "worktreeReview.selectBranchBaseRef",
      (sourceControl) => branchScm.selectBaseRef(sourceControl)
    ),
    vscode.commands.registerCommand(OPEN_CHANGE_COMMAND, (target) =>
      presentation.enableAndOpenTarget(target)
    ),
    vscode.commands.registerCommand("worktreeReview.useSideBySideDiff", () =>
      presentation.setDiffLayout("sideBySide")
    ),
    vscode.commands.registerCommand("worktreeReview.useSourceView", () =>
      presentation.setDiffLayout("source")
    ),
    vscode.commands.registerCommand("worktreeReview.toggleReview", () =>
      presentation.toggleReview()
    ),
    vscode.commands.registerCommand("worktreeReview.openCurrentFileReview", () =>
      presentation.openCurrentFileReview()
    ),
    vscode.commands.registerCommand(
      "worktreeReview.interceptExplorerOpen",
      (uri, editorOptions) =>
        presentation.interceptExplorerOpen(uri, editorOptions)
    )
  );

  await presentation.start();
  await branchScm.start();
}

function deactivate() {}

class Git {
  run(cwd, args, options = {}) {
    const gitPath = vscode.workspace
      .getConfiguration("worktreeReview")
      .get("gitPath", "git");

    return new Promise((resolve, reject) => {
      cp.execFile(
        gitPath,
        ["-C", cwd, ...args],
        {
          cwd,
          maxBuffer: options.maxBuffer || MAX_GIT_BUFFER,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
            return;
          }

          resolve(options.trim === false ? stdout : trimTrailingNewline(stdout));
        }
      );
    });
  }
}

class GitBlobContentProvider {
  constructor(git) {
    this.git = git;
  }

  async provideTextDocumentContent(uri) {
    const payload = decodePayload(uri);
    if (payload.empty) {
      return "";
    }

    return this.git.run(
      payload.repoRoot,
      ["show", `${payload.ref}:${payload.filePath}`],
      { trim: false }
    );
  }
}

class ExplorerDecorationProvider {
  constructor(presentation) {
    this.presentation = presentation;
    this._onDidChangeFileDecorations = new vscode.EventEmitter();
    this.onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
  }

  refresh() {
    this._onDidChangeFileDecorations.fire(undefined);
  }

  provideFileDecoration(uri) {
    return this.presentation.provideExplorerDecoration(uri);
  }
}

class ReviewPresentationController {
  constructor(branchScm) {
    this.branchScm = branchScm;
    this.disposables = [];
    this.entries = [];
    this.openingReview = false;
    this.openQueue = Promise.resolve();
    this.currentTarget = undefined;
    this.reviewTab = undefined;
    this.readConfiguration();
  }

  async start() {
    this.disposables.push(
      this.branchScm.onDidChange((entries) => this.updateEntries(entries)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("worktreeReview.enabled") ||
          event.affectsConfiguration("worktreeReview.diffLayout")
        ) {
          const wasEnabled = this.enabled;
          const previousLayout = this.diffLayout;
          this.readConfiguration();
          this.applyDiffLayout().catch((error) =>
            vscode.window.showWarningMessage(
              `Worktree Review layout update failed: ${formatError(error)}`
            )
          );
          this.refreshUi();
          if (!this.enabled && wasEnabled) {
            this.closeReview();
          } else if (
            this.enabled &&
            (!wasEnabled || previousLayout !== this.diffLayout)
          ) {
            this.showReview();
          }
        }
      })
    );
    await this.applyDiffLayout();
    this.updateStatusBar();
  }

  dispose() {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  setDecorationProvider(provider) {
    this.decorationProvider = provider;
  }

  setStatusBar(statusBar) {
    this.statusBar = statusBar;
  }

  readConfiguration() {
    const configuration = vscode.workspace.getConfiguration("worktreeReview");
    this.enabled = configuration.get("enabled", true);
    const configuredLayout = configuration.get("diffLayout", "sideBySide");
    const migratedLayout = configuredLayout === "inline" ? "source" : configuredLayout;
    this.diffLayout = REVIEW_LAYOUTS[migratedLayout]
      ? migratedLayout
      : "sideBySide";
  }

  updateEntries(entries) {
    const previousComparisons = new Map(
      this.entries.map((entry) => [
        entry.repoRoot,
        `${entry.currentRef}\0${entry.baseRef}\0${entry.compareBaseRef}\0${entry.headCommit}`,
      ])
    );
    const comparisonChanged = entries.some(
      (entry) =>
        previousComparisons.has(entry.repoRoot) &&
        previousComparisons.get(entry.repoRoot) !==
          `${entry.currentRef}\0${entry.baseRef}\0${entry.compareBaseRef}\0${entry.headCommit}`
    );
    this.entries = entries;
    this.refreshUi();

    if (!this.enabled) {
      return;
    }
    if (!this.branchScm.getFirstChange()) {
      this.closeReview();
    } else if (comparisonChanged || previousComparisons.size === 0) {
      this.showReview();
    }
  }

  reviewTargetUri(input) {
    if (input.modified.scheme === "file") {
      return input.modified;
    }

    for (const uri of [input.modified, input.original]) {
      if (uri.scheme !== GIT_BLOB_SCHEME) {
        continue;
      }
      try {
        const payload = decodePayload(uri);
        return vscode.Uri.file(
          path.join(payload.repoRoot, ...payload.filePath.split("/"))
        );
      } catch {
        // Ignore tabs that do not belong to Worktree Review.
      }
    }

    return undefined;
  }

  refreshUi() {
    this.decorationProvider && this.decorationProvider.refresh();
    this.updateStatusBar();
  }

  async setDiffLayout(layout) {
    if (!REVIEW_LAYOUTS[layout]) {
      return;
    }

    this.diffLayout = layout;
    await vscode.workspace
      .getConfiguration("worktreeReview")
      .update("diffLayout", layout, vscode.ConfigurationTarget.Global);
    await this.applyDiffLayout();
    this.updateStatusBar();
    if (this.enabled) {
      await this.showReview();
    }
  }

  async applyDiffLayout() {
    const configuration = vscode.workspace.getConfiguration("diffEditor");
    await configuration.update(
      "renderSideBySide",
      true,
      vscode.ConfigurationTarget.Global
    );
    await configuration.update(
      "useInlineViewWhenSpaceIsLimited",
      false,
      vscode.ConfigurationTarget.Global
    );
  }

  async toggleReview() {
    const enable = !this.enabled;
    this.enabled = enable;
    await vscode.workspace
      .getConfiguration("worktreeReview")
      .update("enabled", enable, vscode.ConfigurationTarget.Global);
    this.refreshUi();
    if (enable) {
      await this.showReview();
    } else {
      await this.closeReview();
    }
    vscode.window.showInformationMessage(
      `Worktree Review ${enable ? "opened" : "closed"}.`
    );
  }

  async showReview(preferredTarget) {
    if (!this.enabled || this.openingReview) {
      return;
    }

    const target =
      (preferredTarget && this.resolveCurrentTarget(preferredTarget)) ||
      this.targetFromActiveEditor() ||
      this.resolveCurrentTarget() ||
      this.branchScm.getFirstChange();
    if (!target) {
      return;
    }

    await this.openTarget(target, { preview: true });
  }

  resolveCurrentTarget(preferredTarget = this.currentTarget) {
    if (!preferredTarget || !preferredTarget.repoRoot || !preferredTarget.file) {
      return undefined;
    }

    return this.branchScm.findChangeForUri(
      vscode.Uri.file(
        path.join(
          preferredTarget.repoRoot,
          ...preferredTarget.file.path.split("/")
        )
      )
    );
  }

  targetFromActiveEditor() {
    const tabGroups = vscode.window.tabGroups;
    const activeTab = tabGroups && tabGroups.activeTabGroup.activeTab;
    const input = activeTab && activeTab.input;
    if (input && input.original && input.modified) {
      const targetUri = this.reviewTargetUri(input);
      const target = targetUri && this.branchScm.findChangeForUri(targetUri);
      if (target) {
        return target;
      }
    }

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === "file") {
      return this.branchScm.findChangeForUri(editor.document.uri);
    }

    return undefined;
  }

  async closeReview() {
    const reviewTab = this.reviewTab;
    this.reviewTab = undefined;
    if (!reviewTab) {
      return;
    }

    const stillOpen = vscode.window.tabGroups.all.some((group) =>
      group.tabs.includes(reviewTab)
    );
    if (stillOpen) {
      await vscode.window.tabGroups.close(reviewTab, true);
    }
  }

  provideExplorerDecoration(uri) {
    if (!this.enabled) {
      return undefined;
    }

    const target = this.branchScm.findChangeForUri(uri);
    if (target) {
      const info = statusInfo(target.file.statusKind);
      return new vscode.FileDecoration(
        info.badge,
        `Worktree Review: ${info.tooltip}`,
        new vscode.ThemeColor(info.color)
      );
    }

    if (this.branchScm.findChangedFolderForUri(uri)) {
      return new vscode.FileDecoration(
        undefined,
        "Worktree Review changes inside",
        new vscode.ThemeColor("gitDecoration.modifiedResourceForeground")
      );
    }

    return undefined;
  }

  async handleActiveEditor(editor) {
    if (!editor || !this.enabled || this.openingReview) {
      return;
    }

    const document = editor.document;
    if (
      !document ||
      document.uri.scheme !== "file" ||
      this.isActiveReviewDiffDocument(document.uri)
    ) {
      return;
    }

    const target = this.branchScm.findChangeForUri(document.uri);
    if (!target) {
      return;
    }

    this.currentTarget = target;
    if (this.diffLayout === "source") {
      const tabGroups = vscode.window.tabGroups;
      this.reviewTab = tabGroups && tabGroups.activeTabGroup.activeTab;
      return;
    }

    try {
      await this.openTarget(target, { preview: true });
    } catch (error) {
      vscode.window.showWarningMessage(
        `Worktree Review open failed: ${formatError(error)}`
      );
    }
  }

  async openCurrentFileReview() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") {
      vscode.window.showWarningMessage("Open a workspace file first.");
      return;
    }

    const target = this.branchScm.findChangeForUri(editor.document.uri);
    if (!target) {
      vscode.window.showInformationMessage(
        "The active file has no changes relative to the selected base branch."
      );
      return;
    }

    await this.enableAndOpenTarget(target);
  }

  async interceptExplorerOpen(uri, editorOptions = {}) {
    if (!this.enabled || !uri || uri.scheme !== "file") {
      return false;
    }

    const target = this.branchScm.findChangeForUri(uri);
    if (!target) {
      return false;
    }

    await this.openTarget(target, {
      preview: editorOptions.pinned !== true,
      preserveFocus: editorOptions.preserveFocus === true,
      sideBySide: editorOptions.sideBySide === true,
    });
    return true;
  }

  async enableAndOpenTarget(target) {
    if (!this.enabled) {
      this.enabled = true;
      await vscode.workspace
        .getConfiguration("worktreeReview")
        .update("enabled", true, vscode.ConfigurationTarget.Global);
      this.refreshUi();
    }
    await this.openTarget(target, { preview: true });
  }

  openTarget(target, options = {}) {
    const operation = this.openQueue.then(() =>
      this.doOpenTarget(target, options)
    );
    this.openQueue = operation.catch(() => undefined);
    return operation;
  }

  async doOpenTarget(target, options = {}) {
    this.openingReview = true;
    try {
      const previousTab = this.reviewTab;
      this.currentTarget = target;
      await this.branchScm.openChange(target, this.diffLayout, options);
      const tabGroups = vscode.window.tabGroups;
      this.reviewTab = tabGroups && tabGroups.activeTabGroup.activeTab;
      if (
        previousTab &&
        previousTab !== this.reviewTab &&
        vscode.window.tabGroups.all.some((group) =>
          group.tabs.includes(previousTab)
        )
      ) {
        await vscode.window.tabGroups.close(previousTab, true);
      }
    } finally {
      this.openingReview = false;
    }
  }

  isActiveReviewDiffDocument(uri) {
    const tabGroups = vscode.window.tabGroups;
    const activeTab = tabGroups && tabGroups.activeTabGroup.activeTab;
    const input = activeTab && activeTab.input;
    if (
      !input ||
      !input.original ||
      !input.modified ||
      (input.original.scheme !== GIT_BLOB_SCHEME &&
        input.modified.scheme !== GIT_BLOB_SCHEME)
    ) {
      return false;
    }

    return uriEquals(input.original, uri) || uriEquals(input.modified, uri);
  }

  updateStatusBar() {
    if (!this.statusBar) {
      return;
    }

    const entry = this.entries[0];
    if (!this.enabled) {
      this.statusBar.text = "$(circle-slash) Review: Off";
    } else if (entry && this.branchScm.getFirstChange()) {
      this.statusBar.text = `$(eye) Review: ${entry.currentRef} vs ${entry.baseRef} · ${REVIEW_LAYOUTS[this.diffLayout].label}`;
    } else {
      this.statusBar.text = `$(eye) Review: No changes · ${REVIEW_LAYOUTS[this.diffLayout].label}`;
    }

    this.statusBar.tooltip = this.enabled
      ? "Close Worktree Review"
      : `Open Worktree Review in ${REVIEW_LAYOUTS[this.diffLayout].label} mode`;
    this.statusBar.command = "worktreeReview.toggleReview";
    this.statusBar.show();
  }
}

function uriEquals(left, right) {
  return Boolean(left && right && left.toString() === right.toString());
}

function makeGitBlobUri(repoRoot, ref, filePath) {
  return makeReviewUri({ repoRoot, ref, filePath, empty: false });
}

function makeEmptyUri(repoRoot, ref, filePath) {
  return makeReviewUri({ repoRoot, ref, filePath, empty: true });
}

function makeReviewUri(payload) {
  return vscode.Uri.from({
    scheme: GIT_BLOB_SCHEME,
    authority: payload.empty ? "empty" : "git",
    path: `/${payload.filePath}`,
    query: encodeURIComponent(JSON.stringify(payload)),
  });
}

function decodePayload(uri) {
  return JSON.parse(decodeURIComponent(uri.query));
}

module.exports = {
  activate,
  deactivate,
};

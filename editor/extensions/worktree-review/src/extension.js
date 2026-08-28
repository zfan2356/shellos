"use strict";

const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const {
  BranchReviewScmController,
  OPEN_CHANGE_COMMAND,
} = require("./branch-review-scm");
const {
  buildChangeIndex,
  formatError,
  mergeFileStatuses,
  normalizeFsPath,
  parseNameStatus,
  parseUntrackedFiles,
  parseWorktreeList,
  relativePathFromRoot,
  shortSha,
  statusInfo,
  trimTrailingNewline,
} = require("./git-utils");
const {
  REVIEW_VIEW_CONTAINER_ID,
  getChangesViewIds,
  getWorktreesViewIds,
} = require("./view-ids");

const GIT_BLOB_SCHEME = "worktree-review";
const MAX_GIT_BUFFER = 20 * 1024 * 1024;
const MODE_KEY = "worktreeReview.mode";
const SECONDARY_SIDEBAR_UNSUPPORTED_CONTEXT =
  "worktreeReview.doesNotSupportSecondarySidebar";
const DIFF_VIEW_CONTAINER_ID = "worktreeReviewSecondaryDiff";
const DIFF_VIEW_ID = "worktreeReview.secondaryDiff";
const MODES = {
  off: {
    label: "Off",
    description: "Explorer opens normal files",
    icon: "circle-slash",
  },
  diff: {
    label: "Diff",
    description: "Explorer opens base vs worktree diffs",
    icon: "diff",
  },
  panel: {
    label: "Side Panel",
    description: "Explorer updates the Worktree Review diff panel",
    icon: "layout-sidebar-right",
  },
  preview: {
    label: "Preview",
    description: "Explorer opens real worktree files",
    icon: "go-to-file",
  },
};

function activate(context) {
  const git = new Git();
  const branchScm = new BranchReviewScmController(git, {
    makeEmptyUri,
    makeGitBlobUri,
  });
  const provider = new WorktreeReviewProvider(git, context);
  const changes = new WorktreeChangesProvider(provider);
  const diffPanel = new WorktreeDiffPanelProvider(git);
  const decorations = new ExplorerDecorationProvider(provider);
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );

  provider.setDiffPanel(diffPanel);
  provider.setDecorationProvider(decorations);
  provider.setChangesProvider(changes);
  provider.setStatusBar(statusBar);

  const worktreesRegistration = createTreeViewWithFallback(getWorktreesViewIds(), {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  const changesRegistration = createTreeViewWithFallback(getChangesViewIds(), {
    treeDataProvider: changes,
    showCollapseAll: true,
  });
  provider.setViewIds({
    changes: changesRegistration.viewId,
    worktrees: worktreesRegistration.viewId,
  });

  vscode.commands.executeCommand(
    "setContext",
    SECONDARY_SIDEBAR_UNSUPPORTED_CONTEXT,
    false
  );

  context.subscriptions.push(
    branchScm,
    vscode.workspace.registerTextDocumentContentProvider(
      GIT_BLOB_SCHEME,
      new GitBlobContentProvider(git)
    ),
    vscode.window.registerFileDecorationProvider(decorations),
    changesRegistration.treeView,
    changesRegistration.treeView.onDidChangeSelection((event) =>
      changes.handleTreeSelection(event.selection[0])
    ),
    worktreesRegistration.treeView,
    worktreesRegistration.treeView.onDidChangeSelection((event) =>
      provider.handleTreeSelection(event.selection[0])
    ),
    vscode.window.registerWebviewViewProvider(DIFF_VIEW_ID, diffPanel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    statusBar,
    vscode.workspace.onDidOpenTextDocument((document) =>
      provider.handleOpenedDocument(document)
    ),
    vscode.window.onDidChangeActiveTextEditor((editor) =>
      provider.handleActiveEditor(editor)
    ),
    vscode.commands.registerCommand("worktreeReview.refresh", async () => {
      provider.refresh();
      await branchScm.refreshAll(true);
    }),
    vscode.commands.registerCommand("worktreeReview.refreshBranchChanges", () =>
      branchScm.refreshAll(true)
    ),
    vscode.commands.registerCommand("worktreeReview.selectBranchBaseRef", (sourceControl) =>
      branchScm.selectBaseRef(sourceControl)
    ),
    vscode.commands.registerCommand("worktreeReview.toggleBranchChanges", () =>
      branchScm.toggleEnabled()
    ),
    vscode.commands.registerCommand(OPEN_CHANGE_COMMAND, (target) =>
      branchScm.openChange(target)
    ),
    vscode.commands.registerCommand("worktreeReview.selectBaseRef", (node) =>
      provider.selectBaseRef(node)
    ),
    vscode.commands.registerCommand("worktreeReview.selectWorktree", (node) =>
      provider.selectWorktree(node)
    ),
    vscode.commands.registerCommand("worktreeReview.selectMode", (node) =>
      provider.selectMode(node)
    ),
    vscode.commands.registerCommand("worktreeReview.openCurrentFileReview", () =>
      provider.openCurrentFileReview()
    ),
    vscode.commands.registerCommand("worktreeReview.openChangedFile", (node) =>
      provider.openChangedFile(node)
    ),
    vscode.commands.registerCommand("worktreeReview.focusReview", () =>
      provider.focusReview()
    ),
    vscode.commands.registerCommand("worktreeReview.focusDiffPanel", () =>
      provider.focusDiffPanel()
    ),
    vscode.commands.registerCommand("worktreeReview.copyWorktreePath", (node) =>
      provider.copyWorktreePath(node)
    )
  );

  branchScm.start().catch((error) =>
    vscode.window.showWarningMessage(
      `Branch Changes failed to start: ${formatError(error)}`
    )
  );

  provider.updateStatusBar();

  if (provider.mode === "panel") {
    setTimeout(() => provider.focusDiffPanel(), 0);
  }
}

function deactivate() {}

function createTreeViewWithFallback(viewIds, options) {
  const errors = [];
  for (const viewId of viewIds) {
    try {
      return {
        treeView: vscode.window.createTreeView(viewId, options),
        viewId,
      };
    } catch (error) {
      errors.push(`${viewId}: ${formatError(error)}`);
    }
  }

  throw new Error(`Could not register Worktree Review view. ${errors.join("; ")}`);
}

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

    if (payload.worktreePath) {
      const filePath = path.join(
        payload.worktreePath,
        ...payload.filePath.split("/")
      );
      if (fs.existsSync(filePath)) {
        return fs.promises.readFile(filePath, "utf8");
      }

      return this.git.run(
        payload.worktreePath,
        ["show", `${payload.ref}:${payload.filePath}`],
        { trim: false }
      );
    }

    return this.git.run(
      payload.repoRoot,
      ["show", `${payload.ref}:${payload.filePath}`],
      { trim: false }
    );
  }
}

class ExplorerDecorationProvider {
  constructor(provider) {
    this.provider = provider;
    this._onDidChangeFileDecorations = new vscode.EventEmitter();
    this.onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
  }

  refresh() {
    this._onDidChangeFileDecorations.fire(undefined);
  }

  provideFileDecoration(uri) {
    return this.provider.provideExplorerDecoration(uri);
  }
}

class WorktreeChangesProvider {
  constructor(provider) {
    this.provider = provider;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  async handleTreeSelection(node) {
    if (!node || node.kind !== "changedFile") {
      return;
    }

    try {
      await this.provider.openChangedFile(node);
    } catch (error) {
      vscode.window.showWarningMessage(
        `Worktree Review open failed: ${formatError(error)}`
      );
    }
  }

  async getChildren(node) {
    try {
      if (node && node.kind === "changedFolder") {
        return node.children;
      }

      if (node) {
        return [];
      }

      const states = Array.from(this.provider.changeStates.values());
      if (states.length === 0) {
        return [new MessageNode("Select a worktree to review changes.")];
      }

      const nodes = [];
      for (const state of states) {
        const changeNodes = buildChangedPathNodes(state);
        if (changeNodes.length === 0) {
          nodes.push(new MessageNode(`No changes in ${state.worktree.label}.`));
        } else if (states.length === 1) {
          nodes.push(...changeNodes);
        } else {
          nodes.push(
            new ChangedFolderNode(state, "", state.worktree.label, changeNodes)
          );
        }
      }

      return nodes;
    } catch (error) {
      return [new MessageNode(formatError(error))];
    }
  }

  getTreeItem(node) {
    return node.getTreeItem();
  }
}

class WorktreeDiffPanelProvider {
  constructor(git) {
    this.git = git;
    this.view = undefined;
    this.sequence = 0;
    this.state = {
      kind: "empty",
      title: "No diff selected",
      detail: "Select a changed file while Side Panel mode is active.",
    };
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: false };
    this.render();
  }

  async focus() {
    try {
      await vscode.commands.executeCommand(
        `workbench.view.extension.${DIFF_VIEW_CONTAINER_ID}`
      );
    } catch {
      // Some VS Code builds do not expose generated commands for contributed containers.
    }

    try {
      await vscode.commands.executeCommand(`${DIFF_VIEW_ID}.focus`);
    } catch {
      // Older VS Code builds may not expose a generated focus command for the view.
    }
  }

  clear() {
    this.sequence += 1;
    this.state = {
      kind: "empty",
      title: "No diff",
      detail: "The selected file has no changes in the active worktree.",
    };
    this.render();
  }

  reset() {
    this.sequence += 1;
    this.state = {
      kind: "empty",
      title: "No diff selected",
      detail: "Select a changed file while Side Panel mode is active.",
    };
    this.render();
  }

  async hide() {
    this.reset();
    if (!this.view || !this.view.visible) {
      return;
    }

    const closed = await executeCommandBestEffort(
      "workbench.action.closeAuxiliaryBar"
    );
    if (!closed) {
      await executeCommandBestEffort("workbench.action.toggleAuxiliaryBar");
    }
  }

  async showTarget(target, options = {}) {
    if (options.reveal) {
      await this.focus();
    }

    const sequence = ++this.sequence;
    this.state = {
      kind: "loading",
      title: target.file.path,
      detail: `${target.repo.baseRef}...${target.worktree.label}`,
    };
    this.render();

    try {
      const patch = await this.buildPatch(target);
      if (sequence !== this.sequence) {
        return;
      }

      this.state = {
        kind: "diff",
        target,
        patch,
        title: target.file.path,
        detail: `${target.repo.baseRef}...${target.worktree.label}`,
      };
      this.render();
    } catch (error) {
      if (sequence !== this.sequence) {
        return;
      }

      this.state = {
        kind: "error",
        title: target.file.path,
        detail: formatError(error),
      };
      this.render();
    }
  }

  async buildPatch(target) {
    const { file, worktree } = target;
    const compareBaseRef = file.compareBaseRef || worktree.repo.baseRef;
    const args = [
      "diff",
      "--no-color",
      "--find-renames",
      "--unified=80",
      compareBaseRef,
      "--",
    ];

    if (file.oldPath) {
      args.push(file.oldPath);
    }
    args.push(file.path);

    const patch = await this.git.run(worktree.path, args, {
      trim: false,
      maxBuffer: MAX_GIT_BUFFER,
    });
    if (patch.trim()) {
      return patch;
    }

    if (file.statusKind === "A") {
      return makeSyntheticPatch("added", worktree.path, file.path);
    }

    if (file.statusKind === "D") {
      const content = await this.git.run(
        worktree.repo.repoRoot,
        ["show", `${compareBaseRef}:${file.oldPath || file.path}`],
        { trim: false, maxBuffer: MAX_GIT_BUFFER }
      );
      return makeSyntheticPatchFromContent("deleted", file.oldPath || file.path, content);
    }

    return `No textual diff for ${file.path}\n`;
  }

  render() {
    if (!this.view) {
      return;
    }

    this.view.webview.html = this.renderHtml(this.view.webview);
  }

  renderHtml(webview) {
    const state = this.state;
    const editorStyle = getEditorStyle();
    const status =
      state.kind === "diff" && state.target
        ? statusInfo(state.target.file.statusKind)
        : undefined;
    const badge = status ? `<span class="badge">${escapeHtml(status.badge)}</span>` : "";
    const body =
      state.kind === "diff"
        ? `<div class="diff">${renderPatchHtml(state.patch)}</div>`
        : `<div class="message ${state.kind}">${escapeHtml(state.detail)}</div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --wtr-editor-font-family: ${editorStyle.fontFamily};
      --wtr-editor-font-size: ${editorStyle.fontSize}px;
      --wtr-editor-font-weight: ${editorStyle.fontWeight};
      --wtr-editor-line-height: ${editorStyle.lineHeight}px;
      --wtr-editor-tab-size: ${editorStyle.tabSize};
    }
    body {
      margin: 0;
      padding: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
    }
    .header {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 8px 10px;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
      background: var(--vscode-sideBar-background);
    }
    .title {
      display: flex;
      gap: 6px;
      align-items: center;
      min-width: 0;
      font-weight: 600;
      word-break: break-word;
    }
    .badge {
      flex: 0 0 auto;
      min-width: 1.4em;
      padding: 0 4px;
      border-radius: 3px;
      color: var(--vscode-badge-foreground);
      background: var(--vscode-badge-background);
      text-align: center;
      font-size: 11px;
      line-height: 16px;
    }
    .detail {
      margin-top: 3px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      word-break: break-word;
    }
    .message {
      padding: 12px 10px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }
    .message.error {
      color: var(--vscode-errorForeground);
    }
    .diff {
      padding: 6px 0 20px;
      overflow-x: auto;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-editor-font-family, var(--wtr-editor-font-family));
      font-size: var(--vscode-editor-font-size, var(--wtr-editor-font-size));
      font-weight: var(--wtr-editor-font-weight);
      line-height: var(--wtr-editor-line-height);
    }
    .line {
      padding: 0 10px;
      min-height: var(--wtr-editor-line-height);
      white-space: pre;
      tab-size: var(--wtr-editor-tab-size);
    }
    .line.header {
      position: static;
      border: 0;
      color: var(--vscode-textLink-foreground);
      background: var(--vscode-editor-background);
    }
    .line.file {
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editor-background);
    }
    .line.hunk {
      color: var(--vscode-editorLineNumber-activeForeground);
      background: var(--vscode-editor-selectionBackground);
    }
    .line.add {
      background: var(--vscode-diffEditor-insertedLineBackground);
    }
    .line.del {
      background: var(--vscode-diffEditor-removedLineBackground);
    }
    .line.context {
      color: var(--vscode-editor-foreground);
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">${badge}<span>${escapeHtml(state.title)}</span></div>
    <div class="detail">${escapeHtml(state.detail)}</div>
  </div>
  ${body}
</body>
</html>`;
  }
}

class WorktreeReviewProvider {
  constructor(git, context) {
    this.git = git;
    this.context = context;
    this.mode = context.workspaceState.get(MODE_KEY, "diff");
    this.baseRefs = new Map();
    this.repoCache = new Map();
    this.activeWorktrees = new Map();
    this.changeStates = new Map();
    this.viewIds = {};
    this.openingReview = false;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  setDecorationProvider(provider) {
    this.decorationProvider = provider;
  }

  setDiffPanel(provider) {
    this.diffPanel = provider;
  }

  setChangesProvider(provider) {
    this.changesProvider = provider;
  }

  setViewIds(viewIds) {
    this.viewIds = viewIds;
  }

  setStatusBar(statusBar) {
    this.statusBar = statusBar;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
    this.refreshActiveChanges();
  }

  async handleTreeSelection(node) {
    if (!node) {
      return;
    }

    try {
      if (node.kind === "mode") {
        await this.selectMode(node);
      } else if (node.kind === "worktree") {
        await this.selectWorktree(node);
      } else if (node.kind === "changedFile") {
        await this.openChangedFile(node);
      }
    } catch (error) {
      vscode.window.showWarningMessage(
        `Worktree Review action failed: ${formatError(error)}`
      );
    }
  }

  async refreshActiveChanges() {
    const active = Array.from(this.activeWorktrees.values());
    for (const worktree of active) {
      try {
        await this.rebuildChangeState(worktree);
      } catch (error) {
        vscode.window.showWarningMessage(`Worktree Review refresh failed: ${formatError(error)}`);
      }
    }

    this.decorationProvider && this.decorationProvider.refresh();
    this.changesProvider && this.changesProvider.refresh();
    this.updateStatusBar();
  }

  async getChildren(node) {
    try {
      if (!node) {
        const repos = await this.getRepositories();
        return repos.length > 0
          ? repos
          : [new MessageNode("Open a Git repository to review worktrees.")];
      }

      if (node.kind === "repo") {
        const worktrees = await this.getWorktrees(node);
        const modeNodes = Object.keys(MODES).map(
          (mode) => new ModeNode(this, node, mode, this.mode === mode)
        );

        return worktrees.length > 0
          ? [...modeNodes, ...worktrees]
          : [...modeNodes, new MessageNode("No linked worktrees found.")];
      }
    } catch (error) {
      return [new MessageNode(formatError(error))];
    }

    return [];
  }

  getTreeItem(node) {
    return node.getTreeItem();
  }

  async getRepositories() {
    const folders = vscode.workspace.workspaceFolders || [];
    const seen = new Set();
    const repos = [];

    for (const folder of folders) {
      const root = await this.getRepoRoot(folder.uri.fsPath);
      if (!root) {
        continue;
      }

      const key = normalizeFsPath(root);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      const currentRef = await this.getCurrentRef(root);
      const baseRef = this.baseRefs.get(key) || currentRef || "HEAD";
      const activeWorktree = this.activeWorktrees.get(key);
      const repo = new RepoNode(root, currentRef, baseRef, key, activeWorktree, this.mode);
      this.repoCache.set(key, repo);
      repos.push(repo);
    }

    return repos;
  }

  async getRepoRoot(folderPath) {
    try {
      const root = await this.git.run(folderPath, ["rev-parse", "--show-toplevel"]);
      return path.normalize(root);
    } catch {
      return undefined;
    }
  }

  async getCurrentRef(repoRoot) {
    try {
      const branch = await this.git.run(repoRoot, ["branch", "--show-current"]);
      if (branch) {
        return branch;
      }
    } catch {
      // Fall back to detached HEAD below.
    }

    try {
      return this.git.run(repoRoot, ["rev-parse", "--short", "HEAD"]);
    } catch {
      return "HEAD";
    }
  }

  async getWorktrees(repo) {
    const output = await this.git.run(repo.repoRoot, ["worktree", "list", "--porcelain"]);
    const parsed = parseWorktreeList(output);
    const includeCurrent = vscode.workspace
      .getConfiguration("worktreeReview")
      .get("includeCurrentWorktree", false);
    const currentRoot = normalizeFsPath(repo.repoRoot);
    const active = this.activeWorktrees.get(repo.key);
    const worktrees = [];

    for (const worktree of parsed) {
      if (!includeCurrent && normalizeFsPath(worktree.path) === currentRoot) {
        continue;
      }

      const dirty = await this.isDirty(worktree.path);
      const node = new WorktreeNode(
        repo,
        worktree,
        dirty,
        Boolean(active && normalizeFsPath(active.path) === normalizeFsPath(worktree.path)),
        this.changeStates.get(repo.key)
      );
      worktrees.push(node);
    }

    return worktrees;
  }

  async isDirty(worktreePath) {
    try {
      const output = await this.git.run(worktreePath, ["status", "--porcelain"]);
      return output.length > 0;
    } catch {
      return false;
    }
  }

  async selectWorktree(node) {
    let worktree = node && node.kind === "worktree" ? node : undefined;

    if (!worktree) {
      worktree = await this.pickWorktree();
    }

    if (!worktree) {
      return;
    }

    this.activeWorktrees.set(worktree.repo.key, worktree);
    await this.rebuildChangeState(worktree);
    this._onDidChangeTreeData.fire();
    this.decorationProvider && this.decorationProvider.refresh();
    this.changesProvider && this.changesProvider.refresh();
    this.updateStatusBar();
  }

  async pickWorktree() {
    const repos = await this.getRepositories();
    const picks = [];

    for (const repo of repos) {
      const worktrees = await this.getWorktrees(repo);
      for (const worktree of worktrees) {
        picks.push({
          label: worktree.label,
          description: path.basename(repo.repoRoot),
          detail: worktree.path,
          worktree,
        });
      }
    }

    const picked = await vscode.window.showQuickPick(picks, {
      placeHolder: "Select worktree to review",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    return picked && picked.worktree;
  }

  async selectMode(node) {
    let mode = node && node.kind === "mode" ? node.mode : undefined;

    if (!mode) {
      const picked = await vscode.window.showQuickPick(
        Object.entries(MODES).map(([value, info]) => ({
          label: info.label,
          description: info.description,
          value,
        })),
        { placeHolder: "Select Worktree Review mode" }
      );
      mode = picked && picked.value;
    }

    if (!mode || !MODES[mode]) {
      return;
    }

    this.mode = mode;
    await this.context.workspaceState.update(MODE_KEY, mode);
    if (mode === "off") {
      await this.resetReviewState();
    } else if (mode === "panel") {
      await this.closeWorktreeReviewDiffs();
      await this.focusDiffPanel();
    }
    this._onDidChangeTreeData.fire();
    this.decorationProvider && this.decorationProvider.refresh();
    this.changesProvider && this.changesProvider.refresh();
    this.updateStatusBar();
  }

  async resetReviewState() {
    this.openingReview = false;
    await this.closeWorktreeReviewDiffs();
    if (this.diffPanel) {
      await this.diffPanel.hide();
    }
    this.activeWorktrees.clear();
    this.changeStates.clear();
    this.changesProvider && this.changesProvider.refresh();
  }

  async rebuildChangeState(worktree) {
    const files = await this.getChangedFiles(worktree);
    const index = buildChangeIndex(files);
    this.changeStates.set(worktree.repo.key, {
      repo: worktree.repo,
      worktree,
      files,
      index,
    });
  }

  async getChangedFiles(worktree) {
    const baseRef = worktree.repo.baseRef;
    const headRef = worktree.headRef;
    const compareBaseRef = await this.getCompareBaseRef(
      worktree.repo.repoRoot,
      baseRef,
      headRef
    );
    const changed = await this.getDiffFiles(worktree.path, compareBaseRef);
    const untracked = await this.getUntrackedFiles(worktree.path);
    const files = mergeFileStatuses(changed, untracked);

    return files.map((file) => ({
      ...file,
      compareBaseRef,
    }));
  }

  async getCompareBaseRef(repoRoot, baseRef, headRef) {
    try {
      return await this.git.run(repoRoot, ["merge-base", baseRef, headRef]);
    } catch {
      return baseRef;
    }
  }

  async getDiffFiles(worktreePath, compareBaseRef) {
    const output = await this.git.run(
      worktreePath,
      ["diff", "--name-status", "--find-renames", "-z", compareBaseRef, "--"],
      { trim: false }
    );

    return parseNameStatus(output);
  }

  async getUntrackedFiles(worktreePath) {
    const output = await this.git.run(
      worktreePath,
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { trim: false }
    );

    return parseUntrackedFiles(output);
  }

  async selectBaseRef(node) {
    let repo = node && node.kind === "repo" ? node : node && node.repo;

    if (!repo) {
      repo = await this.pickRepo();
    }

    if (!repo) {
      return;
    }

    const refs = await this.listRefs(repo.repoRoot);
    const selected = await vscode.window.showQuickPick(
      refs.map((ref) => ({
        label: ref,
        description: ref === repo.currentRef ? "current branch" : undefined,
      })),
      {
        placeHolder: `Base ref for ${path.basename(repo.repoRoot)}`,
        matchOnDescription: true,
      }
    );

    if (!selected) {
      return;
    }

    this.baseRefs.set(repo.key, selected.label);
    repo.baseRef = selected.label;

    const active = this.activeWorktrees.get(repo.key);
    if (active) {
      active.repo.baseRef = selected.label;
      await this.rebuildChangeState(active);
    }

    this._onDidChangeTreeData.fire();
    this.decorationProvider && this.decorationProvider.refresh();
    this.changesProvider && this.changesProvider.refresh();
    this.updateStatusBar();
  }

  async pickRepo() {
    const repos = await this.getRepositories();
    if (repos.length === 0) {
      vscode.window.showWarningMessage("Open a Git repository first.");
      return undefined;
    }

    if (repos.length === 1) {
      return repos[0];
    }

    const repoPick = await vscode.window.showQuickPick(
      repos.map((candidate) => ({
        label: path.basename(candidate.repoRoot),
        description: candidate.repoRoot,
        repo: candidate,
      })),
      { placeHolder: "Select repository" }
    );

    return repoPick && repoPick.repo;
  }

  async listRefs(repoRoot) {
    const refs = new Set();
    const current = await this.getCurrentRef(repoRoot);
    if (current) {
      refs.add(current);
    }

    refs.add("HEAD");

    try {
      const output = await this.git.run(repoRoot, [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
        "refs/remotes",
      ]);

      for (const ref of output.split(/\r?\n/).filter(Boolean)) {
        if (!ref.endsWith("/HEAD")) {
          refs.add(ref);
        }
      }
    } catch (error) {
      vscode.window.showWarningMessage(`Could not list Git refs: ${formatError(error)}`);
    }

    return Array.from(refs).sort((a, b) => a.localeCompare(b));
  }

  provideExplorerDecoration(uri) {
    if (uri.scheme !== "file" || this.mode === "off") {
      return undefined;
    }

    const match = this.findChangeForUri(uri);
    if (match && match.file) {
      const info = statusInfo(match.file.statusKind);
      return new vscode.FileDecoration(
        info.badge,
        `Worktree Review: ${info.tooltip}`,
        new vscode.ThemeColor(info.color)
      );
    }

    const folder = this.findChangedFolderForUri(uri);
    if (folder) {
      return new vscode.FileDecoration(
        undefined,
        "Worktree Review changes inside",
        new vscode.ThemeColor("gitDecoration.modifiedResourceForeground")
      );
    }

    return undefined;
  }

  async handleActiveEditor(editor) {
    if (!editor || this.mode === "off" || this.openingReview) {
      return;
    }

    const document = editor.document;
    if (!document || document.uri.scheme !== "file") {
      return;
    }

    if (this.isActiveWorktreeReviewDiffDocument(document.uri)) {
      return;
    }

    const match = this.findChangeForUri(document.uri);
    if (!match) {
      if (this.isUriInReviewRoots(document.uri)) {
        if (this.mode === "panel") {
          this.diffPanel && this.diffPanel.clear();
        }
      }

      return;
    }

    if (this.mode === "panel") {
      await this.openPanelForTarget(match, { reveal: false });
      return;
    }

    this.openingReview = true;
    try {
      await this.openReviewTarget(match, { fromExplorer: true, preview: true });
    } catch (error) {
      vscode.window.showWarningMessage(`Worktree Review open failed: ${formatError(error)}`);
    } finally {
      setTimeout(() => {
        this.openingReview = false;
      }, 100);
    }
  }

  async handleOpenedDocument(document) {
    if (this.mode !== "diff" || !document || document.uri.scheme !== "file") {
      return;
    }

    const match = this.findChangeForUri(document.uri);
    if (!match) {
      return;
    }

    try {
      await this.openReviewTarget(match, { fromExplorer: true, preview: true });
    } catch {
      // The active-editor handler will report errors if the fallback path also fails.
    }
  }

  async openCurrentFileReview() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") {
      vscode.window.showWarningMessage("Open a workspace file first.");
      return;
    }

    const match = this.findChangeForUri(editor.document.uri);
    if (!match) {
      vscode.window.showInformationMessage(
        "The active file has no changes in the selected worktree."
      );
      return;
    }

    await this.openReviewTarget(match, { fromExplorer: false });
  }

  async openChangedFile(node) {
    if (node && node.kind === "changedFile") {
      await this.openReviewTarget({
        state: node.state,
        worktree: node.state.worktree,
        repo: node.state.repo,
        file: node.file,
      });
      return;
    }

    await this.openChangedFileQuickPick();
  }

  async openChangedFileQuickPick() {
    const states = Array.from(this.changeStates.values());
    if (states.length === 0) {
      vscode.window.showWarningMessage("Select a worktree first.");
      return;
    }

    const picks = [];
    for (const state of states) {
      for (const file of state.files) {
        const info = statusInfo(file.statusKind);
        picks.push({
          label: `${info.badge} ${file.path}`,
          description: state.worktree.label,
          detail: file.oldPath ? `${file.oldPath} -> ${file.path}` : undefined,
          state,
          file,
        });
      }
    }

    const picked = await vscode.window.showQuickPick(picks, {
      placeHolder: "Open changed file from selected worktree",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!picked) {
      return;
    }

    await this.openReviewTarget({
      state: picked.state,
      worktree: picked.state.worktree,
      repo: picked.state.repo,
      file: picked.file,
    });
  }

  async openReviewTarget(target, options = {}) {
    if (this.mode === "panel") {
      await this.openPanelForTarget(target, { reveal: true });
      return;
    }

    if (this.mode === "preview") {
      const opened = await this.openPreviewForFile(target.worktree, target.file);
      if (opened) {
        return;
      }
    }

    await this.openDiffForFile(target.worktree, target.file, options);
  }

  async openPanelForTarget(target, options = {}) {
    if (!this.diffPanel) {
      return;
    }

    await this.diffPanel.showTarget(target, options);
  }

  async focusDiffPanel() {
    if (this.diffPanel) {
      await this.diffPanel.focus();
    }
  }

  async focusReview() {
    await executeCommandBestEffort(
      `workbench.view.extension.${REVIEW_VIEW_CONTAINER_ID}`
    );
    const focusedChanges = await executeCommandBestEffort(
      `${this.viewIds.changes}.focus`
    );
    if (!focusedChanges) {
      await executeCommandBestEffort(`${this.viewIds.worktrees}.focus`);
    }
  }

  async openPreviewForFile(worktree, file) {
    if (file.statusKind === "D") {
      await this.openDiffForFile(worktree, file);
      return true;
    }

    const uri = this.getWorktreeFileUri(worktree, file.path);
    if (!uri) {
      await this.openDiffForFile(worktree, file);
      return true;
    }

    await vscode.window.showTextDocument(uri, { preview: false });
    return true;
  }

  async openDiffForFile(worktree, file, options = {}) {
    const leftPath = file.oldPath || file.path;
    const rightPath = file.path;
    const leftUri =
      file.statusKind === "A"
        ? makeEmptyUri(worktree.repo.repoRoot, file.compareBaseRef, leftPath)
        : makeGitBlobUri(worktree.repo.repoRoot, file.compareBaseRef, leftPath);
    const rightUri =
      file.statusKind === "D"
        ? makeEmptyUri(worktree.repo.repoRoot, worktree.headRef, rightPath)
        : makeWorktreeFileUri(worktree, rightPath);
    const title = `${statusInfo(file.statusKind).badge} ${rightPath} (${worktree.repo.baseRef}...${worktree.label})`;

    await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title, {
      preview: options.preview === true,
    });
  }

  isActiveWorktreeReviewDiffDocument(uri) {
    const tabGroups = vscode.window.tabGroups;
    const activeTab = tabGroups && tabGroups.activeTabGroup.activeTab;
    if (!isWorktreeReviewDiffTab(activeTab)) {
      return false;
    }

    const input = activeTab.input;
    return uriEquals(input.original, uri) || uriEquals(input.modified, uri);
  }

  async closeWorktreeReviewDiffs() {
    const tabGroups = vscode.window.tabGroups;
    if (!tabGroups || typeof tabGroups.close !== "function") {
      return;
    }

    const tabs = [];
    for (const group of tabGroups.all) {
      for (const tab of group.tabs) {
        if (isWorktreeReviewDiffTab(tab)) {
          tabs.push(tab);
        }
      }
    }

    if (tabs.length > 0) {
      await tabGroups.close(tabs, true);
    }
  }

  getWorktreeFileUri(worktree, relativePath) {
    const filePath = path.join(worktree.path, ...relativePath.split("/"));
    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    return vscode.Uri.file(filePath);
  }

  findChangeForUri(uri) {
    for (const state of this.changeStates.values()) {
      const repoMatch = this.findChangeInState(state, state.repo.repoRoot, uri.fsPath);
      if (repoMatch) {
        return repoMatch;
      }
    }

    return undefined;
  }

  isUriInReviewRoots(uri) {
    if (uri.scheme !== "file") {
      return false;
    }

    for (const state of this.changeStates.values()) {
      if (relativePathFromRoot(state.repo.repoRoot, uri.fsPath)) {
        return true;
      }
    }

    return false;
  }

  findChangeInState(state, rootPath, fsPath) {
    const relativePath = relativePathFromRoot(rootPath, fsPath);
    if (!relativePath) {
      return undefined;
    }

    const file =
      state.index.byPath.get(relativePath) ||
      state.index.byOldPath.get(relativePath);
    if (!file) {
      return undefined;
    }

    return {
      state,
      repo: state.repo,
      worktree: state.worktree,
      relativePath,
      file,
    };
  }

  findChangedFolderForUri(uri) {
    for (const state of this.changeStates.values()) {
      const repoMatch = this.findChangedFolderInState(
        state,
        state.repo.repoRoot,
        uri.fsPath
      );
      if (repoMatch) {
        return repoMatch;
      }
    }

    return undefined;
  }

  findChangedFolderInState(state, rootPath, fsPath) {
    const relativePath = relativePathFromRoot(rootPath, fsPath);
    if (!relativePath || !state.index.folders.has(relativePath)) {
      return undefined;
    }

    return {
      state,
      relativePath,
    };
  }

  async copyWorktreePath(node) {
    if (!node || node.kind !== "worktree") {
      return;
    }

    await vscode.env.clipboard.writeText(node.path);
    vscode.window.showInformationMessage(`Copied ${node.path}`);
  }

  updateStatusBar() {
    if (!this.statusBar) {
      return;
    }

    const states = Array.from(this.changeStates.values());
    const firstState = states[0];
    if (this.mode === "off") {
      this.statusBar.text = "$(circle-slash) WTR: Off";
    } else if (firstState) {
      this.statusBar.text = `$(git-branch) WTR: ${firstState.worktree.label} · ${MODES[this.mode].label}`;
    } else {
      this.statusBar.text = `$(git-branch) WTR: Select worktree · ${MODES[this.mode].label}`;
    }

    this.statusBar.tooltip =
      "Worktree Review: select worktree or mode from the sidebar";
    this.statusBar.command = "worktreeReview.selectWorktree";
    this.statusBar.show();
  }
}

class RepoNode {
  constructor(repoRoot, currentRef, baseRef, key, activeWorktree, mode) {
    this.kind = "repo";
    this.repoRoot = repoRoot;
    this.currentRef = currentRef;
    this.baseRef = baseRef;
    this.key = key;
    this.activeWorktree = activeWorktree;
    this.mode = mode;
  }

  getTreeItem() {
    const item = new vscode.TreeItem(
      path.basename(this.repoRoot),
      vscode.TreeItemCollapsibleState.Expanded
    );
    const target = this.activeWorktree ? this.activeWorktree.label : "none";
    item.description = `base: ${this.baseRef} · target: ${target} · ${MODES[this.mode].label}`;
    item.tooltip = `${this.repoRoot}\nCurrent: ${this.currentRef}\nBase: ${this.baseRef}\nTarget: ${target}`;
    item.contextValue = "repo";
    item.iconPath = new vscode.ThemeIcon("repo");
    return item;
  }
}

class ModeNode {
  constructor(provider, repo, mode, active) {
    this.kind = "mode";
    this.provider = provider;
    this.repo = repo;
    this.mode = mode;
    this.active = active;
  }

  getTreeItem() {
    const info = MODES[this.mode];
    const item = new vscode.TreeItem(
      `Mode: ${info.label}`,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = this.active ? "active" : undefined;
    item.tooltip = info.description;
    item.contextValue = "mode";
    item.iconPath = new vscode.ThemeIcon(this.active ? "check" : info.icon);
    return item;
  }
}

class WorktreeNode {
  constructor(repo, worktree, dirty, active, changeState) {
    this.kind = "worktree";
    this.repo = repo;
    this.path = worktree.path;
    this.head = worktree.head;
    this.branch = worktree.branch;
    this.detached = worktree.detached;
    this.dirty = dirty;
    this.active = active;
    this.headRef = this.branch || this.head || "HEAD";
    this.label = this.branch || shortSha(this.head) || path.basename(this.path);
    this.changeState = active ? changeState : undefined;
  }

  getTreeItem() {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.None);
    const details = [];
    if (this.active) {
      details.push("active");
    }
    if (this.dirty) {
      details.push("dirty");
    }
    if (this.changeState) {
      const summary = formatStats(this.changeState.index.stats);
      if (summary) {
        details.push(summary);
      }
    }

    item.description = details.join(" · ") || undefined;
    item.tooltip = `${this.path}\nHEAD: ${this.head || "unknown"}\nCompare: ${this.repo.baseRef}...${this.headRef}`;
    item.contextValue = this.active ? "worktreeActive" : "worktree";
    item.iconPath = new vscode.ThemeIcon(this.active ? "pass-filled" : "git-branch");
    return item;
  }
}

class ChangedFolderNode {
  constructor(state, fullPath, label, children) {
    this.kind = "changedFolder";
    this.state = state;
    this.fullPath = fullPath;
    this.label = label;
    this.children = children;
  }

  getTreeItem() {
    const item = new vscode.TreeItem(
      this.label,
      vscode.TreeItemCollapsibleState.Expanded
    );
    item.description = summarizeChangedChildren(this.children);
    item.tooltip = this.fullPath;
    item.contextValue = "changedFolder";
    item.iconPath = new vscode.ThemeIcon("folder");
    item.resourceUri = vscode.Uri.file(
      path.join(this.state.repo.repoRoot, ...this.fullPath.split("/"))
    );
    return item;
  }
}

class ChangedFileNode {
  constructor(state, file) {
    this.kind = "changedFile";
    this.state = state;
    this.file = file;
  }

  getTreeItem() {
    const info = statusInfo(this.file.statusKind);
    const item = new vscode.TreeItem(
      `${info.badge} ${path.basename(this.file.path)}`,
      vscode.TreeItemCollapsibleState.None
    );
    const directory = path.posix.dirname(this.file.path);
    item.description = directory && directory !== "." ? directory : undefined;
    item.tooltip = this.file.oldPath
      ? `${info.tooltip}: ${this.file.oldPath} -> ${this.file.path}`
      : `${info.tooltip}: ${this.file.path}`;
    item.contextValue = "changedFile";
    item.iconPath = new vscode.ThemeIcon(info.icon);
    item.resourceUri = vscode.Uri.file(
      path.join(this.state.repo.repoRoot, ...this.file.path.split("/"))
    );
    return item;
  }
}

function buildChangedPathNodes(state) {
  const root = { folders: new Map(), files: [] };

  for (const file of state.files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    let cursor = root;
    for (const part of parts.slice(0, -1)) {
      let next = cursor.folders.get(part);
      if (!next) {
        next = { folders: new Map(), files: [] };
        cursor.folders.set(part, next);
      }
      cursor = next;
    }

    cursor.files.push(file);
  }

  return materializeChangedPathNodes(state, root, "");
}

function materializeChangedPathNodes(state, source, parentPath) {
  const folders = Array.from(source.folders.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, child]) => {
      const fullPath = parentPath ? `${parentPath}/${label}` : label;
      const compacted = compactChangedFolder(label, fullPath, child);
      return new ChangedFolderNode(
        state,
        compacted.fullPath,
        compacted.label,
        materializeChangedPathNodes(state, compacted.source, compacted.fullPath)
      );
    });
  const files = source.files
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => new ChangedFileNode(state, file));

  return [...folders, ...files];
}

function compactChangedFolder(label, fullPath, source) {
  let compactLabel = label;
  let compactPath = fullPath;
  let compactSource = source;

  while (compactSource.files.length === 0 && compactSource.folders.size === 1) {
    const [[childLabel, childSource]] = compactSource.folders.entries();
    compactLabel = `${compactLabel}/${childLabel}`;
    compactPath = `${compactPath}/${childLabel}`;
    compactSource = childSource;
  }

  return {
    label: compactLabel,
    fullPath: compactPath,
    source: compactSource,
  };
}

function summarizeChangedChildren(children) {
  const stats = countChangedChildren({ children });
  return ["M", "A", "D", "R", "C", "U"]
    .filter((key) => stats[key] > 0)
    .map((key) => `${key}${stats[key]}`)
    .join(" ") || undefined;
}

function countChangedChildren(node) {
  const stats = {};
  for (const child of node.children) {
    if (child.kind === "changedFile") {
      stats[child.file.statusKind] = (stats[child.file.statusKind] || 0) + 1;
    } else if (child.kind === "changedFolder") {
      for (const [kind, count] of Object.entries(countChangedChildren(child))) {
        stats[kind] = (stats[kind] || 0) + count;
      }
    }
  }
  return stats;
}

class MessageNode {
  constructor(message) {
    this.kind = "message";
    this.message = message;
  }

  getTreeItem() {
    const item = new vscode.TreeItem(this.message, vscode.TreeItemCollapsibleState.None);
    item.contextValue = "message";
    item.iconPath = new vscode.ThemeIcon("info");
    return item;
  }
}

function formatStats(stats) {
  return ["M", "A", "D", "R", "C", "U"]
    .filter((key) => stats[key] > 0)
    .map((key) => `${key}${stats[key]}`)
    .join(" ");
}

function getEditorStyle() {
  const config = vscode.workspace.getConfiguration("editor");
  const fontSize = numberSetting(config.get("fontSize"), 14);
  const configuredLineHeight = numberSetting(config.get("lineHeight"), 0);
  const lineHeight =
    configuredLineHeight > 0 ? configuredLineHeight : Math.round(fontSize * 1.5);

  return {
    fontFamily: cssFontFamily(config.get("fontFamily", "monospace")),
    fontSize,
    fontWeight: cssIdentifier(config.get("fontWeight", "normal")),
    lineHeight,
    tabSize: numberSetting(config.get("tabSize"), 4),
  };
}

function numberSetting(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cssFontFamily(value) {
  return String(value || "monospace")
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) {
        return "monospace";
      }

      if (
        (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        /^[a-zA-Z-]+$/.test(trimmed)
      ) {
        return trimmed;
      }

      return `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    })
    .join(", ");
}

function cssIdentifier(value) {
  const text = String(value || "normal").trim();
  return /^[a-zA-Z0-9 _.-]+$/.test(text) ? text : "normal";
}

async function makeSyntheticPatch(kind, rootPath, filePath) {
  const absolutePath = path.join(rootPath, ...filePath.split("/"));
  const content = await fs.promises.readFile(absolutePath, "utf8");
  return makeSyntheticPatchFromContent(kind, filePath, content);
}

function makeSyntheticPatchFromContent(kind, filePath, content) {
  const lines = splitTextLines(content);
  const lineCount = Math.max(lines.length, 1);
  const header =
    kind === "deleted"
      ? [
          `diff --git a/${filePath} b/${filePath}`,
          `deleted file ${filePath}`,
          `--- a/${filePath}`,
          "+++ /dev/null",
          `@@ -1,${lineCount} +0,0 @@`,
        ]
      : [
          `diff --git a/${filePath} b/${filePath}`,
          `new file ${filePath}`,
          "--- /dev/null",
          `+++ b/${filePath}`,
          `@@ -0,0 +1,${lineCount} @@`,
        ];
  const prefix = kind === "deleted" ? "-" : "+";
  return [...header, ...lines.map((line) => `${prefix}${line}`)].join("\n");
}

function splitTextLines(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized) {
    return [];
  }

  return normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
}

function renderPatchHtml(patch) {
  return String(patch)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `<div class="line ${patchLineClass(line)}">${escapeHtml(line || " ")}</div>`)
    .join("");
}

function patchLineClass(line) {
  if (line.startsWith("diff --git") || line.startsWith("index ")) {
    return "header";
  }
  if (line.startsWith("--- ") || line.startsWith("+++ ")) {
    return "file";
  }
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("+")) {
    return "add";
  }
  if (line.startsWith("-")) {
    return "del";
  }
  return "context";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isWorktreeReviewDiffTab(tab) {
  const input = tab && tab.input;
  return Boolean(
    input &&
      input.original &&
      input.modified &&
      (input.original.scheme === GIT_BLOB_SCHEME ||
        input.modified.scheme === GIT_BLOB_SCHEME)
  );
}

function uriEquals(left, right) {
  return Boolean(left && right && left.toString() === right.toString());
}

async function executeCommandBestEffort(command) {
  try {
    await vscode.commands.executeCommand(command);
    return true;
  } catch {
    return false;
  }
}

function makeGitBlobUri(repoRoot, ref, filePath) {
  return makeReviewUri({ repoRoot, ref, filePath, empty: false });
}

function makeWorktreeFileUri(worktree, filePath) {
  return makeReviewUri({
    worktreePath: worktree.path,
    ref: worktree.headRef,
    filePath,
    empty: false,
  });
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

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
  AUTO_BASE_REF,
  collectBranchChanges,
  resolveBranchBase,
} = require("./branch-changes");
const {
  buildChangeIndex,
  formatError,
  normalizeFsPath,
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
const DIFF_LAYOUTS = {
  sideBySide: {
    label: "Side by Side",
    description: "Show base and worktree in separate columns",
    icon: "split-horizontal",
  },
  inline: {
    label: "Inline",
    description: "Show additions and deletions in one column",
    icon: "list-flat",
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
  const decorations = new ExplorerDecorationProvider(provider);
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );

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

  context.subscriptions.push(
    branchScm,
    vscode.workspace.registerTextDocumentContentProvider(
      GIT_BLOB_SCHEME,
      new GitBlobContentProvider(git)
    ),
    vscode.window.registerFileDecorationProvider(decorations),
    changesRegistration.treeView,
    worktreesRegistration.treeView,
    worktreesRegistration.treeView.onDidChangeSelection((event) =>
      provider.handleTreeSelection(event.selection[0])
    ),
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
    vscode.commands.registerCommand(
      "worktreeReview.selectBranchBaseRef",
      async (sourceControl) => {
        const selection = await branchScm.selectBaseRef(sourceControl);
        if (selection) {
          await provider.setBaseRef(selection.repoRoot, selection.baseRef);
        }
      }
    ),
    vscode.commands.registerCommand("worktreeReview.toggleBranchChanges", () =>
      branchScm.toggleEnabled()
    ),
    vscode.commands.registerCommand(OPEN_CHANGE_COMMAND, (target) =>
      branchScm.openChange(target)
    ),
    vscode.commands.registerCommand("worktreeReview.selectBaseRef", async (node) => {
      const selection = await provider.selectBaseRef(node);
      if (selection) {
        await branchScm.setBaseRef(selection.repoRoot, selection.baseRef);
      }
    }),
    vscode.commands.registerCommand("worktreeReview.selectWorktree", (node) =>
      provider.selectWorktree(node)
    ),
    vscode.commands.registerCommand("worktreeReview.useSideBySideDiff", () =>
      provider.setDiffLayout("sideBySide")
    ),
    vscode.commands.registerCommand("worktreeReview.useInlineDiff", () =>
      provider.setDiffLayout("inline")
    ),
    vscode.commands.registerCommand("worktreeReview.toggleReview", () =>
      provider.toggleReview()
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
  provider.initialize().catch((error) =>
    vscode.window.showWarningMessage(
      `Worktree Review failed to initialize: ${formatError(error)}`
    )
  );

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

class WorktreeReviewProvider {
  constructor(git, context) {
    this.git = git;
    this.context = context;
    const configuration = vscode.workspace.getConfiguration("worktreeReview");
    this.enabled = configuration.get("enabled", true);
    const configuredLayout = configuration.get("diffLayout", "sideBySide");
    this.diffLayout = DIFF_LAYOUTS[configuredLayout]
      ? configuredLayout
      : "sideBySide";
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

  setChangesProvider(provider) {
    this.changesProvider = provider;
  }

  setViewIds(viewIds) {
    this.viewIds = viewIds;
  }

  setStatusBar(statusBar) {
    this.statusBar = statusBar;
  }

  async initialize() {
    await this.applyDiffLayout();
    const repos = await this.getRepositories();
    for (const repo of repos) {
      await this.selectCurrentWorktree(repo);
    }

    this._onDidChangeTreeData.fire();
    this.decorationProvider && this.decorationProvider.refresh();
    this.changesProvider && this.changesProvider.refresh();
    this.updateStatusBar();
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
      if (node.kind === "worktree") {
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
        return worktrees.length > 0
          ? worktrees
          : [new MessageNode("No linked worktrees found.")];
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
      const baseRef =
        this.baseRefs.get(key) ||
        (await this.getDefaultBaseRef(root, folder.uri, currentRef));
      const activeWorktree = this.activeWorktrees.get(key);
      const repo = new RepoNode(
        root,
        currentRef,
        baseRef,
        key,
        activeWorktree,
        this.diffLayout
      );
      this.repoCache.set(key, repo);
      repos.push(repo);
    }

    return repos;
  }

  async getDefaultBaseRef(repoRoot, resourceUri, currentRef) {
    const configuredRef = vscode.workspace
      .getConfiguration("worktreeReview", resourceUri)
      .get("branchChanges.baseRef", AUTO_BASE_REF);

    try {
      const resolved = await resolveBranchBase(this.git, repoRoot, configuredRef);
      return resolved.ref;
    } catch {
      return currentRef || "HEAD";
    }
  }

  async selectCurrentWorktree(repo) {
    if (this.activeWorktrees.has(repo.key)) {
      return;
    }

    const output = await this.git.run(repo.repoRoot, ["worktree", "list", "--porcelain"]);
    const currentRoot = normalizeFsPath(repo.repoRoot);
    const current = parseWorktreeList(output).find(
      (worktree) => normalizeFsPath(worktree.path) === currentRoot
    );
    if (!current) {
      return;
    }

    const dirty = await this.isDirty(current.path);
    const worktree = new WorktreeNode(repo, current, dirty, true);
    this.activeWorktrees.set(repo.key, worktree);
    repo.activeWorktree = worktree;
    await this.rebuildChangeState(worktree);
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
      .get("includeCurrentWorktree", true);
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

  async setDiffLayout(layout) {
    if (!DIFF_LAYOUTS[layout]) {
      return;
    }

    this.diffLayout = layout;
    await vscode.workspace
      .getConfiguration("worktreeReview")
      .update("diffLayout", layout, vscode.ConfigurationTarget.Global);
    await this.applyDiffLayout();
    this._onDidChangeTreeData.fire();
    this.updateStatusBar();
  }

  async applyDiffLayout() {
    const sideBySide = this.diffLayout === "sideBySide";
    const configuration = vscode.workspace.getConfiguration("diffEditor");
    await configuration.update(
      "renderSideBySide",
      sideBySide,
      vscode.ConfigurationTarget.Global
    );
    if (sideBySide) {
      await configuration.update(
        "useInlineViewWhenSpaceIsLimited",
        false,
        vscode.ConfigurationTarget.Global
      );
    }
  }

  async toggleReview() {
    this.enabled = !this.enabled;
    await vscode.workspace
      .getConfiguration("worktreeReview")
      .update("enabled", this.enabled, vscode.ConfigurationTarget.Global);
    this.decorationProvider && this.decorationProvider.refresh();
    this.updateStatusBar();
    vscode.window.showInformationMessage(
      `Worktree Review automatic review ${this.enabled ? "enabled" : "disabled"}.`
    );
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
    const result = await collectBranchChanges(
      this.git,
      worktree.path,
      worktree.repo.baseRef,
      worktree.headRef
    );
    return result.files;
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

    return this.setBaseRef(repo.repoRoot, selected.label);
  }

  async setBaseRef(repoRoot, baseRef) {
    const repo = (await this.getRepositories()).find(
      (candidate) => normalizeFsPath(candidate.repoRoot) === normalizeFsPath(repoRoot)
    );
    if (!repo) {
      return undefined;
    }

    this.baseRefs.set(repo.key, baseRef);
    repo.baseRef = baseRef;

    const active = this.activeWorktrees.get(repo.key);
    if (active) {
      active.repo.baseRef = baseRef;
      await this.rebuildChangeState(active);
    }

    this._onDidChangeTreeData.fire();
    this.decorationProvider && this.decorationProvider.refresh();
    this.changesProvider && this.changesProvider.refresh();
    this.updateStatusBar();
    return { baseRef, repoRoot: repo.repoRoot };
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
    if (uri.scheme !== "file" || !this.enabled) {
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
    if (!editor || !this.enabled || this.openingReview) {
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
    if (!this.enabled || !document || document.uri.scheme !== "file") {
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
    await this.openDiffForFile(target.worktree, target.file, options);
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

  findChangeForUri(uri) {
    for (const state of this.changeStates.values()) {
      const repoMatch = this.findChangeInState(state, state.repo.repoRoot, uri.fsPath);
      if (repoMatch) {
        return repoMatch;
      }
    }

    return undefined;
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
    if (!this.enabled) {
      this.statusBar.text = "$(circle-slash) WTR: Off";
    } else if (firstState) {
      this.statusBar.text = `$(git-branch) WTR: ${firstState.worktree.label} · ${DIFF_LAYOUTS[this.diffLayout].label}`;
    } else {
      this.statusBar.text = `$(git-branch) WTR: Select worktree · ${DIFF_LAYOUTS[this.diffLayout].label}`;
    }

    this.statusBar.tooltip =
      "Worktree Review: select a worktree or diff layout from the sidebar";
    this.statusBar.command = "worktreeReview.selectWorktree";
    this.statusBar.show();
  }
}

class RepoNode {
  constructor(repoRoot, currentRef, baseRef, key, activeWorktree, diffLayout) {
    this.kind = "repo";
    this.repoRoot = repoRoot;
    this.currentRef = currentRef;
    this.baseRef = baseRef;
    this.key = key;
    this.activeWorktree = activeWorktree;
    this.diffLayout = diffLayout;
  }

  getTreeItem() {
    const item = new vscode.TreeItem(
      path.basename(this.repoRoot),
      vscode.TreeItemCollapsibleState.Expanded
    );
    const target = this.activeWorktree ? this.activeWorktree.label : "none";
    item.description = `base: ${this.baseRef} · target: ${target} · ${DIFF_LAYOUTS[this.diffLayout].label}`;
    item.tooltip = `${this.repoRoot}\nCurrent: ${this.currentRef}\nBase: ${this.baseRef}\nTarget: ${target}`;
    item.contextValue = "repo";
    item.iconPath = new vscode.ThemeIcon("repo");
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
    item.command = {
      command: "worktreeReview.openChangedFile",
      title: "Open Changed File Diff",
      arguments: [this],
    };
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

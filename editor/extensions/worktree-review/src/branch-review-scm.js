"use strict";

const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const {
  AUTO_BASE_REF,
  collectBranchChanges,
  resolveBranchBase,
} = require("./branch-changes");
const {
  buildChangeIndex,
  formatError,
  normalizeFsPath,
  relativePathFromRoot,
  statusInfo,
} = require("./git-utils");

const SOURCE_CONTROL_ID = "worktreeReview.branchChanges";
const CONFIG_SECTION = "worktreeReview";
const REVIEW_ENABLED_SETTING = "enabled";
const ENABLED_SETTING = "branchChanges.enabled";
const BASE_REF_SETTING = "branchChanges.baseRef";
const OPEN_CHANGE_COMMAND = "worktreeReview.openBranchChange";
const SELECT_BASE_COMMAND = "worktreeReview.selectBranchBaseRef";
const REFRESH_DELAY_MS = 250;

class BranchReviewScmController {
  constructor(git, uriFactory) {
    this.git = git;
    this.uriFactory = uriFactory;
    this.entries = new Map();
    this.disposables = [];
    this.gitRepositorySubscriptions = new Map();
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChange = this._onDidChange.event;
    this.syncPromise = Promise.resolve();
    this.disposed = false;
  }

  async start() {
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() =>
        this.runInBackground(this.synchronizeRepositories(), "workspace refresh")
      ),
      vscode.workspace.onDidChangeConfiguration((event) => {
        const baseChanged = event.affectsConfiguration(
          `${CONFIG_SECTION}.${BASE_REF_SETTING}`
        );
        const reviewChanged = event.affectsConfiguration(
          `${CONFIG_SECTION}.${REVIEW_ENABLED_SETTING}`
        );
        if (baseChanged) {
          for (const entry of this.entries.values()) {
            entry.baseOverride = undefined;
          }
        }
        if (reviewChanged) {
          this.updateQuickDiffProviders();
        }
        if (
          baseChanged ||
          event.affectsConfiguration(`${CONFIG_SECTION}.${ENABLED_SETTING}`)
        ) {
          this.runInBackground(this.synchronizeRepositories(), "configuration refresh");
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) =>
        this.scheduleForUri(document.uri)
      ),
      vscode.workspace.onDidCreateFiles((event) => this.scheduleForUris(event.files)),
      vscode.workspace.onDidDeleteFiles((event) => this.scheduleForUris(event.files)),
      vscode.workspace.onDidRenameFiles((event) =>
        this.scheduleForUris(
          event.files.flatMap((file) => [file.oldUri, file.newUri])
        )
      )
    );

    await this.synchronizeRepositories();
    await this.attachGitExtension();
  }

  dispose() {
    this.disposed = true;
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    for (const disposable of this.gitRepositorySubscriptions.values()) {
      disposable.dispose();
    }
    this.gitRepositorySubscriptions.clear();
    this.disposeEntries();
    this._onDidChange.dispose();
  }

  async refreshAll(showErrors = true) {
    await this.synchronizeRepositories(showErrors);
  }

  async selectBaseRef(sourceControl) {
    const entry = await this.pickEntry(sourceControl);
    if (!entry) {
      return;
    }

    const refs = await this.listRefs(entry.repoRoot, entry.baseRef);
    const picks = refs.map((ref) => ({
      label: ref,
      description: ref === entry.baseRef ? "current base" : undefined,
    }));
    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: `Base ref for ${path.basename(entry.repoRoot)}`,
      matchOnDescription: true,
    });
    if (!selected) {
      return;
    }

    return this.setBaseRef(entry.repoRoot, selected.label);
  }

  async setBaseRef(repoRoot, baseRef) {
    let entry = this.entries.get(normalizeFsPath(repoRoot));
    if (!entry) {
      await this.synchronizeRepositories(true);
      entry = this.entries.get(normalizeFsPath(repoRoot));
    }
    if (!entry) {
      return undefined;
    }

    entry.baseOverride = baseRef;
    await this.refreshEntry(entry, true);
    return { baseRef, repoRoot: entry.repoRoot };
  }

  async toggleEnabled() {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const enabled = config.get(ENABLED_SETTING, true);
    await config.update(
      ENABLED_SETTING,
      !enabled,
      vscode.ConfigurationTarget.Global
    );
  }

  async openChange(target, layout = "sideBySide", options = {}) {
    if (!target || !target.repoRoot || !target.file) {
      return;
    }

    const file = target.file;
    const sourcePath = path.join(target.repoRoot, ...file.path.split("/"));
    const editorOptions = {
      preview: options.preview === true,
      preserveFocus: options.preserveFocus === true,
    };
    if (options.sideBySide) {
      editorOptions.viewColumn = vscode.ViewColumn.Beside;
    }
    if (
      layout === "source" &&
      file.statusKind !== "D" &&
      fs.existsSync(sourcePath)
    ) {
      await vscode.window.showTextDocument(
        vscode.Uri.file(sourcePath),
        editorOptions
      );
      return;
    }

    const diff = this.makeDiffEditorInput(target);
    const viewColumn = options.sideBySide
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.Active;

    await vscode.commands.executeCommand(
      "_workbench.diff",
      diff.original,
      diff.modified,
      diff.label,
      [viewColumn, editorOptions]
    );
  }

  makeDiffEditorInput(target) {
    const file = target.file;
    const leftPath = file.oldPath || file.path;
    const rightPath = file.path;
    const original =
      file.statusKind === "A"
        ? this.uriFactory.makeEmptyUri(
            target.repoRoot,
            file.compareBaseRef,
            leftPath
          )
        : this.uriFactory.makeGitBlobUri(
            target.repoRoot,
            file.compareBaseRef,
            leftPath
          );
    const modified =
      file.statusKind === "D"
        ? this.uriFactory.makeEmptyUri(
            target.repoRoot,
            target.headCommit,
            rightPath
          )
        : vscode.Uri.file(
            path.join(target.repoRoot, ...rightPath.split("/"))
          );

    return {
      original,
      modified,
      label: `${statusInfo(file.statusKind).badge} ${rightPath} (${target.baseRef}...${target.currentRef})`,
    };
  }

  getEntries() {
    return Array.from(this.entries.values());
  }

  getFirstChange() {
    for (const entry of this.getEntries()) {
      const file = entry.changeIndex.byPath.values().next().value;
      if (file) {
        return this.makeOpenTarget(entry, file);
      }
    }

    return undefined;
  }

  findChangeForUri(uri) {
    if (!uri || uri.scheme !== "file") {
      return undefined;
    }

    const entries = this.getEntries().sort(
      (left, right) => right.repoRoot.length - left.repoRoot.length
    );
    for (const entry of entries) {
      const relativePath = relativePathFromRoot(entry.repoRoot, uri.fsPath);
      if (!relativePath) {
        continue;
      }
      const file =
        entry.changeIndex.byPath.get(relativePath) ||
        entry.changeIndex.byOldPath.get(relativePath);
      if (file) {
        return this.makeOpenTarget(entry, file);
      }
    }

    return undefined;
  }

  async resolveChangeForUri(uri) {
    if (!uri || uri.scheme !== "file") {
      return undefined;
    }

    await this.syncPromise.catch(() => undefined);
    let entry = this.findEntryForUri(uri);
    if (!entry) {
      await this.synchronizeRepositories();
      entry = this.findEntryForUri(uri);
    }
    if (!entry) {
      return undefined;
    }

    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
      await this.refreshEntry(entry);
    } else if (entry.refreshPromise) {
      await entry.refreshPromise;
    }

    let target = this.findChangeForUri(uri);
    if (!target) {
      await this.refreshEntry(entry);
      target = this.findChangeForUri(uri);
    }
    return target;
  }

  findEntryForUri(uri) {
    if (!uri || uri.scheme !== "file") {
      return undefined;
    }

    return this.getEntries()
      .sort((left, right) => right.repoRoot.length - left.repoRoot.length)
      .find((entry) => relativePathFromRoot(entry.repoRoot, uri.fsPath));
  }

  findChangedFolderForUri(uri) {
    if (!uri || uri.scheme !== "file") {
      return undefined;
    }

    const entries = this.getEntries().sort(
      (left, right) => right.repoRoot.length - left.repoRoot.length
    );
    for (const entry of entries) {
      const relativePath = relativePathFromRoot(entry.repoRoot, uri.fsPath);
      if (relativePath && entry.changeIndex.folders.has(relativePath)) {
        return { entry, relativePath };
      }
    }

    return undefined;
  }

  makeOpenTarget(entry, file) {
    return {
      baseRef: entry.baseRef,
      currentRef: entry.currentRef,
      file,
      headCommit: entry.headCommit,
      repoRoot: entry.repoRoot,
    };
  }

  synchronizeRepositories(showErrors = false) {
    const next = this.syncPromise
      .catch(() => undefined)
      .then(() => this.doSynchronizeRepositories(showErrors));
    this.syncPromise = next;
    return next;
  }

  async doSynchronizeRepositories(showErrors = false) {
    if (this.disposed) {
      return;
    }

    if (!this.isEnabled()) {
      this.disposeEntries();
      this._onDidChange.fire([]);
      return;
    }

    const roots = await this.findWorkspaceRepositories();
    if (this.disposed) {
      return;
    }
    const activeKeys = new Set(roots.map((root) => normalizeFsPath(root)));

    for (const [key, entry] of this.entries) {
      if (!activeKeys.has(key)) {
        this.disposeEntry(entry);
        this.entries.delete(key);
      }
    }

    for (const repoRoot of roots) {
      const key = normalizeFsPath(repoRoot);
      if (!this.entries.has(key)) {
        this.entries.set(key, this.createEntry(repoRoot));
      }
    }

    if (this.entries.size === 0) {
      this._onDidChange.fire([]);
      return;
    }

    await Promise.all(
      Array.from(this.entries.values()).map((entry) =>
        this.refreshEntry(entry, showErrors)
      )
    );
  }
  async findWorkspaceRepositories() {
    const roots = new Map();
    const folders = vscode.workspace.workspaceFolders || [];

    await Promise.all(
      folders.map(async (folder) => {
        if (folder.uri.scheme !== "file") {
          return;
        }

        try {
          const root = path.normalize(
            await this.git.run(folder.uri.fsPath, [
              "rev-parse",
              "--show-toplevel",
            ])
          );
          roots.set(normalizeFsPath(root), root);
        } catch {
          // Non-Git workspace folders do not get a synthetic SCM provider.
        }
      })
    );

    return Array.from(roots.values()).sort((left, right) =>
      left.localeCompare(right)
    );
  }

  createEntry(repoRoot) {
    const rootUri = vscode.Uri.file(repoRoot);
    const sourceControl = vscode.scm.createSourceControl(
      SOURCE_CONTROL_ID,
      "Branch Changes",
      rootUri
    );
    sourceControl.inputBox.visible = false;
    sourceControl.count = 0;
    const group = sourceControl.createResourceGroup("changes", "Changes vs dev");
    group.hideWhenEmpty = false;
    group.resourceStates = [];

    const entry = {
      baseRef: AUTO_BASE_REF,
      baseOverride: undefined,
      baseSource: undefined,
      compareBaseRef: undefined,
      currentRef: "HEAD",
      changeIndex: buildChangeIndex([]),
      filesByPath: new Map(),
      group,
      headCommit: "HEAD",
      refreshPromise: undefined,
      refreshToken: 0,
      repoRoot,
      sourceControl,
      timer: undefined,
    };
    this.updateQuickDiffProvider(entry);
    this.updateEntryUi(entry);
    return entry;
  }

  updateQuickDiffProviders() {
    for (const entry of this.entries.values()) {
      this.updateQuickDiffProvider(entry);
    }
  }

  updateQuickDiffProvider(entry) {
    entry.sourceControl.quickDiffProvider = this.isReviewEnabled()
      ? {
          provideOriginalResource: (uri) =>
            this.provideOriginalResource(entry, uri),
        }
      : undefined;
  }

  refreshEntry(entry, showErrors = false) {
    const operation = this.doRefreshEntry(entry, showErrors);
    entry.refreshPromise = operation;
    const clear = () => {
      if (entry.refreshPromise === operation) {
        entry.refreshPromise = undefined;
      }
    };
    operation.then(clear, clear);
    return operation;
  }

  async doRefreshEntry(entry, showErrors = false) {
    const refreshToken = ++entry.refreshToken;
    const configuredBaseRef =
      entry.baseOverride || this.getConfiguredBaseRef(entry.repoRoot);

    try {
      const resolvedBase = await resolveBranchBase(
        this.git,
        entry.repoRoot,
        configuredBaseRef
      );
      const [currentRef, result] = await Promise.all([
        this.getCurrentRef(entry.repoRoot),
        collectBranchChanges(this.git, entry.repoRoot, resolvedBase.ref),
      ]);
      if (this.disposed || refreshToken !== entry.refreshToken) {
        return;
      }

      entry.baseRef = resolvedBase.ref;
      entry.baseSource = resolvedBase.source;
      entry.compareBaseRef = result.compareBaseRef;
      entry.currentRef = currentRef;
      entry.headCommit = result.headCommit;
      entry.filesByPath = new Map(
        result.files.map((file) => [file.path, file])
      );
      entry.changeIndex = buildChangeIndex(result.files);
      entry.group.resourceStates = result.files.map((file) =>
        this.makeResourceState(entry, file)
      );
      entry.sourceControl.count = result.files.length;
      entry.error = undefined;
      this.updateEntryUi(entry);
      this._onDidChange.fire(this.getEntries());
    } catch (error) {
      if (this.disposed || refreshToken !== entry.refreshToken) {
        return;
      }

      const message = formatError(error);
      entry.baseRef = configuredBaseRef;
      entry.baseSource = undefined;
      entry.compareBaseRef = undefined;
      entry.filesByPath = new Map();
      entry.changeIndex = buildChangeIndex([]);
      entry.group.resourceStates = [];
      entry.sourceControl.count = 0;
      entry.error = message;
      this.updateEntryUi(entry);
      this._onDidChange.fire(this.getEntries());
      if (showErrors) {
        vscode.window.showWarningMessage(`Branch Changes refresh failed: ${message}`);
      }
    }
  }

  makeResourceState(entry, file) {
    const info = statusInfo(file.statusKind);
    const resourceUri = vscode.Uri.file(
      path.join(entry.repoRoot, ...file.path.split("/"))
    );
    const changeLabel = file.oldPath
      ? `${file.oldPath} -> ${file.path}`
      : file.path;

    return {
      resourceUri,
      command: {
        command: OPEN_CHANGE_COMMAND,
        title: "Open Branch Change",
        arguments: [
          {
            ...this.makeOpenTarget(entry, file),
          },
        ],
      },
      contextValue: `branchChange.${file.statusKind}`,
      decorations: {
        faded: file.statusKind === "D",
        iconPath: new vscode.ThemeIcon(
          info.icon,
          new vscode.ThemeColor(info.color)
        ),
        strikeThrough: file.statusKind === "D",
        tooltip: `${info.tooltip} relative to ${entry.baseRef}: ${changeLabel}`,
      },
    };
  }

  provideOriginalResource(entry, uri) {
    if (
      !this.isReviewEnabled() ||
      uri.scheme !== "file" ||
      !entry.compareBaseRef
    ) {
      return undefined;
    }

    const relativePath = relativePathFromRoot(entry.repoRoot, uri.fsPath);
    if (!relativePath) {
      return undefined;
    }

    const file = entry.filesByPath.get(relativePath);
    if (!file || file.statusKind === "D") {
      return undefined;
    }

    const basePath = file.oldPath || file.path;
    return file.statusKind === "A"
      ? this.uriFactory.makeEmptyUri(
          entry.repoRoot,
          entry.compareBaseRef,
          basePath
        )
      : this.uriFactory.makeGitBlobUri(
          entry.repoRoot,
          entry.compareBaseRef,
          basePath
        );
  }

  updateEntryUi(entry) {
    entry.group.label = entry.error
      ? `Changes vs ${entry.baseRef} (unavailable)`
      : `Changes vs ${entry.baseRef}`;
    entry.sourceControl.statusBarCommands = [
      {
        command: SELECT_BASE_COMMAND,
        title: `$(git-compare) ${entry.baseRef}`,
        arguments: [entry.sourceControl],
        tooltip: entry.error
          ? `Branch Changes unavailable: ${entry.error}`
          : this.getBaseTooltip(entry),
      },
    ];
  }

  getBaseTooltip(entry) {
    const source =
      entry.baseSource === "dev"
        ? "auto-detected from dev"
        : entry.baseSource === "origin/HEAD"
        ? "auto-detected from origin/HEAD"
        : entry.baseSource === "fallback"
          ? "auto-detected from conventional branch names"
          : "configured explicitly";
    return `Showing ${entry.baseRef}...${entry.currentRef} as unstaged changes (${source})`;
  }

  getConfiguredBaseRef(repoRoot) {
    const value = vscode.workspace
      .getConfiguration(CONFIG_SECTION, vscode.Uri.file(repoRoot))
      .get(BASE_REF_SETTING, AUTO_BASE_REF);
    return String(value || AUTO_BASE_REF).trim() || AUTO_BASE_REF;
  }

  isEnabled() {
    return vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get(ENABLED_SETTING, true);
  }

  isReviewEnabled() {
    return vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get(REVIEW_ENABLED_SETTING, true);
  }

  async getCurrentRef(repoRoot) {
    const branch = await this.git.run(repoRoot, ["branch", "--show-current"]);
    if (branch) {
      return branch;
    }
    return this.git.run(repoRoot, ["rev-parse", "--short", "HEAD"]);
  }

  async listRefs(repoRoot, currentBase) {
    const refs = new Set([AUTO_BASE_REF, "HEAD", currentBase]);
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

    return Array.from(refs).sort((left, right) => {
      if (left === currentBase) {
        return -1;
      }
      if (right === currentBase) {
        return 1;
      }
      return left.localeCompare(right);
    });
  }

  async pickEntry(sourceControl) {
    if (sourceControl && sourceControl.rootUri) {
      const direct = this.entries.get(normalizeFsPath(sourceControl.rootUri.fsPath));
      if (direct) {
        return direct;
      }
    }

    const entries = Array.from(this.entries.values());
    if (entries.length === 0) {
      vscode.window.showWarningMessage("Open a Git repository first.");
      return undefined;
    }
    if (entries.length === 1) {
      return entries[0];
    }

    const picked = await vscode.window.showQuickPick(
      entries.map((entry) => ({
        label: path.basename(entry.repoRoot),
        description: entry.repoRoot,
        entry,
      })),
      { placeHolder: "Select repository" }
    );
    return picked && picked.entry;
  }

  scheduleForUris(uris) {
    for (const uri of uris) {
      this.scheduleForUri(uri);
    }
  }

  scheduleForUri(uri) {
    if (!uri || uri.scheme !== "file") {
      return;
    }

    const entries = Array.from(this.entries.values()).sort(
      (left, right) => right.repoRoot.length - left.repoRoot.length
    );
    for (const entry of entries) {
      if (relativePathFromRoot(entry.repoRoot, uri.fsPath)) {
        this.scheduleEntry(entry);
        return;
      }
    }
  }

  scheduleForPath(repoRoot) {
    const entry = this.entries.get(normalizeFsPath(repoRoot));
    if (entry) {
      this.scheduleEntry(entry);
    }
  }

  scheduleEntry(entry) {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      this.runInBackground(this.refreshEntry(entry), "automatic refresh");
    }, REFRESH_DELAY_MS);
  }

  async attachGitExtension() {
    try {
      const extension = vscode.extensions.getExtension("vscode.git");
      if (!extension) {
        return;
      }
      const exports = extension.isActive
        ? extension.exports
        : await extension.activate();
      const api = exports && exports.getAPI && exports.getAPI(1);
      if (!api) {
        return;
      }

      for (const repository of api.repositories || []) {
        this.subscribeGitRepository(repository);
      }
      if (api.onDidOpenRepository) {
        this.disposables.push(
          api.onDidOpenRepository((repository) =>
            this.subscribeGitRepository(repository)
          )
        );
      }
      if (api.onDidCloseRepository) {
        this.disposables.push(
          api.onDidCloseRepository((repository) =>
            this.unsubscribeGitRepository(repository)
          )
        );
      }
    } catch {
      // Save and workspace events still provide a useful refresh fallback.
    }
  }

  subscribeGitRepository(repository) {
    if (
      !repository ||
      !repository.rootUri ||
      this.gitRepositorySubscriptions.has(repository)
    ) {
      return;
    }

    const disposable = repository.state.onDidChange(() =>
      this.scheduleForPath(repository.rootUri.fsPath)
    );
    this.gitRepositorySubscriptions.set(repository, disposable);
  }

  unsubscribeGitRepository(repository) {
    const disposable = this.gitRepositorySubscriptions.get(repository);
    if (disposable) {
      disposable.dispose();
      this.gitRepositorySubscriptions.delete(repository);
    }
  }

  disposeEntries() {
    for (const entry of this.entries.values()) {
      this.disposeEntry(entry);
    }
    this.entries.clear();
  }

  disposeEntry(entry) {
    entry.refreshToken += 1;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    entry.group.dispose();
    entry.sourceControl.dispose();
  }

  runInBackground(promise, operation) {
    Promise.resolve(promise).catch((error) =>
      vscode.window.showWarningMessage(
        `Branch Changes ${operation} failed: ${formatError(error)}`
      )
    );
  }
}

module.exports = {
  BASE_REF_SETTING,
  BranchReviewScmController,
  ENABLED_SETTING,
  OPEN_CHANGE_COMMAND,
  SELECT_BASE_COMMAND,
  SOURCE_CONTROL_ID,
};

"use strict";

const path = require("path");

function parseWorktreeList(output) {
  return output
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const worktree = {
        path: "",
        head: "",
        branch: undefined,
        detached: false,
      };

      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("worktree ")) {
          worktree.path = path.normalize(line.slice("worktree ".length));
        } else if (line.startsWith("HEAD ")) {
          worktree.head = line.slice("HEAD ".length);
        } else if (line.startsWith("branch ")) {
          const ref = line.slice("branch ".length);
          worktree.branch = ref.startsWith("refs/heads/")
            ? ref.slice("refs/heads/".length)
            : ref;
        } else if (line === "detached") {
          worktree.detached = true;
        }
      }

      return worktree;
    })
    .filter((worktree) => worktree.path);
}

function parseNameStatus(output) {
  const tokens = output.split("\0").filter(Boolean);
  const files = [];
  let index = 0;

  while (index < tokens.length) {
    const status = tokens[index++];
    if (!status) {
      continue;
    }

    const statusKind = status.charAt(0);
    if (statusKind === "R" || statusKind === "C") {
      const oldPath = tokens[index++];
      const newPath = tokens[index++];
      if (oldPath && newPath) {
        files.push({
          path: newPath,
          oldPath,
          status,
          statusKind,
        });
      }
      continue;
    }

    const filePath = tokens[index++];
    if (filePath) {
      files.push({
        path: filePath,
        status,
        statusKind,
      });
    }
  }

  return files;
}

function parseUntrackedFiles(output) {
  return output
    .split("\0")
    .filter(Boolean)
    .map((filePath) => ({
      path: filePath,
      status: "A",
      statusKind: "A",
    }));
}

function mergeFileStatuses(primary, additions) {
  const byPath = new Map();
  for (const file of primary) {
    byPath.set(file.path, file);
  }

  for (const file of additions) {
    if (!byPath.has(file.path)) {
      byPath.set(file.path, file);
    }
  }

  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function buildChangeIndex(files) {
  const byPath = new Map();
  const byOldPath = new Map();
  const folders = new Set();
  const stats = {
    A: 0,
    M: 0,
    D: 0,
    R: 0,
    C: 0,
    U: 0,
    other: 0,
  };

  for (const file of files) {
    byPath.set(file.path, file);
    addParentFolders(folders, file.path);

    if (file.oldPath) {
      byOldPath.set(file.oldPath, file);
      addParentFolders(folders, file.oldPath);
    }

    if (Object.prototype.hasOwnProperty.call(stats, file.statusKind)) {
      stats[file.statusKind] += 1;
    } else {
      stats.other += 1;
    }
  }

  return {
    byPath,
    byOldPath,
    folders,
    stats,
  };
}

function addParentFolders(folders, filePath) {
  let current = path.posix.dirname(filePath);
  while (current && current !== ".") {
    folders.add(current);
    current = path.posix.dirname(current);
  }
}

function relativePathFromRoot(rootPath, filePath) {
  const relativePath = path.relative(rootPath, filePath);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    return undefined;
  }

  return relativePath.split(path.sep).join("/");
}

function statusInfo(statusKind) {
  switch (statusKind) {
    case "A":
      return {
        badge: "A",
        label: "added",
        tooltip: "Added",
        icon: "diff-added",
        color: "gitDecoration.addedResourceForeground",
      };
    case "D":
      return {
        badge: "D",
        label: "deleted",
        tooltip: "Deleted",
        icon: "diff-removed",
        color: "gitDecoration.deletedResourceForeground",
      };
    case "R":
      return {
        badge: "R",
        label: "renamed",
        tooltip: "Renamed",
        icon: "diff-renamed",
        color: "gitDecoration.renamedResourceForeground",
      };
    case "C":
      return {
        badge: "C",
        label: "copied",
        tooltip: "Copied",
        icon: "diff-renamed",
        color: "gitDecoration.renamedResourceForeground",
      };
    case "U":
      return {
        badge: "U",
        label: "conflict",
        tooltip: "Conflict",
        icon: "warning",
        color: "gitDecoration.conflictingResourceForeground",
      };
    case "M":
    default:
      return {
        badge: "M",
        label: "modified",
        tooltip: "Modified",
        icon: "diff-modified",
        color: "gitDecoration.modifiedResourceForeground",
      };
  }
}

function normalizeFsPath(filePath, platform = process.platform) {
  const resolved = path.resolve(filePath);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function shortSha(sha) {
  return sha ? sha.slice(0, 7) : undefined;
}

function trimTrailingNewline(value) {
  return value.replace(/[\r\n]+$/, "");
}

function formatError(error) {
  if (!error) {
    return "Unknown error";
  }

  const stderr = error.stderr && error.stderr.trim();
  const message = stderr || error.message || String(error);
  return message.replace(/\s+/g, " ").trim();
}

module.exports = {
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
};

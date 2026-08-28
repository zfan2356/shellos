"use strict";

const assert = require("assert/strict");
const path = require("path");
const test = require("node:test");

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
} = require("../src/git-utils");

test("parseWorktreeList parses branch and detached worktrees", () => {
  const output = [
    "worktree C:/repo/main",
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/main",
    "",
    "worktree C:/repo/feature-a",
    "HEAD 2222222222222222222222222222222222222222",
    "branch refs/heads/feature/A",
    "",
    "worktree /tmp/detached-review",
    "HEAD 3333333333333333333333333333333333333333",
    "detached",
    "",
  ].join("\n");

  assert.deepEqual(parseWorktreeList(output), [
    {
      path: path.normalize("C:/repo/main"),
      head: "1111111111111111111111111111111111111111",
      branch: "main",
      detached: false,
    },
    {
      path: path.normalize("C:/repo/feature-a"),
      head: "2222222222222222222222222222222222222222",
      branch: "feature/A",
      detached: false,
    },
    {
      path: path.normalize("/tmp/detached-review"),
      head: "3333333333333333333333333333333333333333",
      branch: undefined,
      detached: true,
    },
  ]);
});

test("parseWorktreeList ignores non-worktree blocks", () => {
  const output = [
    "garbage true",
    "branch refs/heads/main",
    "",
    "worktree /repo/valid",
    "HEAD abc",
    "branch refs/heads/topic",
  ].join("\n");

  assert.deepEqual(parseWorktreeList(output), [
    {
      path: path.normalize("/repo/valid"),
      head: "abc",
      branch: "topic",
      detached: false,
    },
  ]);
});

test("parseNameStatus parses modified, added, deleted, rename, copy, and conflict", () => {
  const output = [
    "M",
    "src/app.js",
    "A",
    "src/new.js",
    "D",
    "src/old.js",
    "R100",
    "src/from.js",
    "src/to.js",
    "C075",
    "src/base.js",
    "src/copy.js",
    "U",
    "src/conflict.js",
    "",
  ].join("\0");

  assert.deepEqual(parseNameStatus(output), [
    { path: "src/app.js", status: "M", statusKind: "M" },
    { path: "src/new.js", status: "A", statusKind: "A" },
    { path: "src/old.js", status: "D", statusKind: "D" },
    {
      path: "src/to.js",
      oldPath: "src/from.js",
      status: "R100",
      statusKind: "R",
    },
    {
      path: "src/copy.js",
      oldPath: "src/base.js",
      status: "C075",
      statusKind: "C",
    },
    { path: "src/conflict.js", status: "U", statusKind: "U" },
  ]);
});

test("parseNameStatus skips incomplete records instead of producing undefined paths", () => {
  const output = ["M", "src/app.js", "R100", "old-only.js", ""].join("\0");

  assert.deepEqual(parseNameStatus(output), [
    { path: "src/app.js", status: "M", statusKind: "M" },
  ]);
});

test("parseUntrackedFiles converts nul-delimited paths to added statuses", () => {
  const output = ["notes/todo.md", "src/file with spaces.py", ""].join("\0");

  assert.deepEqual(parseUntrackedFiles(output), [
    { path: "notes/todo.md", status: "A", statusKind: "A" },
    { path: "src/file with spaces.py", status: "A", statusKind: "A" },
  ]);
});

test("mergeFileStatuses keeps tracked statuses, adds untracked files, and sorts by path", () => {
  const tracked = [
    { path: "src/b.js", status: "M", statusKind: "M" },
    { path: "src/a.js", status: "D", statusKind: "D" },
  ];
  const untracked = [
    { path: "src/c.js", status: "A", statusKind: "A" },
    { path: "src/b.js", status: "A", statusKind: "A" },
  ];

  assert.deepEqual(mergeFileStatuses(tracked, untracked), [
    { path: "src/a.js", status: "D", statusKind: "D" },
    { path: "src/b.js", status: "M", statusKind: "M" },
    { path: "src/c.js", status: "A", statusKind: "A" },
  ]);
});

test("statusInfo returns UI metadata for every supported status and defaults to modified", () => {
  assert.equal(statusInfo("A").label, "added");
  assert.equal(statusInfo("D").label, "deleted");
  assert.equal(statusInfo("R").label, "renamed");
  assert.equal(statusInfo("C").label, "copied");
  assert.equal(statusInfo("U").label, "conflict");
  assert.equal(statusInfo("M").label, "modified");
  assert.equal(statusInfo("X").label, "modified");
});

test("buildChangeIndex maps changed paths, rename sources, folders, and stats", () => {
  const files = [
    { path: "src/app.js", status: "M", statusKind: "M" },
    {
      path: "src/new-name.js",
      oldPath: "src/old-name.js",
      status: "R100",
      statusKind: "R",
    },
    { path: "docs/guide.md", status: "D", statusKind: "D" },
  ];
  const index = buildChangeIndex(files);

  assert.equal(index.byPath.get("src/app.js"), files[0]);
  assert.equal(index.byPath.get("src/new-name.js"), files[1]);
  assert.equal(index.byOldPath.get("src/old-name.js"), files[1]);
  assert.equal(index.folders.has("src"), true);
  assert.equal(index.folders.has("docs"), true);
  assert.deepEqual(index.stats, {
    A: 0,
    M: 1,
    D: 1,
    R: 1,
    C: 0,
    U: 0,
    other: 0,
  });
});

test("normalizeFsPath lowercases only on Windows", () => {
  const sample = path.join("Some", "Repo");

  assert.equal(normalizeFsPath(sample, "win32"), path.resolve(sample).toLowerCase());
  assert.equal(normalizeFsPath(sample, "linux"), path.resolve(sample));
});

test("relativePathFromRoot returns POSIX relative paths only inside the repo", () => {
  const root = path.join("tmp", "repo");
  const file = path.join(root, "src", "app.py");
  const outside = path.join("tmp", "other", "app.py");

  assert.equal(relativePathFromRoot(root, file), "src/app.py");
  assert.equal(relativePathFromRoot(root, root), undefined);
  assert.equal(relativePathFromRoot(root, outside), undefined);
});

test("shortSha handles missing and full SHA values", () => {
  assert.equal(shortSha(undefined), undefined);
  assert.equal(shortSha("1234567890abcdef"), "1234567");
});

test("trimTrailingNewline removes trailing CRLF and LF sequences", () => {
  assert.equal(trimTrailingNewline("hello\r\n\n"), "hello");
  assert.equal(trimTrailingNewline("hello"), "hello");
});

test("formatError prefers stderr and compacts whitespace", () => {
  assert.equal(formatError(null), "Unknown error");
  assert.equal(formatError(new Error("plain failure")), "plain failure");

  const error = new Error("ignored");
  error.stderr = "fatal:\n  failed   hard\n";
  assert.equal(formatError(error), "fatal: failed hard");
});

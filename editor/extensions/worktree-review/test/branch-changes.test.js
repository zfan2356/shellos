"use strict";

const assert = require("assert/strict");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const {
  AUTO_BASE_REF,
  collectBranchChanges,
  findCompareBase,
  resolveBranchBase,
  resolveCommit,
} = require("../src/branch-changes");

test("collectBranchChanges merges committed, tracked workspace, and untracked changes", async () => {
  const calls = [];
  const git = {
    async run(repoRoot, args, options) {
      calls.push({ args, options, repoRoot });
      if (args[0] === "rev-parse" && args[2] === "main^{commit}") {
        return "base-commit";
      }
      if (args[0] === "rev-parse" && args[2] === "feature^{commit}") {
        return "head-commit";
      }
      if (args[0] === "merge-base") {
        return "fork-point";
      }
      if (args[0] === "diff") {
        return [
          "M",
          "src/app.js",
          "R100",
          "src/old.js",
          "src/new.js",
          "",
        ].join("\0");
      }
      if (args[0] === "ls-files") {
        return ["notes.txt", ""].join("\0");
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  };

  const result = await collectBranchChanges(git, "/repo", "main", "feature");

  assert.equal(result.baseCommit, "base-commit");
  assert.equal(result.headCommit, "head-commit");
  assert.equal(result.compareBaseRef, "fork-point");
  assert.deepEqual(result.files, [
    {
      compareBaseRef: "fork-point",
      path: "notes.txt",
      status: "A",
      statusKind: "A",
    },
    {
      compareBaseRef: "fork-point",
      path: "src/app.js",
      status: "M",
      statusKind: "M",
    },
    {
      compareBaseRef: "fork-point",
      oldPath: "src/old.js",
      path: "src/new.js",
      status: "R100",
      statusKind: "R",
    },
  ]);
  const diffCall = calls.find((call) => call.args[0] === "diff");
  assert.deepEqual(diffCall.args, [
    "diff",
    "--no-ext-diff",
    "--name-status",
    "--find-renames",
    "-z",
    "fork-point",
    "--",
  ]);
  assert.deepEqual(diffCall.options, { trim: false });
});

test("findCompareBase falls back to the resolved base for unrelated histories", async () => {
  const git = {
    async run() {
      throw new Error("no merge base");
    },
  };

  assert.equal(
    await findCompareBase(git, "/repo", "base-commit", "head-commit"),
    "base-commit"
  );
});

test("findCompareBase uses the latest common ancestor of base and target", async () => {
  const calls = [];
  const git = {
    async run(repoRoot, args) {
      calls.push({ args, repoRoot });
      return "fork-point";
    },
  };

  assert.equal(
    await findCompareBase(git, "/repo", "base-commit", "head-commit"),
    "fork-point"
  );
  assert.deepEqual(calls, [
    {
      args: ["merge-base", "base-commit", "head-commit"],
      repoRoot: "/repo",
    },
  ]);
});

test("resolveCommit verifies that the configured ref names a commit", async () => {
  const calls = [];
  const git = {
    async run(repoRoot, args) {
      calls.push({ args, repoRoot });
      return "resolved";
    },
  };

  assert.equal(await resolveCommit(git, "/repo", "origin/main"), "resolved");
  assert.deepEqual(calls, [
    {
      args: ["rev-parse", "--verify", "origin/main^{commit}"],
      repoRoot: "/repo",
    },
  ]);
});

test("resolveBranchBase uses an explicit configured ref", async () => {
  const calls = [];
  const git = {
    async run(repoRoot, args) {
      calls.push({ args, repoRoot });
      return "resolved";
    },
  };

  assert.deepEqual(await resolveBranchBase(git, "/repo", "origin/dev"), {
    ref: "origin/dev",
    source: "configured",
  });
  assert.deepEqual(calls, [
    {
      args: ["rev-parse", "--verify", "origin/dev^{commit}"],
      repoRoot: "/repo",
    },
  ]);
});

test("resolveBranchBase auto-detects the remote default branch", async () => {
  const git = {
    async run(_repoRoot, args) {
      if (args[0] === "symbolic-ref") {
        return "origin/dev";
      }
      if (args[0] === "rev-parse" && args[2] === "origin/dev^{commit}") {
        return "base-commit";
      }
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    },
  };

  assert.deepEqual(await resolveBranchBase(git, "/repo", AUTO_BASE_REF), {
    ref: "origin/dev",
    source: "origin/HEAD",
  });
});

test("resolveBranchBase falls back when origin HEAD is unavailable", async () => {
  const git = {
    async run(_repoRoot, args) {
      if (args[0] === "symbolic-ref") {
        throw new Error("missing origin HEAD");
      }
      if (args[0] === "rev-parse" && args[2] === "main^{commit}") {
        return "base-commit";
      }
      throw new Error("missing ref");
    },
  };

  assert.deepEqual(await resolveBranchBase(git, "/repo", AUTO_BASE_REF), {
    ref: "main",
    source: "fallback",
  });
});

test("collectBranchChanges reads committed, staged, unstaged, and untracked files from Git", async (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-review-"));
  t.after(() => fs.rmSync(repoRoot, { force: true, recursive: true }));

  const runGit = (args) =>
    cp.execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  runGit(["init", "-b", "main"]);
  runGit(["config", "user.email", "worktree-review@example.com"]);
  runGit(["config", "user.name", "Worktree Review Test"]);
  fs.writeFileSync(path.join(repoRoot, "base.txt"), "base\n");
  runGit(["add", "base.txt"]);
  runGit(["commit", "-m", "Create base"]);

  runGit(["checkout", "-b", "feature"]);
  fs.writeFileSync(path.join(repoRoot, "base.txt"), "committed\n");
  fs.writeFileSync(path.join(repoRoot, "committed.txt"), "committed\n");
  runGit(["add", "base.txt", "committed.txt"]);
  runGit(["commit", "-m", "Add feature"]);

  fs.writeFileSync(path.join(repoRoot, "base.txt"), "committed\nunstaged\n");
  fs.writeFileSync(path.join(repoRoot, "staged.txt"), "staged\n");
  runGit(["add", "staged.txt"]);
  fs.writeFileSync(path.join(repoRoot, "untracked.txt"), "untracked\n");

  const git = {
    async run(cwd, args, options = {}) {
      const output = cp.execFileSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return options.trim === false
        ? output
        : output.replace(/[\r\n]+$/, "");
    },
  };
  const result = await collectBranchChanges(git, repoRoot, "main");

  assert.deepEqual(
    result.files.map((file) => [file.statusKind, file.path]),
    [
      ["M", "base.txt"],
      ["A", "committed.txt"],
      ["A", "staged.txt"],
      ["A", "untracked.txt"],
    ]
  );
  assert.equal(result.compareBaseRef, result.baseCommit);
});

test("collectBranchChanges compares merge-base to the selected feature worktree", async (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-review-direction-"));
  const repoRoot = path.join(fixtureRoot, "repo");
  const featureRoot = path.join(fixtureRoot, "feature");
  fs.mkdirSync(repoRoot);
  t.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }));

  const runGit = (args) =>
    cp.execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).replace(/[\r\n]+$/, "");

  runGit(["init", "-b", "dev"]);
  runGit(["config", "user.email", "worktree-review@example.com"]);
  runGit(["config", "user.name", "Worktree Review Test"]);
  fs.writeFileSync(path.join(repoRoot, "base.txt"), "base\n");
  runGit(["add", "base.txt"]);
  runGit(["commit", "-m", "Create base"]);

  runGit(["checkout", "-b", "feature"]);
  fs.writeFileSync(path.join(repoRoot, "feature.txt"), "feature\n");
  runGit(["rm", "base.txt"]);
  runGit(["add", "feature.txt"]);
  runGit(["commit", "-m", "Add feature"]);

  runGit(["checkout", "dev"]);
  fs.writeFileSync(path.join(repoRoot, "dev.txt"), "dev\n");
  runGit(["add", "dev.txt"]);
  runGit(["commit", "-m", "Advance dev"]);
  runGit(["worktree", "add", featureRoot, "feature"]);

  const git = {
    async run(cwd, args, options = {}) {
      const output = cp.execFileSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return options.trim === false
        ? output
        : output.replace(/[\r\n]+$/, "");
    },
  };
  const expectedMergeBase = runGit(["merge-base", "dev", "feature"]);
  const result = await collectBranchChanges(
    git,
    featureRoot,
    "dev",
    "feature"
  );

  assert.equal(result.compareBaseRef, expectedMergeBase);
  assert.deepEqual(
    result.files.map((file) => [file.statusKind, file.path]),
    [
      ["D", "base.txt"],
      ["A", "feature.txt"],
    ]
  );
});

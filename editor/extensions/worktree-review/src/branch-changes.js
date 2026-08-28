"use strict";

const {
  mergeFileStatuses,
  parseNameStatus,
  parseUntrackedFiles,
} = require("./git-utils");

const AUTO_BASE_REF = "auto";
const FALLBACK_BASE_REFS = [
  "origin/main",
  "main",
  "origin/master",
  "master",
  "origin/dev",
  "dev",
];

async function collectBranchChanges(git, repoRoot, baseRef, headRef = "HEAD") {
  const [baseCommit, headCommit] = await Promise.all([
    resolveCommit(git, repoRoot, baseRef),
    resolveCommit(git, repoRoot, headRef),
  ]);
  const compareBaseRef = await findCompareBase(
    git,
    repoRoot,
    baseCommit,
    headCommit
  );
  const [trackedOutput, untrackedOutput] = await Promise.all([
    git.run(
      repoRoot,
      [
        "diff",
        "--no-ext-diff",
        "--name-status",
        "--find-renames",
        "-z",
        compareBaseRef,
        "--",
      ],
      { trim: false }
    ),
    git.run(
      repoRoot,
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { trim: false }
    ),
  ]);
  const tracked = parseNameStatus(trackedOutput);
  const untracked = parseUntrackedFiles(untrackedOutput);
  const files = mergeFileStatuses(tracked, untracked).map((file) => ({
    ...file,
    compareBaseRef,
  }));

  return {
    baseCommit,
    compareBaseRef,
    files,
    headCommit,
  };
}

async function resolveCommit(git, repoRoot, ref) {
  return git.run(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`]);
}

async function findCompareBase(git, repoRoot, baseCommit, headCommit) {
  try {
    return await git.run(repoRoot, [
      "merge-base",
      "--fork-point",
      baseCommit,
      headCommit,
    ]);
  } catch {
    try {
      return await git.run(repoRoot, ["merge-base", baseCommit, headCommit]);
    } catch {
      return baseCommit;
    }
  }
}

async function resolveBranchBase(git, repoRoot, configuredRef = AUTO_BASE_REF) {
  const requested = String(configuredRef || AUTO_BASE_REF).trim() || AUTO_BASE_REF;
  if (requested.toLowerCase() !== AUTO_BASE_REF) {
    await resolveCommit(git, repoRoot, requested);
    return {
      ref: requested,
      source: "configured",
    };
  }

  try {
    const remoteDefault = await git.run(repoRoot, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    if (remoteDefault && (await canResolveCommit(git, repoRoot, remoteDefault))) {
      return {
        ref: remoteDefault,
        source: "origin/HEAD",
      };
    }
  } catch {
    // Fall through to conventional branch names.
  }

  for (const ref of FALLBACK_BASE_REFS) {
    if (await canResolveCommit(git, repoRoot, ref)) {
      return {
        ref,
        source: "fallback",
      };
    }
  }

  throw new Error(
    "Could not auto-detect a base ref. Configure worktreeReview.branchChanges.baseRef."
  );
}

async function canResolveCommit(git, repoRoot, ref) {
  try {
    await resolveCommit(git, repoRoot, ref);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  AUTO_BASE_REF,
  FALLBACK_BASE_REFS,
  collectBranchChanges,
  findCompareBase,
  resolveBranchBase,
  resolveCommit,
};

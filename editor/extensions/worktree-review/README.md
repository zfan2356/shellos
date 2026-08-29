# Worktree Review

Worktree Review is a VS Code extension for reviewing cumulative branch changes and Git worktree branches without rewriting repository state.

It is built for parallel AI-agent workflows where each agent owns a Git worktree and pushes or commits to its own branch.

## Branch Changes source control

The extension adds a read-only `Branch Changes` provider to the normal Source Control view. It shows the combined difference from the selected base branch's merge base with the current branch to the current workspace, including committed, staged, unstaged, untracked, and deleted files.

All change kinds are intentionally collapsed into one `Changes vs <base>` group. This is only a visual projection: the extension never moves `HEAD`, resets the index, or changes files.

Click a file to open the native VS Code diff editor directly. Deleted files remain in the list with a `D` badge and open against an empty right-hand side. Added and untracked files open against an empty left-hand side.

The provider is enabled by default. `worktreeReview.branchChanges.baseRef` defaults to `auto`, which prefers `origin/HEAD` and then checks conventional `main`, `master`, and `dev` refs. Set it explicitly when needed, for example:

```json
"worktreeReview.branchChanges.baseRef": "origin/dev"
```

The actual comparison starts at the merge base of the selected base branch and the reviewed branch, then ends at the current worktree. This includes committed and uncommitted worktree changes without treating unrelated changes added to the base branch later as part of the review.

## Review controls

The command palette intentionally exposes only four `Worktree Review` controls:

- `Select Base Branch`
- `Use Side-by-Side Diff`
- `Use Inline Diff`
- `Toggle Automatic Review`

Side-by-side mode keeps the two editor columns visible even when the editor becomes narrow. Inline mode shows additions and deletions in one editor column. They are two layouts for the same base-versus-worktree comparison.

Automatic review decorates changed files in Explorer and replaces a changed source file opened from Explorer with its diff. Turning it off leaves manual review from the `Changes` tree available.

Refresh, worktree selection, copy-path, and file-opening actions remain available only where they are relevant, such as view toolbars and item context menus.

## Usage

1. Open the feature worktree in VS Code or Tode.
2. Open the Worktree Review activity bar item.
3. Choose the base branch. The current worktree is selected automatically; another linked worktree can be selected from the Worktrees list.
4. Choose side-by-side or inline layout.
5. Click a file in `Changes` to open its diff directly, or open a decorated changed file from Explorer while automatic review is enabled.

The normal Git provider remains unchanged and continues to show the real `git status`.

## Settings

- `worktreeReview.enabled`: enable Explorer decorations and automatic diff opening.
- `worktreeReview.diffLayout`: `sideBySide` or `inline`.
- `worktreeReview.includeCurrentWorktree`: include the current workspace in the Worktrees list.
- `worktreeReview.branchChanges.enabled`: show the read-only Branch Changes SCM provider.
- `worktreeReview.branchChanges.baseRef`: base branch used for merge-base comparison.
- `worktreeReview.gitPath`: Git executable path.

## Development

This extension has no build step.

```bash
npm run check
npm run package:vsix
```

To create a manual review fixture on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/create-review-fixture.ps1
```

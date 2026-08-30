# Worktree Review

Worktree Review follows the Git repository and branch that are open in the
current workspace. It reviews that branch against a selected base without
switching branches or rewriting repository state.

## Comparison model

The extension compares the current workspace, including committed, staged,
unstaged, and untracked changes, with the nearest common ancestor of `HEAD` and
the selected base branch. The default `auto` base prefers `dev`, then
`origin/dev`, `origin/HEAD`, `main`, or `master`.

Changing branches with normal Git commands automatically refreshes the review.
The extension has no worktree picker and never changes `HEAD` itself.

The read-only `Branch Changes` provider in the normal Source Control view lists
the cumulative result in one `Changes vs <base>` group. Deleted files remain in
the list with a `D` badge and open with an empty right-hand side. Added and
untracked files open with an empty left-hand side. The normal Git provider still
shows the real `git status` separately.

## Review controls

The command palette exposes four controls:

- `Open/Close Review`
- `Use Side-by-Side Diff`
- `Use Source View`
- `Select Base Branch`

Review is enabled by default in Side-by-Side mode. Opening it immediately shows
the active changed file, the last reviewed file, or the first branch change.
Switching modes immediately replaces the current Review tab; no second file
click or trigger command is needed. Closing Review immediately closes the
current Review tab in either mode.

The left-side status bar item is the primary open/close control and reports the
current branch, base, and layout. Side-by-Side mode shows the base and current
workspace in separate columns. Source mode opens the normal editable file with
gutter change markers. A deleted file always uses the diff editor because no
source file remains.

Clicking a file in the `Branch Changes` SCM group opens it in the active layout.
In ShellOS/Tode, a tracked Explorer pre-open hook asks the extension to resolve
a decorated changed file into its base/current URI pair. Explorer then opens
that pair as one Diff editor input, so no source editor is created or closed in
between. The resolver waits for initial and pending Git refreshes before it
decides whether a file changed. Other editors use the extension listener as a
compatibility fallback.

## Usage

1. Open a feature repository or worktree in VS Code or Tode.
2. Review opens immediately in Side-by-Side mode by default.
3. Use normal `git switch` or `git checkout` commands when changing branches;
   the comparison follows the new `HEAD` automatically.
4. Use the status bar button to close or reopen Review, and the two layout
   commands to switch the open Review immediately.

## Settings

- `worktreeReview.enabled`: keep Review open and decorate changed files.
- `worktreeReview.diffLayout`: `sideBySide` or `source`. Existing `inline`
  values migrate to Source mode.
- `worktreeReview.branchChanges.enabled`: show the read-only Branch Changes SCM
  provider.
- `worktreeReview.branchChanges.baseRef`: base branch used for the merge-base
  comparison.
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

param(
  [string] $OutputRoot = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path "review-fixtures"),
  [string] $GitPath = "git"
)

$ErrorActionPreference = "Stop"

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$suffix = [Guid]::NewGuid().ToString("N").Substring(0, 6)
$fixtureRoot = Join-Path $OutputRoot "wtr-$stamp-$suffix"
$mainRepo = Join-Path $fixtureRoot "main-repo"
$worktreesRoot = Join-Path $fixtureRoot "worktrees"

function Invoke-Git {
  param(
    [string] $Cwd
  )

  & $GitPath -C $Cwd @args
  if ($LASTEXITCODE -ne 0) {
    throw "git $($args -join ' ') failed in $Cwd"
  }
}

function Write-TextFile {
  param(
    [string] $Path,
    [string] $Content
  )

  $parent = Split-Path -Parent $Path
  if ($parent) {
    New-Item -ItemType Directory -Force $parent | Out-Null
  }

  Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
}

function Append-TextFile {
  param(
    [string] $Path,
    [string] $Content
  )

  Add-Content -LiteralPath $Path -Value $Content -Encoding UTF8
}

function Commit-All {
  param(
    [string] $Repo,
    [string] $Message
  )

  Invoke-Git $Repo add -A
  Invoke-Git $Repo commit -m $Message
}

New-Item -ItemType Directory -Force $mainRepo | Out-Null
New-Item -ItemType Directory -Force $worktreesRoot | Out-Null

& $GitPath -C $mainRepo init -b main | Out-Null
if ($LASTEXITCODE -ne 0) {
  & $GitPath -C $mainRepo init | Out-Null
  Invoke-Git $mainRepo checkout -b main
}

Invoke-Git $mainRepo config user.name "Worktree Fixture"
Invoke-Git $mainRepo config user.email "fixture@example.local"

Write-TextFile (Join-Path $mainRepo "README.md") @"
# Worktree Review Fixture

This repository is generated for manual VS Code extension testing.
"@

Write-TextFile (Join-Path $mainRepo "src\app.py") @"
from src.math_utils import add


def run():
    return add(2, 3)


if __name__ == "__main__":
    print(run())
"@

Write-TextFile (Join-Path $mainRepo "src\math_utils.py") @"
def add(left, right):
    return left + right


def subtract(left, right):
    return left - right
"@

Write-TextFile (Join-Path $mainRepo "src\agent.py") @"
class Agent:
    def __init__(self, name):
        self.name = name

    def label(self):
        return f"agent:{self.name}"
"@

Write-TextFile (Join-Path $mainRepo "docs\guide.md") @"
# Guide

The base branch keeps this guide small on purpose.
"@

Write-TextFile (Join-Path $mainRepo "config\settings.json") @"
{
  "mode": "base",
  "review": false
}
"@

Commit-All $mainRepo "Seed base fixture"

$alphaBranch = "feature/wtr-alpha-$suffix"
$alphaPath = Join-Path $worktreesRoot "alpha-$suffix"
Invoke-Git $mainRepo worktree add -b $alphaBranch $alphaPath main
Append-TextFile (Join-Path $alphaPath "src\app.py") @"

def alpha_only():
    return "alpha-$suffix"
"@
Write-TextFile (Join-Path $alphaPath "src\feature_alpha.py") @"
def feature_name():
    return "alpha"
"@
Remove-Item -LiteralPath (Join-Path $alphaPath "docs\guide.md") -Force
Commit-All $alphaPath "Alpha modifies app, adds file, deletes guide"
Append-TextFile (Join-Path $alphaPath "src\app.py") @"

# dirty tracked change after commit
"@
Write-TextFile (Join-Path $alphaPath "notes\alpha-untracked.md") @"
# Untracked alpha note

This file is intentionally not committed.
"@

$renameBranch = "refactor/wtr-rename-$suffix"
$renamePath = Join-Path $worktreesRoot "rename-$suffix"
Invoke-Git $mainRepo worktree add -b $renameBranch $renamePath main
Invoke-Git $renamePath mv "src\math_utils.py" "src\calculations.py"
Append-TextFile (Join-Path $renamePath "src\calculations.py") @"

def multiply(left, right):
    return left * right
"@
Write-TextFile (Join-Path $renamePath "src\app.py") @"
from src.calculations import add, multiply


def run():
    return multiply(add(2, 3), 4)


if __name__ == "__main__":
    print(run())
"@
Commit-All $renamePath "Rename math utils and update app"

$docsBranch = "docs/wtr-copy-$suffix"
$docsPath = Join-Path $worktreesRoot "docs-$suffix"
Invoke-Git $mainRepo worktree add -b $docsBranch $docsPath main
Copy-Item -LiteralPath (Join-Path $docsPath "docs\guide.md") -Destination (Join-Path $docsPath "docs\review-guide.md")
Append-TextFile (Join-Path $docsPath "docs\review-guide.md") @"

## Review checklist

- Worktree appears in the sidebar.
- Changed files open as diffs.
- Added docs are marked correctly.
"@
Write-TextFile (Join-Path $docsPath "docs\agent-notes.md") @"
# Agent Notes

This branch focuses on documentation files.
"@
Commit-All $docsPath "Copy guide and add review docs"

$dirtyBranch = "experiment/wtr-dirty-$suffix"
$dirtyPath = Join-Path $worktreesRoot "dirty-$suffix"
Invoke-Git $mainRepo worktree add -b $dirtyBranch $dirtyPath main
Write-TextFile (Join-Path $dirtyPath "config\settings.json") @"
{
  "mode": "experiment",
  "review": true,
  "suffix": "$suffix"
}
"@
Commit-All $dirtyPath "Experiment updates settings"
Append-TextFile (Join-Path $dirtyPath "src\agent.py") @"

    def dirty_method(self):
        return "dirty-$suffix"
"@
Write-TextFile (Join-Path $dirtyPath "scratch\dirty-untracked.txt") @"
Untracked scratch file for Worktree Review.
"@

$summary = @"
# Fixture Summary

Open this folder in VS Code:

$mainRepo

Then open the Worktree Review activity bar item.

Generated branches:

- $alphaBranch
  - committed modified file: src/app.py
  - committed added file: src/feature_alpha.py
  - committed deleted file: docs/guide.md
  - dirty tracked file: src/app.py
  - untracked file: notes/alpha-untracked.md

- $renameBranch
  - rename: src/math_utils.py -> src/calculations.py
  - modified file: src/app.py

- $docsBranch
  - copied/added docs: docs/review-guide.md
  - added docs: docs/agent-notes.md

- $dirtyBranch
  - committed modified file: config/settings.json
  - dirty tracked file: src/agent.py
  - untracked file: scratch/dirty-untracked.txt

Useful commands:

git -C "$mainRepo" worktree list --porcelain
git -C "$mainRepo" branch --list
"@

Write-TextFile (Join-Path $fixtureRoot "FIXTURE.md") $summary

Write-Output $fixtureRoot
Write-Output $mainRepo

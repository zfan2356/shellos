---
name: shellos
description: Manage the shellos repo (github.com/zfan2356/shellos) — sync local kitty/tode config changes, extension changes, and version bumps back to GitHub. Use after changing any terminal/editor config, installing or removing tode extensions, upgrading kitty or tode, or when asked to "sync shellos".
---

# shellos — config sync to GitHub

Local checkout: `~/wxg/shellos` (remote `git@github.com:zfan2356/shellos.git`,
branch `main`, push over SSH). The repo is the source of truth for the
terminal environment; this skill pushes local reality INTO it. The reverse
direction (repo → fresh machine) is `skills/shellos-bootstrap/SKILL.md`
inside the repo.

## How config flows

- **Editor config is symlinked, not copied**: `editor/settings.json` is the
  live settings file of BOTH tode and Cursor (their User-dir settings.json
  are symlinks into this repo; per-target keybindings likewise). Any change
  made in either editor lands in the repo working tree immediately.
  `scripts/link.sh` (re)creates the symlinks if an editor replaced one with
  a real file.
- **kitty / tode shortcuts / tode theme** are machine-authoritative: run
  `scripts/sync.sh` to snapshot them into the repo.
- **Extension lists** (`editor/extensions.<target>.txt`) are maintained by
  hand: update them in the same commit as an install/uninstall. Internal
  extensions belong in the untracked `editor/extensions.<target>.local.txt`.
- **Remote editor config is generated, not independently edited**:
  `scripts/deploy-remote-tode.sh <ssh-alias>` copies the canonical tode
  keybindings and renders shared settings with only Linux shell/Codex
  overrides. The remote wrapper source is `scripts/tode-remote-wrapper`.

## Commit workflow

1. `git diff` — editor edits are already in the working tree; run
   `scripts/sync.sh` first if kitty/shortcuts/theme changed.
2. **Red-line check, every time** (the repo is PUBLIC and editors AUTO-WRITE
   keys into the symlinked settings — e.g. Remote-SSH writes host-platform
   maps with internal hostnames):
   ```bash
   ./scripts/redline.sh
   ```
   Must print `redline: clean`. On a hit in `editor/settings.json`, DELETE
   the offending key before committing (Remote-SSH re-asks the platform on
   next connect; that is acceptable). The forbidden-pattern list lives in
   `.redline-local` (untracked on purpose — the list itself is sensitive;
   recreate from local Claude memory if missing).
3. Commit with a message saying WHAT changed and WHY, then `git push`.

## When kitty or tode is upgraded

Bump the matching submodule pin so the repo tracks the version in use:

```bash
cd ~/wxg/shellos/third-party/kitty        && git fetch --tags origin && git checkout v<new>
cd ~/wxg/shellos/third-party/terminal-code && git fetch --tags origin && git checkout v<new>
cd ~/wxg/shellos && git add third-party && git commit -m "Pin kitty vX / tode vY"
```

Versions in use: `kitty --version`, `tode --version`. After a tode upgrade
also re-check that user-data config survived (it should — upgrades replace
the install dir, not the data dir) and run the sync workflow.

## When knowledge changes

If a new pitfall or procedure is discovered (install sources, extension
quirks, shortcut regeneration, …), fold it into
`skills/shellos-bootstrap/SKILL.md` or `docs/` in the same commit as the
config change — the bootstrap skill is only useful if it stays current.

## Layout reminders

- `editor/settings.json` = live shared settings of tode AND Cursor (symlink
  targets: `~/.local/share/tode/vscode/user-data/User/settings.json`,
  `~/Library/Application Support/Cursor/User/settings.json`)
- `editor/keybindings.{tode,cursor}.json` = per-editor keybindings (same
  symlink scheme; commands differ per editor, e.g. cmd+i)
- `kitty/` ← `~/.config/kitty/` (minus ssh.conf, local-only)
- `tode/` ← `~/.local/share/tode/` (shortcuts.json, theme files)
- `scripts/tode-remote-wrapper` → remote `~/.local/share/shellos/`, with the
  remote-only alias/port/shell stored outside the repo in
  `~/.config/shellos/remote-tode.env`
- Hard red lines: no internal host names or machine identifiers anywhere;
  the remote dev box is only ever "a remote dev server"; its patches live in
  local Claude memory, never in the repo.
- This skill is symlinked from `~/.claude/skills/shellos` → the repo copy,
  so editing it here versions it automatically.

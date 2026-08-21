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

## Sync workflow

1. Snapshot live config into the repo:
   ```bash
   cd ~/wxg/shellos && ./scripts/sync.sh
   ```
   This copies kitty conf, tode settings/keybindings/shortcuts/theme, and
   regenerates `tode/extensions.txt` from the installed-extension registry.

2. Review `git diff` and drop anything that shouldn't land (see red lines).
   If a live-config change was experimental or accidental, revert the repo
   file rather than committing noise.

3. **Red-line check before every commit** (the repo is PUBLIC):
   ```bash
   ./scripts/redline.sh
   ```
   Must print `redline: clean`. The forbidden-pattern list lives in
   `.redline-local` (untracked on purpose — the list itself is sensitive;
   recreate it from local Claude memory if missing). Hard rules:
   - No internal host names or machine identifiers anywhere. The remote dev
     box is only ever "a remote dev server"; its specific patches stay OUT
     of the repo (they live in local Claude memory).
   - `~/.config/kitty/ssh.conf` is local-only — never add it (sync.sh
     already skips it; it's in .gitignore).

4. Commit with a message saying WHAT changed and WHY (e.g. "Add
   files.watcherExclude — .venv watcher noise amplified wake-up jank"),
   then `git push`.

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

- `kitty/` ← `~/.config/kitty/` (minus ssh.conf)
- `tode/` ← `~/.local/share/tode/vscode/user-data/User/` (settings,
  keybindings) + `~/.local/share/tode/` (shortcuts.json, theme files)
- `tode/extensions.txt` ← extension registry (informational inventory;
  `tode.*` internals excluded)
- This skill is symlinked from `~/.claude/skills/shellos` → the repo copy,
  so editing it here versions it automatically.

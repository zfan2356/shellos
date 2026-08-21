---
name: shellos-bootstrap
description: Restore the shellos terminal environment (kitty + terminal-code/tode + Python tooling) on a fresh macOS machine from the shellos repo. Use when asked to bootstrap, restore, or set up the terminal environment, or after a tode upgrade wiped customizations.
---

# shellos bootstrap

Restore the full terminal workspace from this repo. `$REPO` below means the
root of the shellos checkout (the directory containing this skill).
Run steps in order; each has a verification. Ask before overwriting any
existing config that differs from the repo — the machine may have newer
local edits (offer to run `scripts/sync.sh` instead).

## 0. Network reality check

- `*.workers.dev` (tode's official download CDN) is blocked in this network.
  Always use GitHub releases instead — same assets, verify sha256 matches the
  official install script if in doubt.
- GitHub and open-vsx.org are reachable. The VS Code marketplace is NOT usable
  from code-server (no gallery configured), so extensions come from Open VSX
  vsix downloads or from a local `tode --import` of an existing VS Code.

## 1. kitty

```bash
brew install --cask kitty
brew install --cask font-maple-mono-nf-cn   # kitty.conf uses "Maple Mono NF CN"
# fallback if the cask is missing: download from github.com/subframe7536/maple-font releases
mkdir -p ~/.config/kitty/tode
cp $REPO/kitty/kitty.conf $REPO/kitty/current-theme.conf \
   $REPO/kitty/macos-launch-services-cmdline ~/.config/kitty/
cp $REPO/kitty/tode/keybinds.kitty.conf ~/.config/kitty/tode/
```

`~/.config/kitty/ssh.conf` (kitten-ssh per-host settings) is local-only and
NOT in this repo — it holds private host aliases. Recreate it by hand; see
`docs/remote-server.md` for what belongs in it.

Verify: launch kitty; font renders, Catppuccin theme active, `cmd+d` splits
vertically. Reload a running kitty with `pkill -USR1 -x kitty`.

## 2. terminal-code (tode)

Install from GitHub releases of `zenbu-labs/terminal-code` (NOT the official
installer — it pulls from workers.dev, see step 0). Pick the latest release
asset for macOS arm64, install so that `tode` is on PATH (`~/.local/bin/tode`).

Then restore config. Editor settings/keybindings are SYMLINKED into the
repo checkout (shared between tode and Cursor — the repo must stay at a
stable path):

```bash
mkdir -p ~/.local/share/tode/vscode/user-data/User
$REPO/scripts/link.sh
cp $REPO/tode/shortcuts.json ~/.local/share/tode/
cp $REPO/tode/theme/palette.json $REPO/tode/theme/live-theme.json \
   $REPO/tode/theme/inject.css ~/.local/share/tode/
```

Notes on what these files are:
- `shortcuts.json` is the decision record from `tode --shortcut-setup`
  (56 kitty/editor conflicts, resolved: pane switching only `alt+cmd+arrows`,
  kitty tabs `ctrl+shift+←→` + `alt+1-9`, `cmd+d` = editor duplicate-line,
  kitty vsplit moved to `ctrl+shift+d`, `cmd+=/-/0` = browser page zoom,
  kitty font zoom on default `ctrl+shift+=/-`). The generated kitty side of
  this contract is `kitty/tode/keybinds.kitty.conf`, restored in step 1 —
  restoring both files IS the shortcut setup; do not rerun `--shortcut-setup`.
- `settings.json` already contains the Python contract (step 3 explains why):
  `python.languageServer: "None"`, `python.defaultInterpreterPath:
  "${workspaceFolder}/.venv/bin/python"` (auto-selects a project .venv when
  present), `python-envs.defaultEnvManager: ms-python.python:venv`, and
  `basedpyright.analysis.typeCheckingMode: "off"` (lint belongs to ruff;
  the language server is only for navigation).

## 3. Extensions

`$REPO/editor/extensions.tode.txt` is the exact inventory. Two supported
sources can provide extension bytes, but neither source changes the inventory:

**When a VS Code / Cursor with these extensions exists locally:**
`tode --import` can copy extension files quickly, but it is not a configuration
restore. It also imports unlisted extensions and REPLACES the User
settings/keybindings symlinks with real files. After using it, re-run
`$REPO/scripts/link.sh`, uninstall every extension not listed in
`editor/extensions.tode.txt` (except tode's own `tode.tode-bridge` and
`tode.tode-theme`), and install every missing listed extension.

**From Open VSX (fresh machine):** for each ID in extensions.txt, try
`https://open-vsx.org/api/<publisher>/<name>` — if present, download the vsix
and install:

```bash
CS=~/.local/share/tode/code-server/*/bin/code-server
$CS --extensions-dir ~/.local/share/tode/vscode/extensions \
    --user-data-dir ~/.local/share/tode/vscode/user-data \
    --install-extension <file>.vsix
```

Marketplace-only extensions (copilot etc.) cannot be fetched this
way. Fetch their official VSIX from the vendor marketplace when available;
otherwise report the missing inventory item.

**Python — non-negotiable pair:**
- `detachhead.basedpyright` MUST be installed (from Open VSX). It is what
  provides Python go-to-definition/completion.
- `ms-python.vscode-pylance` MUST NOT be installed: tode ships OSS
  code-server, Pylance's license check makes its language server silently
  refuse to start (extension "activates", server log stays 0 bytes, no
  navigation, and it conflicts with basedpyright). If an import brought it
  in: `$CS ... --uninstall-extension ms-python.vscode-pylance`.

## 4. Per-project Python (mimikyu/mmq checkouts)

Each checkout/worktree gets its own uv `.venv` + `pyrightconfig.json`
(venv + extraPaths + `typeCheckingMode: "off"`). This is a separate skill
(`mmq-python-env`) — apply it per repo, not here. The global settings from
step 2 make the editor auto-select `.venv/bin/python` wherever one exists.

## 5. Verify

- `tode` opens a project inside kitty; theme and keybindings feel right.
- Open a `.py` file in a project with `.venv`: status bar shows the venv
  interpreter without manual selection; go-to-definition works
  (basedpyright), no Pylance in the extension list.
- `pkill -USR1 -x kitty` applied the kitty side; `cmd+d` duplicates a line
  in the editor and `ctrl+shift+d` splits kitty.

## Remote dev server

The local machine pairs tightly with a remote dev server (tode runs there
too; kitty connects via `kitten ssh`). The generic pairing setup is in
`$REPO/docs/remote-server.md`. Machine-specific patches and host details are
deliberately NOT in this repo — they live in the owner's local notes; ask
before touching the remote side. Config restored by this skill lives in the
data dir and survives tode upgrades; any remote binary patches do not.

After local setup, deploy the generic remote wrapper and a generated Linux
version of the shared editor configuration:

```bash
$REPO/scripts/deploy-remote-tode.sh <ssh-alias> [port]
```

The local connection must use `kitten ssh <ssh-alias>`, and the alias must
match the `hostname` pattern in local-only `kitty/ssh.conf`. Verify remotely
that `KITTY_LISTEN_ON` is non-empty before testing `tode .`.

# shellos

Personal terminal workspace: kitty + terminal-code (tode) configs, keybindings,
and editor extensions, with an AI-driven bootstrap.

Shellos the Pokémon; shell + OS the pun. This repo is the single source of
truth for my macOS terminal environment:

- **[kitty](https://sw.kovidgoyal.net/kitty/)** — the terminal itself
- **[terminal-code (tode)](https://github.com/zenbu-labs/terminal-code)** — VS Code running inside kitty
- the keybinding contract between the two (56 conflicts resolved: terminal
  management belongs to kitty, editing belongs to the editor)
- Python language tooling that actually works in code-server
  (basedpyright — Pylance refuses to start outside official VS Code builds)

## Layout

| Path | Deploys to | What it is |
|---|---|---|
| `kitty/` | `~/.config/kitty/` | kitty.conf, theme, tode-generated keybinds (`ssh.conf` stays local-only) |
| `editor/` | symlinked into tode + Cursor User dirs | **the** editor config: one shared `settings.json` for both editors, per-target keybindings, per-target extension lists |
| `tode/shortcuts.json` | `~/.local/share/tode/` | shortcut-conflict decision record (source of the generated kitty keybinds) |
| `tode/theme/` | `~/.local/share/tode/` | tode theme files (palette, live-theme, inject.css) |
| `skills/shellos/` | `~/.claude/skills/shellos` (symlink) | agent skill: sync/apply workflow for this repo |
| `skills/shellos-bootstrap/` | — | agent skill: restore this environment on a fresh machine |
| `docs/remote-server.md` | — | how the local setup pairs with a remote dev server |
| `scripts/link.sh` | — | symlink the shared editor config into both editors (idempotent, backs up real files) |
| `scripts/sync.sh` | — | snapshot machine-authoritative files (kitty, shortcuts, theme) into the repo |
| `scripts/redline.sh` | — | pre-commit content check (pattern list is untracked) |
| `scripts/tode-remote` | `~/.local/bin/tode-remote` (symlink) | VS Code Remote-style editing: remote code-server + SSH tunnel + local rendering |
| `scripts/tode-remote-wrapper` | remote `~/.local/share/shellos/` | remote `tode` entrypoint: current-window overlay with pixel-mode fallback |
| `scripts/deploy-remote-tode.sh` | remote host | backs up and deploys the wrapper plus a Linux rendering of the shared editor config |
| `scripts/unstick-kitty.sh` | — | rescue a kitty wedged in the GPU driver: capture stack evidence, force-kill, print recovery steps |
| `third-party/kitty` | — | upstream kitty source, pinned to the version in use (submodule) |
| `third-party/terminal-code` | — | upstream tode source, pinned to the version in use (submodule) |

`editor/settings.json` IS the live config of both editors (symlinked, so an
edit in any editor's settings UI lands directly in the repo working tree —
review with `git diff`, then commit). kitty config, tode shortcut decisions,
and theme files flow machine → repo via `sync.sh`.

The tab mnemonic is the same everywhere: `T` creates and `W` closes. Kitty
owns the Command variants (`⌘T`/`⌘W`) for terminal tabs; tode owns the Control
variants (`⌃T`/`⌃W`) for editor tabs. The editor bindings are disabled while
the integrated terminal has focus, so normal shell controls still work.

## Bootstrap

Bootstrap is AI-driven: point a coding agent (Claude Code etc.) at
[`skills/shellos-bootstrap/SKILL.md`](skills/shellos-bootstrap/SKILL.md) and let
it walk the steps — it knows the install sources that work behind the GFW, the
file mapping, which extensions come from Open VSX vs. a VS Code import, and how
to verify the result.

```
git clone https://github.com/zfan2356/shellos.git
# then, in Claude Code:
#   "bootstrap my terminal env from ~/shellos, follow skills/shellos-bootstrap/SKILL.md"
```

For a paired remote host, run `scripts/deploy-remote-tode.sh <ssh-alias>`
after the local bootstrap. See `docs/remote-server.md` for the required
`kitten ssh` entrypoint and the generated remote-only overrides.

## Keeping the repo fresh

- Editor settings/keybindings are symlinked — any change (settings UI or
  editing the file) is already in the repo working tree. `git diff`, run
  `./scripts/redline.sh` (editors auto-write keys; remote-ssh host maps must
  be stripped before committing), commit.
- Installed/removed an extension? Update `editor/extensions.<target>.txt`
  in the same commit. Internal-only extensions go in the untracked
  `editor/extensions.<target>.local.txt`.
- Changed kitty config, tode shortcuts, or the tode theme? Run
  `./scripts/sync.sh` to pull the change into the repo.
- Always before committing: `./scripts/redline.sh` must print
  `redline: clean`.

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
| `tode/settings.json` | `~/.local/share/tode/vscode/user-data/User/` | editor settings (Python interpreter auto-select, theme overrides, …) |
| `tode/keybindings.json` | `~/.local/share/tode/vscode/user-data/User/` | editor keybindings |
| `tode/shortcuts.json` | `~/.local/share/tode/` | shortcut-conflict decision record (source of the generated kitty keybinds) |
| `tode/theme/` | `~/.local/share/tode/` | tode theme files (palette, live-theme, inject.css) |
| `tode/extensions.txt` | — | extension inventory (IDs, one per line) |
| `skills/shellos-bootstrap/` | — | agent skill: restore this environment on a fresh machine |
| `docs/remote-server.md` | — | how the local setup pairs with a remote dev server |
| `scripts/sync.sh` | — | snapshot the live config back into this repo |
| `third-party/kitty` | — | upstream kitty source, pinned to the version in use (submodule) |
| `third-party/terminal-code` | — | upstream tode source, pinned to the version in use (submodule) |

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

## Keeping the repo fresh

After changing any live config:

```bash
./scripts/sync.sh   # copies live files into the repo, shows the diff
git add -A && git commit
```

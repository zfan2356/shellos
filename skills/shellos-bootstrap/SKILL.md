---
name: shellos-bootstrap
description: Install or restore the complete ShellOS kitty and terminal-code/tode environment from a clean, published shellos main checkout, including tracked patches, extensions, skills, and the paired remote host. Use for a fresh machine, recovery, reinstall, or post-upgrade restoration.
---

# ShellOS bootstrap

Bootstrap is not a collection of manual installation steps. The committed
repository and its one complete reinstall script define the environment.

## Source and safety requirements

- Use the formal checkout at `~/wxg/shellos` on branch `main`.
- Do not edit installed files or apply a command from notes as a patch.
- Do not call helper scripts individually or install only the affected
  component.
- All patches and platform workarounds must already be committed and pushed.
- Only SSH keys, private host aliases, the generated remote alias file, and
  other true secrets may remain outside the repository.

If a new fix is needed, stop the bootstrap and follow the repository-change
workflow in `skills/shellos/SKILL.md`: independent checkout, validation,
commit, push, formal fast-forward pull, and then restart this full reinstall.

## Prerequisites

The local host is macOS arm64 with Homebrew, Git, curl, Node/npx, and Python 3.
The paired host is reachable by an SSH alias and supports Linux x64
or arm64. Keep private connection data in the user's SSH config and
`~/.config/kitty/ssh.conf`, never in the public repository.

The official tode CDN may be unavailable. The repository installer downloads
the GitHub release matching the committed `third-party/terminal-code` tag and
checks it against the matching versioned release manifest. Kitty must match
the committed `third-party/kitty` tag.

## Complete install

For a fresh checkout:

```bash
git clone --recurse-submodules https://github.com/zfan2356/shellos.git ~/wxg/shellos
cd ~/wxg/shellos
```

For an existing formal checkout, first ensure it is on clean `main`. Then run:

```bash
./scripts/reinstall-shellos.sh <ssh-alias> [port]
```

The script itself performs `git pull --ff-only origin main`, verifies exact
agreement with `origin/main`, initializes committed submodule pins, and refuses
a dirty or divergent checkout. If a preceding pull changed a submodule pin,
the temporary superproject `M` entry is expected; the installer updates it to
the committed pin but still rejects real uncommitted files inside submodules.

It then completely reinstalls the ShellOS-managed local environment:

- pinned kitty and the configured font;
- pinned tode from its checked release;
- canonical kitty, tode, Cursor, shortcut, and theme files as copies;
- the tracked renderer-freeze and Cmd/Ctrl-right-click patches plus macOS App Nap setting;
- the committed extension inventory and bundled Worktree Review extension;
- the `shellos` and `shellos-bootstrap` skills from the formal checkout;
- the remote launcher helper.

The same command always completely reinstalls the paired remote's pinned tode,
tracked renderer patch, generated Linux editor configuration, exact extension
inventory, Worktree Review, and remote wrapper. The installer refuses to run
without the SSH alias so a local-only deployment cannot be mistaken for a
complete ShellOS reinstall.

## Verify

After the command completes, verify:

```bash
git status --short
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
tode --version
kitty --version
```

The versions must match the exact tags checked out in
`third-party/terminal-code` and `third-party/kitty`. The complete installer
also verifies both tracked patch markers, App Nap setting, local and remote
Worktree Review installation, and the remote tode version.

Test the remote UI from a kitty-managed connection:

```bash
kitten ssh <ssh-alias>
tode <project-path>
```

`KITTY_LISTEN_ON` must be present remotely. Plain `ssh` cannot provide the
forwarded kitty control channel needed for the local overlay. Use
`View: Show Worktree Review` after the workspace opens; Tode `v0.2.0` does not
forward a trailing `--review` through its native SSH transport. See
`docs/remote-server.md`.

# Pairing ShellOS with a remote development server

The remote machine runs code-server while the local kitty/tode renderer shows
the UI. No editor pixels cross the network. The entire remote installation,
including every compatibility patch, is generated from the committed ShellOS
repository.

## Private SSH inputs

Keep SSH keys and aliases outside the public repository. Connect with
`kitten ssh <ssh-alias>` rather than plain `ssh`; this installs kitty shell
integration and forwards its remote-control socket.

The local-only `~/.config/kitty/ssh.conf` needs an entry such as:

```text
hostname <your-remote-host-patterns>
login_shell zsh
forward_remote_control yes
```

The alias passed to `kitten ssh` must match the `hostname` pattern. On the
remote, verify the connection before troubleshooting tode:

```bash
test -n "$KITTY_LISTEN_ON"
command -v kitten
```

Plain `ssh` does not provide this environment and cannot open the local overlay.
The SSH alias is case-sensitive and must also match the alias passed to the
last complete ShellOS reinstall. If the alias is renamed or its case changes,
rerun the complete installer with the new spelling. A local Tode startup error
is kept visible in the overlay until Enter is pressed instead of being reported
as a successful open.

## Installation and updates

Never install, patch, or copy an individual remote component manually. Add any
required fix to an independent ShellOS checkout, validate it, commit and push
it, fast-forward the formal checkout, and run the complete installer from the
formal checkout:

```bash
cd ~/wxg/shellos
git pull --ff-only origin main
./scripts/reinstall-shellos.sh <ssh-alias> [port]
```

The installer replaces the remote tode installation with the release pinned by
`third-party/terminal-code`, reapplies every tracked Tode patch, renders the Linux
form of canonical editor settings, restores the exact extension inventory and
Worktree Review, and installs the tracked remote wrapper. It then installs the
pinned dsh CLI and dsh-tui on the same host and writes the tracked harness
configuration; see `docs/dsh-tui.md`. The private alias,
compatibility port, and login shell are written to the remote-only
`~/.config/shellos/remote-tode.env`; this file contains connection identity,
not behavior or patch logic.

Internal scripts such as `deploy-remote-tode.sh`,
`install-worktree-review.sh` and `patch-terminal-browser.sh` deliberately
reject direct invocation.

## Usage

From a connection opened with `kitten ssh`:

```bash
tode <remote-project-path>
```

The remote `tode` wrapper asks the local kitty to launch local tode with its
native `--ssh` transport as an `overlay-main`. Closing the editor reveals the
same remote shell. Worktree Review follows the opened repository and current
Git branch automatically; when enabled, it immediately opens the first branch
change in the saved layout (Side-by-Side by default). Use the Review status bar
button to close or reopen it. The tracked Tode workbench patch lets changed
Explorer files open their review directly, without briefly opening and closing
the source tab first. The pinned Tode `v0.2.0` SSH transport does not
forward a trailing `--review` argument, so the repository does not advertise
that spelling for remote sessions. Leading flags are delegated to the pinned
remote pixel launcher when appropriate.

The local terminal-browser supervises its SSH SOCKS master. If a network
interruption kills that master while the remote Tode services remain alive,
it recreates the tunnel on the same local port so Chromium's existing proxy
configuration and WebSockets can reconnect. A white editor that keeps logging
WebSocket code 1006 together with a missing local SOCKS listener indicates this
patch is absent or the reconnect itself cannot reach the configured SSH host.

The historical `scripts/tode-remote <ssh-host> [remote-path] [port]` launcher
remains a tracked compatibility/debugging tool, but it is not an installation
path.

## Tabs and the ssh kitten

Kitty's cwd-aware actions reconnect over ssh. From a window opened by the ssh
kitten, `new_tab_with_cwd` and `new_window_with_cwd` relaunch the recorded ssh
command on the same host at the same directory, so the canonical kitty config
keeps them off the plain tab chord:

- `⌘T` opens a local tab on the Mac, whichever host the active window is on.
- `⌥⌘T` opens a tab on the active window's host and directory (the reconnect).
- `⌃⇧D` splits keep the active window's host and directory for remote work.
- `⌘W` closes the tab; `confirm_os_window_close -1` asks first while a command
  (ssh counts) is still running, including when the last tab would quit kitty.

With a cwd-inheriting `⌘T`, every new tab lands back in the remote session and
the only route to a local shell is closing the tab that holds the session.

## Troubleshooting policy

On old or headless Linux hosts, Electron may need glibc compatibility, sandbox,
or GPU handling. Diagnose read-only, then implement the solution as a tracked
ShellOS script or patch. Publish it and run the complete reinstall on both
machines. Never keep the commands in private notes, modify the live remote
installation, or skip the local reinstall because a change appears remote-only.

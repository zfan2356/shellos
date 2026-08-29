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
Worktree Review, and installs the tracked remote wrapper. The private alias,
compatibility port, and login shell are written to the remote-only
`~/.config/shellos/remote-tode.env`; this file contains connection identity,
not behavior or patch logic.

Internal scripts such as `deploy-remote-tode.sh`,
`install-worktree-review.sh`, `download-marketplace-vsix.sh`, and
`patch-terminal-browser.sh` deliberately
reject direct invocation.

## Usage

From a connection opened with `kitten ssh`:

```bash
tode <remote-project-path>
```

The remote `tode` wrapper asks the local kitty to launch local tode with its
native `--ssh` transport as an `overlay-main`. Closing the editor reveals the
same remote shell. After the workspace opens, run `View: Show Worktree Review`
from the command palette to enter review mode. The pinned Tode `v0.2.0` SSH
transport does not forward a trailing `--review` argument, so the repository
does not advertise that spelling for remote sessions. Leading flags are
delegated to the pinned remote pixel launcher when appropriate.

The historical `scripts/tode-remote <ssh-host> [remote-path] [port]` launcher
remains a tracked compatibility/debugging tool, but it is not an installation
path.

## Troubleshooting policy

On old or headless Linux hosts, Electron may need glibc compatibility, sandbox,
or GPU handling. Diagnose read-only, then implement the solution as a tracked
ShellOS script or patch. Publish it and run the complete reinstall on both
machines. Never keep the commands in private notes, modify the live remote
installation, or skip the local reinstall because a change appears remote-only.

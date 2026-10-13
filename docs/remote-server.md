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
it recreates the tunnel on the same local port, reapplies that window's proxy,
discards Chromium's stale connections, and reloads every editor tab. Each SSH
window leases its own persistent browser partition so another Tode window cannot
replace its proxy or tear it down when closing. Partitions are isolated by the
exact SSH target and concurrent window slot. Closing a window releases its slot
only after pending proxy work and connection teardown finish; the next window
reuses its disk cache with a new proxy connection. This avoids downloading the
editor assets again for every folder while retaining multi-window isolation.
The first launch for a host or an additional concurrent slot still has a cold
cache. Explicit `--partition` values retain their original behavior.
The launcher reports transport
and editor recovery separately; after `reconnected <host>` the editor should be
usable without reopening Tode.

`Ctrl+Shift+Q` is an unconditional emergency exit for the Tode browser window,
including app mode where ordinary browser shortcuts are disabled. Use it if the
SSH host remains unreachable or recovery cannot reload the editor. A white
editor that keeps logging WebSocket code 1006 without a recovery status means
the reconnect patch is absent or the configured SSH host is still unreachable.

### Startup cache verification

Run `bash tests/patch-terminal-browser-ssh-reconnect.test.sh` for cache-slot
isolation, reuse, failed startup, and close/reconnect races. The optional real
Electron test uses disposable user data and restarts Electron between cold and
warm reads:

```bash
ELECTRON_BIN=/path/to/electron node tests/electron-ssh-cache.test.cjs
```

It also checks an ephemeral-session baseline. By default it serves a local
cacheable fixture; set `SHELLOS_CACHE_TEST_URL` to a cacheable editor asset over
a temporary SSH forward to measure real remote reads without opening a
workspace or modifying the installed browser profile. This measures asset
loading, not end-to-end editor readiness. On October 13, 2026, a 17.8 MB remote
workbench asset took 534 ms cold, 46 ms from the persistent cache after restarting
Electron, and 500 ms in a fresh ephemeral session. First-ever startup, SSH
connection setup, bundle preparation, and extension activation remain separate
costs; changing folders still creates distinct upstream bundles.

### Ready-server launch path

The paired-host wrapper probes `tode --serve --ready-url <folder>`. This checks
the recorded server/injector processes and listeners without importing a
profile, listing extensions, querying terminal colors, or starting services.
When ready, the local overlay launches terminal-browser directly with the
generated Tode preload/main scripts. Missing browser scripts use the Tode
`--ssh <target> --ready-url <url>` path to generate them. A stopped server falls
back to the original bundle/setup path. This fast path relies on the full
ShellOS reinstall to synchronize the two machines' canonical settings and
extensions; it deliberately does not reimport the Mac profile on every folder
open. Normal direct `tode --ssh` launches keep their upstream bundle behavior.

The wrapper passes its installer-verified SSH target as `ssh <target>`, avoiding
terminal-browser's interactive-shell alias lookup (about 0.91 seconds on the
measured Mac). This is not a change to arbitrary user-entered SSH aliases.
Browser-daemon startup runs in parallel with SSH connection establishment, and
socket polling uses 25 ms rather than 200 ms. Electron's default
`window-all-closed` behavior is suppressed so the existing daemon idle timer
actually controls its lifetime. The idle grace period is 15 minutes, retaining
the browser process but not closed editor windows; `tode --shutdown` still stops
it explicitly. SSH tunnels remain isolated and close with their windows.

### Workbench startup measurements

`tests/prepare-tode-startup-benchmark.sh` prepares an isolated remote installation,
copied profile/extensions, and two tiny test folders under `/tmp`. It uses only
the existing code-server binary and does not change the installed profile.
`tests/tode-startup-benchmark.cjs` launches the disposable local installation in
a real kitty window, waits for `code/didStartWorkbench`, then closes only the
test window. Set `KITTY_TEST_SOCKET` to the kitty control socket. Optional
`KITTY_TEST_WINDOW` selects an overlay parent; `SHELLOS_BENCH_DIRECT=1` measures
the ready wrapper's direct-browser path. The JSON report separates time before
navigation from workbench initialization. `SHELLOS_STARTUP_RESOURCES=1` adds
CDP resource timings, and the disposable directory retains the full Tode marks
and child-process trace for diagnosis.

On October 13, 2026, consecutive overlay launches of the ready-server path took
1189, 1154, and 1097 ms from the Mac launch request to the workbench startup mark.
The workbench itself accounted for 733–814 ms. These are not sub-second
end-to-end results: they exclude the remote wrapper probe, use tiny folders,
and do not establish completion of Explorer loading or language-server startup.
The first browser launch and stopped-server fallback are slower. Do not treat
the earlier single-asset cache result as an editor startup SLA. Run
`node tests/tode-startup.test.cjs` for ready/fallback, URL validation, parallel
startup, and daemon lifecycle regression checks.

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

### Homebrew update transport

The complete installer bounds stalled Git HTTP transfers with a 30-second
low-speed timeout. If the configured Tsinghua Homebrew mirror fails, it retries
the update through the official GitHub repository using a process-local Git
URL rewrite. Homebrew filters ordinary `GIT_*` environment variables, so the
tracked `scripts/homebrew-git` shim supplies these options with `git -c` via
`HOMEBREW_GIT_PATH`. It does not change the user's configured mirror or global
Git configuration. Failures on other custom remotes are
not redirected. This preflight completes before any Tode installation is
replaced. Run `bash tests/homebrew-update.test.sh` to verify fallback behavior.

### SSH target resolution

The generated `TODE_REMOTE_SSH_HOST` must be an SSH target that works from the
Mac, not merely a remote hostname or a shell shortcut. The installer writes
its `<ssh-alias>` argument verbatim; the remote wrapper passes it unchanged
to local `tode --ssh`. Tode's terminal-browser opens its tunnel with `ssh`
from the local PATH. It can expand simple shell aliases for `ssh`, but does
not execute shell functions. Kitty's `ssh.conf` controls bootstrap and remote
control; it does not replace OpenSSH's `~/.ssh/config` host mapping.

Before changing anything, inspect the exact target in the remote env file and
compare each spelling on the Mac:

```bash
type -a <ssh-alias>
alias <ssh-alias>
functions <ssh-alias>
command -v ssh
ssh -G <ssh-alias> | grep -E '^(hostname|user|port|identityfile) '
ssh -o BatchMode=yes -o ConnectTimeout=10 <ssh-alias> 'hostname'
```

Do not infer a case mismatch solely from a lowercase name in a DNS error.
Compare `ssh -G` output and real connections: an unmatched spelling may fall
back to DNS, the local username, and port 22 even when another spelling works.
When the saved target is stale, use the verified OpenSSH alias for the complete
published reinstall above. This regenerates `remote-tode.env`; do not hand-edit
the installed wrapper or env file, or blindly lowercase arbitrary SSH targets.
Keep private hostnames, addresses, keys, and mappings outside this repository.

Finally, reconnect in kitty with `kitten ssh <ssh-alias>`, run
`tode <remote-project-path>`, and verify that the remote editor actually loads.
A successful kitty `launch` response only confirms creation of an overlay, not
SSH or editor readiness. The wrapper keeps failed local launches visible with
their exit status until Enter is pressed. Complete reinstalls back up the
wrapper itself as well as its launcher symlink so existing changes survive.

### Remote runtime compatibility

On old or headless Linux hosts, Electron may need glibc compatibility, sandbox,
or GPU handling. Diagnose read-only, then implement the solution as a tracked
ShellOS script or patch. Publish it and run the complete reinstall on both
machines. Never keep the commands in private notes, modify the live remote
installation, or skip the local reinstall because a change appears remote-only.

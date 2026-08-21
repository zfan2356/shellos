# Pairing with a remote dev server

The local machine keeps a tight link with a remote development server: heavy
work (training, builds, GPU jobs) runs remotely, while kitty + tode provide
the same editing experience on both sides. This doc covers the generic
configuration of that link. Host names, addresses, and machine-specific
patches are intentionally kept out of this public repo.

## SSH link (kitty side)

Use `kitten ssh <host>` instead of plain ssh — it installs kitty's shell
integration on the remote and keeps terminfo working. Per-host settings go in
`~/.config/kitty/ssh.conf` (local-only, untracked):

```
# ~/.config/kitty/ssh.conf — template
hostname <your-remote-host-patterns>
login_shell zsh
forward_remote_control yes
```

`forward_remote_control` lets remote processes talk to the local kitty via
the forwarded socket (the local kitty.conf already sets
`allow_remote_control socket-only` + `listen_on unix:/tmp/kitty-{kitty_pid}`),
which is what makes remote-side tooling able to open local panes/tabs.

## tode on the remote

- Install from GitHub releases (same as local; the official CDN may be
  unreachable from either side).
- **Cap the frame stream.** tode renders the editor to pixels on whichever
  machine runs it and streams frames to the local kitty — over SSH that is
  the whole bottleneck (VS Code Remote feels faster because it ships RPC,
  not pixels; a headless remote also renders on CPU). Export in the remote
  tode launcher:
  ```bash
  export TERMINAL_BROWSER_MAX_PIXELS=2100000   # ~1x scale, not retina 2x → ~4x less data
  export TERMINAL_BROWSER_FPS=20
  ```
- Restore the same `tode/` config from this repo into the remote's
  `~/.local/share/tode/` — settings and shortcuts are shared; the kitty
  keybinding side stays local-only (interception happens where kitty runs).
  Do NOT install kitty on the remote: tode would scan a remote kitty config
  and generate a useless override.
- Python navigation: same rule as local — basedpyright from Open VSX,
  never Pylance (code-server).

## Things to check on an unfamiliar remote

Electron-based tools (tode's browser component) are picky about old server
distros. Symptoms and directions, generically:

- **Old glibc** (< 2.34): Electron won't start. Fixable by unpacking a newer
  distro's glibc somewhere persistent and repointing the binary with
  patchelf (interpreter + `--force-rpath` rpath including `$ORIGIN`).
- **Running as root**: the Chromium sandbox refuses; needs the sandbox
  disabled via environment.
- **No GPU stack** (headless/container): disable GPU acceleration or the GPU
  process crash-loops and everything stutters.
- **Upgrades revert patches**: anything patched inside the install dir is
  wiped by an upgrade; config in the data dir survives. Keep patch notes
  (and backups like `electron.orig`) outside the install dir.

The concrete patch commands for my remote live in local notes, not here.

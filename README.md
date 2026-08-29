# shellos

Personal terminal workspace for kitty + terminal-code (tode), including the
configuration, pinned upstream versions, tracked patches, extensions, and the
local/remote installation workflow.

This repository is the only source of truth. Installed machines are outputs,
never editable sources.

## Repository-first rule

Every change to a ShellOS-managed machine must follow the same sequence:

1. Make the change in an independent checkout, not in installed files and not
   in the formal checkout used for deployment.
2. Put every patch, script, configuration change, and behavioral workaround in
   this repository. Untracked machine-specific binary patches are not allowed.
3. Validate, run `./scripts/redline.sh`, commit, and push `main`.
4. In the formal checkout, pull the committed state with
   `git pull --ff-only origin main`.
5. Reinstall all ShellOS-managed components on both machines with:

   ```bash
   ./scripts/reinstall-shellos.sh <ssh-alias> [port]
   ```

The reinstall script also performs the fast-forward pull, verifies that the
checkout exactly matches `origin/main`, restores the pinned submodules, and
then reinstalls the complete local and remote environments. Its internal
helpers reject direct invocation; selective deployment and direct edits under
`~/.local`, `~/.config`, or an application bundle are unsupported.

Only secrets and connection identity may remain outside the repository, such
as SSH keys, private host aliases in `~/.config/kitty/ssh.conf`, the generated
remote alias file, and the private `.redline-local` pattern list. They must not
contain implementation patches or configuration variants.

## Layout

| Path | Purpose |
|---|---|
| `kitty/` | Canonical kitty configuration and theme |
| `editor/` | Canonical editor settings, keybindings, extension inventory, and Worktree Review source |
| `tode/` | Canonical tode shortcuts and theme |
| `scripts/reinstall-shellos.sh` | The only supported machine deployment entrypoint |
| `scripts/install-tode-release.sh` | Internal pinned-release installer |
| `scripts/link.sh` | Internal config-copy helper; despite its historical name, it creates no live config links |
| `scripts/apply-tode-patches.sh` | Internal dispatcher for all tracked Tode patches |
| `scripts/assert-repo-first.sh` | Internal published-checkout assertion |
| `scripts/patch-terminal-browser.sh` | Tracked renderer patch, applied only during full reinstall |
| `scripts/patch-tode-cmd-right-click.sh` | Tracked navigation patch, applied only during full reinstall |
| `scripts/install-worktree-review.sh` | Internal extension build/install helper |
| `scripts/download-marketplace-vsix.sh` | Internal official Marketplace VSIX downloader |
| `scripts/deploy-remote-tode.sh` | Internal complete remote reinstall helper |
| `scripts/sync.sh` | Disabled compatibility stop; machine-to-repo sync is forbidden |
| `skills/` | Agent procedures enforcing this policy |
| `docs/remote-server.md` | Generic local/remote usage and private connection inputs |
| `third-party/kitty` | Pinned kitty upstream source |
| `third-party/terminal-code` | Pinned tode upstream source |

Canonical editor files are copied from the pulled repository during reinstall,
not symlinked. The two installed skill directories are copies as well. Editing
settings or an installed skill therefore cannot mutate the repository or
become an unreviewed deployment.

## Fresh install or update

Clone the repository at its stable formal path, initialize submodules, and run
the complete installer:

```bash
git clone --recurse-submodules https://github.com/zfan2356/shellos.git ~/wxg/shellos
cd ~/wxg/shellos
./scripts/reinstall-shellos.sh <ssh-alias> [port]
```

The installer reinstalls pinned kitty, the configured font, pinned tode, all
tracked configuration and Tode patches, the extension inventory, Worktree
Review, the ShellOS skills, and the paired remote setup.
See `docs/remote-server.md` for the required `kitten ssh` connection setup.

## Development workflow

Use a separate clone or worktree for changes. Update source files and version
pins there, including any fix previously considered a one-off patch. Before
publishing, run:

```bash
./scripts/redline.sh
npm --prefix editor/extensions/worktree-review test
```

After commit and push, return to the formal checkout and run the complete
reinstaller. Never validate a proposed fix by changing an installed artifact;
validate repository code and then validate the full reinstall result.

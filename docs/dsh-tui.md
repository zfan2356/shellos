# dsh-TUI on ShellOS-managed machines

`dsh` is the DeepSeek Harness CLI; `dsh-tui` is the terminal front door that
ShellOS installs on the paired Linux host. Upstream is external to this
repository, so `dsh/` holds only the pins and the configuration ShellOS owns.

## Pinned upstream

| Pin | Value file | Meaning |
|---|---|---|
| `DSH_CLI_VERSION` | `dsh/versions.env` | `@deepseek-ai/dsh` global CLI |
| `DSH_TUI_VERSION` | `dsh/versions.env` | `@deepseek-harness-tui/dsh-tui` plugin and profile bundle |

Both are installed globally with npm into the node root that provides
`node` + `npm` + `pnpm` (the launcher needs node >= 22, which is often not the
account default). `dsh plugin --profile dsh-tui add` then scaffolds
`$DSH_HOME/profiles/dsh-tui` with `@deepseek-ai/dsh-base` as the first bundle
layer, and `~/.local/bin/{dsh-tui,dst}` are linked to the global launcher. The
launcher delegates to the profile copy, so the pinned plugin version is what
actually runs and no profile rebuild is needed to follow an upgrade.

Bump a pin in `dsh/versions.env`, commit, and run the complete reinstall; the
installer only shells out to npm when the installed version differs.

## Repository-owned configuration

| Repository file | Installed as | Mode |
|---|---|---|
| `dsh/settings.yaml` | `$DSH_HOME/settings.yaml` | 600 |
| `dsh/cordis.patch.yml` | `$DSH_HOME/profiles/dsh-tui/cordis.patch.yml` | 644 |

The installer treats repository state as decisive: it replaces both files on
every reinstall and keeps the previous copy as `<file>.bak-<timestamp>`. Edit
them here, never on a machine. `settings.yaml` carries the model catalog, the
default agent model, and UI preferences such as `dsh-tui.diffLayout: unified`
(single-column diffs instead of the width-dependent split view). The profile
patch layer is the ShellOS-owned place for id-targeted bundle overrides, for
example:

```yaml
- id: working-activity
  config:
    publishIntervalMs: 500
```

`$DSH_HOME/cordis.yml`, `pnpm-lock.yaml`, and the generated launcher state are
scaffolding the profile owns; they are intentionally not tracked.

## Secrets stay outside the repository

`DEEPSEEK_API_KEY` lives in `$DSH_HOME/.env` and
`$DSH_HOME/.credentials.yaml` on each machine. The installer never writes,
copies, or reads the value; when it finds no key it prints the path that needs
one and continues. Provision it per machine, for example:

```bash
umask 077 && printf 'DEEPSEEK_API_KEY=%s\n' '<key>' > "${DSH_HOME:-$HOME/.dsh}/.env"
```

Without it `dsh-tui doctor` reports the missing key and the TUI cannot reach a
model, so a fresh machine is installed but not usable until the key is added.

## Verification

The remote deployment ends with `dsh-tui doctor` and fails unless it reports
the pinned profile, plus byte-identical tracked configuration, mode 600 on
`settings.yaml`, and a real `~/.local/bin/dsh-tui` symlink. The non-interactive
SSH verifier resolves the Node runtime beside that symlink's target because an
NVM installation is not necessarily present on its initial `PATH`. Run the
checks by hand from a login shell with:

```bash
export PATH="$HOME/.local/bin:$PATH"
dsh-tui doctor
cmp dsh/settings.yaml "${DSH_HOME:-$HOME/.dsh}/settings.yaml"
```

## Wrapper commands

The helper is invoked by `deploy-remote-tode.sh`; it refuses nothing on its own
but is not a deployment path. For a controlled preview or an isolated test it
accepts `--dry-run`, `--dsh-home <path>`, and `--skip-global-install`:

```bash
DSH_HOME=/tmp/dsh-check HOME=/tmp/dsh-check ./dsh/install-dsh-tui.sh --dry-run
```

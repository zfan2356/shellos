---
name: shellos
description: Maintain github.com/zfan2356/shellos with a strict repository-first, commit-push-pull, full-reinstall workflow for kitty, tode, tracked patches, extensions, skills, and a paired remote host. Use after any ShellOS change, patch, configuration edit, version bump, or request to sync, update, repair, or reinstall ShellOS.
---

# ShellOS maintenance

The formal checkout is `~/wxg/shellos`, branch `main`. It is the sole source of
truth for everything ShellOS manages. A local or remote installation is only a
generated deployment of a committed repository revision.

## Non-negotiable policy

- Never edit an installed file, application bundle, `~/.config` output,
  `~/.local` output, or remote artifact to implement or test a fix.
- Never keep a patch, command sequence, workaround, configuration variant, or
  behavior change in local notes or on one machine. Add it to this repository.
- Never deploy from an uncommitted checkout and never selectively run an
  internal installer or patch script.
- Every repository change, including documentation and skill changes, is
  followed by a complete reinstall of the local machine and paired remote.
- The only files outside the repository are secrets and connection identity:
  SSH keys, private aliases in `~/.config/kitty/ssh.conf`, the generated
  `~/.config/shellos/remote-tode.env`, and `.redline-local` secret patterns.
  They may not contain patches or alternate behavior.

## Required workflow

1. Inspect the formal checkout, but create an independent clone or worktree for
   all modifications. Do not modify `~/wxg/shellos` before publication.
2. Make every required source, patch, config, documentation, submodule-pin, and
   test change in that independent checkout.
3. Validate there. At minimum run relevant tests, shell syntax checks, and:

   ```bash
   ./scripts/redline.sh
   ```

   It must report `redline: clean`. `.redline-local` is private because its
   patterns may reveal secrets; provide it securely when available.
4. Commit on `main` with an English conventional commit message and push
   `origin main`. Do not create a pull request unless the user asks.
5. In the formal checkout, accept the published state only through:

   ```bash
   git pull --ff-only origin main
   ```

6. From that clean, pulled checkout run the only supported deployment command:

   ```bash
   ./scripts/reinstall-shellos.sh <ssh-alias> [port]
   ```

   When a paired remote exists, omitting it is not a complete deployment.
   A newly pulled submodule pin may temporarily appear modified because its
   checkout still points at the previous commit. Do not repair it manually;
   the complete installer updates every submodule to the committed pin while
   still rejecting real uncommitted changes inside submodules.
7. Verify that formal `HEAD` equals `origin/main`, the worktree is clean, local
   and remote versions match the committed submodule pins, every tracked patch
   is present, and the expected extension/skill inventory is installed.

If any step fails, fix the repository in the independent checkout and repeat
the entire commit → push → pull → full-reinstall sequence. Do not repair the
installed result in place.

## Configuration and version rules

- `editor/settings.json` and both keybinding files are canonical copies. The
  full installer copies them into tode and Cursor; there are no live links.
- The full installer also copies both ShellOS skills into Codex and Claude;
  installed skill directories are not live links to a development checkout.
- `kitty/`, `tode/`, wrapper scripts, extension lists, Worktree Review source,
  and binary patch logic are all repository-authoritative.
- `scripts/sync.sh` is intentionally disabled. Never copy machine state back
  wholesale. Reproduce the intended change explicitly in an independent
  checkout so it can be reviewed.
- Pin installed kitty and tode versions with `third-party/kitty` and
  `third-party/terminal-code`. A version upgrade is incomplete until the pin,
  scripts/docs if needed, commit, push, pull, and full reinstall all succeed.
- Internal helpers (`link.sh`, `install-tode-release.sh`,
  `apply-tode-patches.sh`, both `patch-*.sh` scripts,
  `install-worktree-review.sh`, `assert-repo-first.sh`, and
  `deploy-remote-tode.sh`) are implementation details of
  `reinstall-shellos.sh`; do not invoke them directly or bypass their guard.

## Knowledge changes

Record every newly discovered installation requirement, remote compatibility
fix, and recovery procedure in this repository in the same commit as its
implementation. `skills/shellos-bootstrap/SKILL.md` and `docs/` must never
refer to an untracked patch or private operational note.

#!/usr/bin/env bash
# The only supported repo-to-machine deployment entrypoint. It reinstalls all
# ShellOS-managed local components and the paired remote host.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
FORMAL_REPO="$HOME/wxg/shellos"
SSH_HOST="${1:-}"
PORT="${2:-8791}"

if [[ $# -lt 1 || $# -gt 2 || ! "$SSH_HOST" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "usage: $0 <ssh-alias> [port]" >&2
  exit 2
fi
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "invalid port: $PORT" >&2
  exit 2
fi
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo "the local ShellOS reinstall currently requires macOS arm64" >&2
  exit 1
fi
if [[ "$REPO" != "$FORMAL_REPO" ]]; then
  echo "refusing to deploy from a development checkout: $REPO" >&2
  echo "run the published installer from $FORMAL_REPO" >&2
  exit 1
fi

for command in brew curl diff git node npx python3 scp ssh; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "required command not found: $command" >&2
    exit 1
  }
done

[[ "$(git -C "$REPO" branch --show-current)" == main ]] || {
  echo "refusing to deploy: ShellOS checkout is not on main" >&2
  exit 1
}
[[ -z "$(git -C "$REPO" status --porcelain=v1 --ignore-submodules=all)" ]] || {
  echo "refusing to deploy: ShellOS checkout has uncommitted files" >&2
  exit 1
}
git -C "$REPO" submodule foreach --quiet --recursive '
  if test -n "$(git status --porcelain=v1 --untracked-files=all)"; then
    echo "refusing to deploy: submodule $name has uncommitted files" >&2
    exit 1
  fi
'
git -C "$REPO" pull --ff-only origin main
[[ "$(git -C "$REPO" rev-parse HEAD)" == "$(git -C "$REPO" rev-parse origin/main)" ]] || {
  echo "refusing to deploy: HEAD does not exactly match origin/main" >&2
  exit 1
}
git -C "$REPO" submodule update --init --recursive
if git -C "$REPO" submodule status --recursive | grep -Eq '^[-+U]'; then
  echo "refusing to deploy: submodules do not match the committed pins" >&2
  exit 1
fi
SHELLOS_FULL_REINSTALL=1 "$REPO/scripts/assert-repo-first.sh"

KITTY_PIN=$(git -C "$REPO/third-party/kitty" describe --tags --exact-match)
TODE_PIN=$(git -C "$REPO/third-party/terminal-code" describe --tags --exact-match)
BREW_KITTY=$(brew info --cask --json=v2 kitty |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["casks"][0]["version"])')
if [[ "v$BREW_KITTY" != "$KITTY_PIN" ]]; then
  echo "refusing to deploy: Homebrew kitty is v$BREW_KITTY but ShellOS pins $KITTY_PIN" >&2
  echo "update and push the kitty submodule pin first" >&2
  exit 1
fi

# Confirm that the paired host is reachable and can run the tracked installer
# before changing the local installation. A failed preflight leaves both
# machines on their previous published revision.
ssh "$SSH_HOST" bash -s <<'REMOTE_PREFLIGHT'
set -euo pipefail
[[ "$(uname -s)" == Linux ]] || {
  echo "paired ShellOS host must run Linux" >&2
  exit 1
}
case "$(uname -m)" in
  x86_64|amd64|aarch64|arm64) ;;
  *) echo "unsupported paired-host architecture: $(uname -m)" >&2; exit 1 ;;
esac
for command in awk curl find grep install sed sort tar; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "required paired-host command not found: $command" >&2
    exit 1
  }
done
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || {
  echo "paired ShellOS host needs sha256sum or shasum" >&2
  exit 1
}
REMOTE_PREFLIGHT

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$HOME/.local/share/shellos-backups/$STAMP"
mkdir -p "$BACKUP"
for source in \
  "$HOME/.config/kitty/kitty.conf" \
  "$HOME/.config/kitty/current-theme.conf" \
  "$HOME/.config/kitty/macos-launch-services-cmdline" \
  "$HOME/.config/kitty/tode/keybinds.kitty.conf" \
  "$HOME/.local/share/tode/shortcuts.json" \
  "$HOME/.local/share/tode/theme"; do
  [[ -e "$source" || -L "$source" ]] || continue
  cp -pR "$source" "$BACKUP/"
done
echo "local backup: $BACKUP"

if brew list --cask kitty >/dev/null 2>&1; then
  brew reinstall --cask kitty
else
  brew install --cask kitty
fi
if brew list --cask font-maple-mono-nf-cn >/dev/null 2>&1; then
  brew reinstall --cask font-maple-mono-nf-cn
else
  brew install --cask font-maple-mono-nf-cn
fi

mkdir -p "$HOME/.config/kitty/tode" "$HOME/.local/share/tode/theme" "$HOME/.local/bin"
install -m 644 "$REPO/kitty/kitty.conf" "$HOME/.config/kitty/kitty.conf"
install -m 644 "$REPO/kitty/current-theme.conf" "$HOME/.config/kitty/current-theme.conf"
install -m 644 "$REPO/kitty/macos-launch-services-cmdline" \
  "$HOME/.config/kitty/macos-launch-services-cmdline"
install -m 644 "$REPO/kitty/tode/keybinds.kitty.conf" \
  "$HOME/.config/kitty/tode/keybinds.kitty.conf"

tode --shutdown >/dev/null 2>&1 || true
SHELLOS_FULL_REINSTALL=1 \
  XDG_BIN_HOME="$HOME/.local/bin" \
  XDG_STATE_HOME="$HOME/.local/state" \
  "$REPO/scripts/install-tode-release.sh" "$TODE_PIN"
tode --serve --prepare
SHELLOS_FULL_REINSTALL=1 "$REPO/scripts/link.sh"
install -m 644 "$REPO/tode/shortcuts.json" "$HOME/.local/share/tode/shortcuts.json"
install -m 644 "$REPO/tode/theme/palette.json" "$HOME/.local/share/tode/theme/palette.json"
install -m 644 "$REPO/tode/theme/live-theme.json" "$HOME/.local/share/tode/theme/live-theme.json"
install -m 644 "$REPO/tode/theme/inject.css" "$HOME/.local/share/tode/theme/inject.css"
ln -sfn "$REPO/scripts/tode-remote" "$HOME/.local/bin/tode-remote"

for skill_name in shellos shellos-bootstrap; do
  for skill_root in "$HOME/.codex/skills" "$HOME/.claude/skills"; do
    mkdir -p "$skill_root"
    target="$skill_root/$skill_name"
    if [[ -L "$target" ]]; then
      rm -f "$target"
    elif [[ -e "$target" ]]; then
      mv "$target" "$target.bak-$STAMP"
    fi
    cp -R "$REPO/skills/$skill_name" "$target"
  done
done

SHELLOS_FULL_REINSTALL=1 "$REPO/scripts/apply-tode-patches.sh"

# The tracked inventory is exact. Remove every user extension, preserving only
# tode's two release-managed integrations, then reinstall the complete tracked
# inventory so this is a full restore rather than a partial sync.
CURRENT_EXTENSIONS=$(tode --list-extensions | tr '[:upper:]' '[:lower:]')
while IFS= read -r extension; do
  [[ -n "$extension" ]] || continue
  case "$extension" in
    tode.tode-bridge|tode.tode-theme) continue ;;
  esac
  # Removing one extension can also remove a dependency that still appears in
  # the initial snapshot. Continue through that expected "not installed"
  # result; the exact-inventory verification below still rejects leftovers.
  tode --uninstall-extension "$extension" || true
done <<< "$CURRENT_EXTENSIONS"
export EXTENSIONS_GALLERY='{"serviceUrl":"https://marketplace.visualstudio.com/_apis/public/gallery","itemUrl":"https://marketplace.visualstudio.com/items","cacheUrl":"https://vscode.blob.core.windows.net/gallery/index","controlUrl":""}'
while IFS= read -r extension; do
  [[ -n "$extension" && "$extension" != zfan2356.worktree-review ]] || continue
  tode --install-extension "$extension"
done < "$REPO/editor/extensions.tode.txt"
SHELLOS_FULL_REINSTALL=1 "$REPO/scripts/install-worktree-review.sh"

CURRENT_EXTENSIONS=$(tode --list-extensions | tr '[:upper:]' '[:lower:]')
while IFS= read -r extension; do
  [[ -n "$extension" ]] || continue
  printf '%s\n' "$CURRENT_EXTENSIONS" | grep -Fqx "$extension" || {
    echo "local extension verification failed: $extension" >&2
    exit 1
  }
done < "$REPO/editor/extensions.tode.txt"
if printf '%s\n' "$CURRENT_EXTENSIONS" | grep -Fqx ms-python.vscode-pylance; then
  echo "local extension verification failed: Pylance must not be installed" >&2
  exit 1
fi
while IFS= read -r extension; do
  [[ -n "$extension" ]] || continue
  case "$extension" in
    tode.tode-bridge|tode.tode-theme) continue ;;
  esac
  grep -Fqx "$extension" "$REPO/editor/extensions.tode.txt" || {
    echo "local extension verification failed: unmanaged extension $extension" >&2
    exit 1
  }
done <<< "$CURRENT_EXTENSIONS"

[[ "$(tode --version)" == "$TODE_PIN" ]] || {
  echo "local tode verification failed" >&2
  exit 1
}
[[ "v$(kitty --version | awk '{print $2}')" == "$KITTY_PIN" ]] || {
  echo "local kitty verification failed" >&2
  exit 1
}
grep -Fq 'shellos: unfocused-throttle v2' \
  "$HOME/.local/lib/tode/vendor/terminal-browser/browser/dist/main.js"
grep -Fq 'shellos: cmd-right-click navigateBack v2' \
  "$HOME/.local/lib/tode/dist/browser/preload.js"
grep -Fq 'shellos: cmd-right-click navigateBack v2' \
  "$HOME/.local/lib/tode/dist/browser/mainscript.js"
[[ "$(defaults read dev.zenbu.terminal-browser NSAppSleepDisabled)" == 1 ]]
for skill_name in shellos shellos-bootstrap; do
  for skill_root in "$HOME/.codex/skills" "$HOME/.claude/skills"; do
    diff -qr "$REPO/skills/$skill_name" "$skill_root/$skill_name" >/dev/null || {
      echo "local skill verification failed: $skill_root/$skill_name" >&2
      exit 1
    }
  done
done
pkill -USR1 -x kitty >/dev/null 2>&1 || true

SHELLOS_FULL_REINSTALL=1 "$REPO/scripts/deploy-remote-tode.sh" "$SSH_HOST" "$PORT"

echo "ShellOS full reinstall complete at $(git -C "$REPO" rev-parse --short HEAD)"

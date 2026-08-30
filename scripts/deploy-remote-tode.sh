#!/usr/bin/env bash
# Internal full-reinstall helper: reinstall remote tode, every tracked patch,
# the wrapper, editor configuration, and extension inventory.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SSH_HOST="${1:-}"
PORT="${2:-8791}"

if [[ "${SHELLOS_FULL_REINSTALL:-}" != 1 ]]; then
  echo "do not deploy selectively; run $REPO/scripts/reinstall-shellos.sh <ssh-alias>" >&2
  exit 1
fi

if [[ -z "$SSH_HOST" || ! "$SSH_HOST" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "usage: $0 <ssh-alias> [port]" >&2
  exit 2
fi
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "invalid port: $PORT" >&2
  exit 2
fi

for command in ssh scp python3; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "required command not found: $command" >&2
    exit 1
  }
done

work=$(mktemp -d /tmp/shellos-remote-tode.XXXXXX)
remote_work=""
cleanup() {
  case "$work" in /tmp/shellos-remote-tode.*) rm -rf -- "$work" ;; esac
  case "$remote_work" in
    /tmp/shellos-remote-tode.*) ssh "$SSH_HOST" "rm -rf -- '$remote_work'" >/dev/null 2>&1 || true ;;
  esac
}
trap cleanup EXIT

remote_shell=$(ssh "$SSH_HOST" '
  command -v zsh 2>/dev/null \
    || { command -v getent >/dev/null 2>&1 && getent passwd "$(id -u)" | cut -d: -f7; } \
    || printf "%s\n" /bin/sh
')
remote_codex=$(ssh "$SSH_HOST" '
  command -v codex 2>/dev/null \
    || { [ -x /opt/conda/bin/codex ] && printf "%s\n" /opt/conda/bin/codex; } \
    || true
')
profile_name=$(basename "$remote_shell")

python3 - "$REPO/editor/settings.json" "$work/settings.json" \
  "$profile_name" "$remote_shell" "$remote_codex" <<'PY'
import json
import sys

source, output, profile, shell, codex = sys.argv[1:]
with open(source, encoding="utf-8") as stream:
    settings = json.load(stream)

settings["terminal.integrated.defaultProfile.linux"] = profile
settings["terminal.integrated.profiles.linux"] = {profile: {"path": shell}}
if codex:
    settings["chatgpt.cliExecutable"] = codex
else:
    settings.pop("chatgpt.cliExecutable", None)

with open(output, "w", encoding="utf-8") as stream:
    json.dump(settings, stream, indent=2, ensure_ascii=False)
    stream.write("\n")
PY

cp "$REPO/editor/keybindings.tode.json" "$work/keybindings.json"
cp "$REPO/editor/extensions.tode.txt" "$work/extensions.tode.txt"
cp "$REPO/scripts/tode-remote-wrapper" "$work/tode-remote-wrapper"
cp "$REPO/scripts/install-tode-release.sh" "$work/install-tode-release.sh"
cp "$REPO/scripts/apply-tode-patches.sh" "$work/apply-tode-patches.sh"
cp "$REPO/scripts/patch-terminal-browser.sh" "$work/patch-terminal-browser.sh"
cp "$REPO/scripts/patch-tode-cmd-right-click.sh" "$work/patch-tode-cmd-right-click.sh"
cp "$REPO/scripts/patch-tode-worktree-review-click.sh" \
  "$work/patch-tode-worktree-review-click.sh"
printf "TODE_REMOTE_SSH_HOST='%s'\nTODE_REMOTE_PORT='%s'\nTODE_REMOTE_SHELL='%s'\n" \
  "$SSH_HOST" "$PORT" "$remote_shell" > "$work/remote-tode.env"

TODE_PIN=$(git -C "$REPO/third-party/terminal-code" describe --tags --exact-match)

remote_work=$(ssh "$SSH_HOST" 'mktemp -d /tmp/shellos-remote-tode.XXXXXX')
scp -q "$work/settings.json" "$work/keybindings.json" "$work/extensions.tode.txt" \
  "$work/tode-remote-wrapper" "$work/install-tode-release.sh" \
  "$work/apply-tode-patches.sh" "$work/patch-terminal-browser.sh" \
  "$work/patch-tode-cmd-right-click.sh" \
  "$work/patch-tode-worktree-review-click.sh" "$work/remote-tode.env" \
  "$SSH_HOST:$remote_work/"

ssh "$SSH_HOST" bash -s -- "$remote_work" "$PORT" "$TODE_PIN" <<'REMOTE'
set -euo pipefail
staging=$1
port=$2
tode_pin=$3
stamp=$(date +%Y%m%d-%H%M%S)
backup="$HOME/.local/share/tode-backups/$stamp"
bin_dir="$HOME/.local/bin"
share_dir="$HOME/.local/share/shellos"
user_dir="$HOME/.local/share/tode/vscode/user-data/User"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/shellos"

mkdir -p "$backup" "$bin_dir" "$share_dir" "$user_dir" "$config_dir"
for file in "$bin_dir/tode" "$user_dir/settings.json" "$user_dir/keybindings.json" \
  "$config_dir/remote-tode.env"; do
  [ ! -e "$file" ] && [ ! -L "$file" ] && continue
  cp -a "$file" "$backup/$(basename "$file")"
done

chmod +x "$staging/install-tode-release.sh" "$staging/apply-tode-patches.sh" \
  "$staging/patch-terminal-browser.sh" "$staging/patch-tode-cmd-right-click.sh" \
  "$staging/patch-tode-worktree-review-click.sh"
if [[ -x "$bin_dir/tode" ]]; then
  "$bin_dir/tode" --shutdown >/dev/null 2>&1 || true
fi
SHELLOS_FULL_REINSTALL=1 \
  XDG_BIN_HOME="$HOME/.local/bin" \
  XDG_STATE_HOME="$HOME/.local/state" \
  "$staging/install-tode-release.sh" "$tode_pin"
"$bin_dir/tode" --serve --prepare
SHELLOS_FULL_REINSTALL=1 "$staging/apply-tode-patches.sh"

rm -f "$bin_dir/tode-pixel"
mv "$bin_dir/tode" "$bin_dir/tode-pixel"

install -m 755 "$staging/tode-remote-wrapper" "$share_dir/tode-remote-wrapper"
install -m 644 "$staging/settings.json" "$user_dir/settings.json"
install -m 644 "$staging/keybindings.json" "$user_dir/keybindings.json"
install -m 600 "$staging/remote-tode.env" "$config_dir/remote-tode.env"
ln -sfn "$share_dir/tode-remote-wrapper" "$bin_dir/tode"

tmux kill-session -t "code-server-$port" 2>/dev/null || true
echo "remote backup: $backup"
echo "remote wrapper: $bin_dir/tode -> $share_dir/tode-remote-wrapper"
REMOTE

SHELLOS_FULL_REINSTALL=1 "$REPO/scripts/install-worktree-review.sh" "$SSH_HOST"

ssh "$SSH_HOST" bash -s -- "$remote_work/extensions.tode.txt" "$TODE_PIN" <<'REMOTE_VERIFY'
set -euo pipefail
inventory=$1
tode_pin=$2
code_server=$(find "$HOME/.local/share/tode/code-server" -type f \
  -path '*/bin/code-server' -perm -111 2>/dev/null | sort -V | tail -n 1)
[[ -n "$code_server" ]] || { echo "remote code-server not found" >&2; exit 1; }
current=$(
  "$code_server" \
    --extensions-dir "$HOME/.local/share/tode/vscode/extensions" \
    --user-data-dir "$HOME/.local/share/tode/vscode/user-data" \
    --list-extensions | tr '[:upper:]' '[:lower:]'
)
export EXTENSIONS_GALLERY='{"serviceUrl":"https://marketplace.visualstudio.com/_apis/public/gallery","itemUrl":"https://marketplace.visualstudio.com/items","cacheUrl":"https://vscode.blob.core.windows.net/gallery/index","controlUrl":""}'
while IFS= read -r extension; do
  [[ -n "$extension" ]] || continue
  case "$extension" in
    tode.tode-bridge|tode.tode-theme|zfan2356.worktree-review) continue ;;
  esac
  # Removing one extension can also remove a dependency that still appears in
  # the initial snapshot. Final exact-inventory verification catches any real
  # uninstall failure that leaves an unmanaged extension behind.
  "$code_server" \
    --extensions-dir "$HOME/.local/share/tode/vscode/extensions" \
    --user-data-dir "$HOME/.local/share/tode/vscode/user-data" \
    --uninstall-extension "$extension" || true
done <<< "$current"
while IFS= read -r extension; do
  [[ -n "$extension" ]] || continue
  [[ "$extension" == zfan2356.worktree-review ]] && continue
  "$code_server" \
    --extensions-dir "$HOME/.local/share/tode/vscode/extensions" \
    --user-data-dir "$HOME/.local/share/tode/vscode/user-data" \
    --install-extension "$extension" --force
done < "$inventory"
current=$(
  "$code_server" \
    --extensions-dir "$HOME/.local/share/tode/vscode/extensions" \
    --user-data-dir "$HOME/.local/share/tode/vscode/user-data" \
    --list-extensions | tr '[:upper:]' '[:lower:]'
)
# Extension packs may add recommendations outside the tracked exact inventory.
while IFS= read -r extension; do
  [[ -n "$extension" ]] || continue
  case "$extension" in
    tode.tode-bridge|tode.tode-theme) continue ;;
  esac
  if ! grep -Fqx "$extension" "$inventory"; then
    "$code_server" \
      --extensions-dir "$HOME/.local/share/tode/vscode/extensions" \
      --user-data-dir "$HOME/.local/share/tode/vscode/user-data" \
      --uninstall-extension "$extension" || true
  fi
done <<< "$current"
current=$(
  "$code_server" \
    --extensions-dir "$HOME/.local/share/tode/vscode/extensions" \
    --user-data-dir "$HOME/.local/share/tode/vscode/user-data" \
    --list-extensions | tr '[:upper:]' '[:lower:]'
)
while IFS= read -r extension; do
  [[ -n "$extension" ]] || continue
  printf '%s\n' "$current" | grep -Fqx "$extension" || {
    echo "remote extension verification failed: $extension" >&2
    exit 1
  }
done < "$inventory"
while IFS= read -r extension; do
  [[ -n "$extension" ]] || continue
  case "$extension" in
    tode.tode-bridge|tode.tode-theme) continue ;;
  esac
  grep -Fqx "$extension" "$inventory" || {
    echo "remote extension verification failed: unmanaged extension $extension" >&2
    exit 1
  }
done <<< "$current"
[[ "$("$HOME/.local/bin/tode-pixel" --version)" == "$tode_pin" ]]
grep -Fq "\"version\": \"$tode_pin\"" "$HOME/.local/state/tode/install.json"
grep -Fq 'shellos: unfocused-throttle v2' \
  "$HOME/.local/lib/tode/vendor/terminal-browser/browser/dist/main.js"
grep -Fq 'shellos: cmd-right-click navigateBack v2' \
  "$HOME/.local/lib/tode/dist/browser/preload.js"
grep -Fq 'shellos: cmd-right-click navigateBack v2' \
  "$HOME/.local/lib/tode/dist/browser/mainscript.js"
workbench_bundle=$(find "$HOME/.local/share/tode/code-server" -type f \
  -path '*/lib/vscode/out/vs/workbench/workbench.web.main.internal.js' \
  2>/dev/null | sort -V | tail -n 1)
[[ -n "$workbench_bundle" ]]
grep -Fq 'shellos: worktree-review Explorer pre-open v1' "$workbench_bundle"
REMOTE_VERIFY
echo "deployed remote tode via $SSH_HOST"
echo "remote shell: $remote_shell"
echo "remote port: $PORT"

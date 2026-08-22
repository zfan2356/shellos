#!/usr/bin/env bash
# Deploy the remote-style tode wrapper plus a Linux rendering of the canonical
# editor configuration. The SSH argument must also be a valid alias on the Mac.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SSH_HOST="${1:-}"
PORT="${2:-8791}"

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
cp "$REPO/scripts/tode-remote-wrapper" "$work/tode-remote-wrapper"
printf "TODE_REMOTE_SSH_HOST='%s'\nTODE_REMOTE_PORT='%s'\nTODE_REMOTE_SHELL='%s'\n" \
  "$SSH_HOST" "$PORT" "$remote_shell" > "$work/remote-tode.env"

remote_work=$(ssh "$SSH_HOST" 'mktemp -d /tmp/shellos-remote-tode.XXXXXX')
scp -q "$work/settings.json" "$work/keybindings.json" \
  "$work/tode-remote-wrapper" "$work/remote-tode.env" \
  "$SSH_HOST:$remote_work/"

ssh "$SSH_HOST" bash -s -- "$remote_work" "$PORT" <<'REMOTE'
set -euo pipefail
staging=$1
port=$2
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

if [ ! -e "$bin_dir/tode-pixel" ] && [ ! -L "$bin_dir/tode-pixel" ]; then
  [ -e "$bin_dir/tode" ] || [ -L "$bin_dir/tode" ] || {
    echo "existing tode launcher not found; install tode first" >&2
    exit 1
  }
  if [ -L "$bin_dir/tode" ]; then
    ln -s "$(readlink -f "$bin_dir/tode")" "$bin_dir/tode-pixel"
  else
    cp -p "$bin_dir/tode" "$bin_dir/tode-pixel"
  fi
fi

install -m 755 "$staging/tode-remote-wrapper" "$share_dir/tode-remote-wrapper"
install -m 644 "$staging/settings.json" "$user_dir/settings.json"
install -m 644 "$staging/keybindings.json" "$user_dir/keybindings.json"
install -m 600 "$staging/remote-tode.env" "$config_dir/remote-tode.env"
ln -sfn "$share_dir/tode-remote-wrapper" "$bin_dir/tode"

tmux kill-session -t "code-server-$port" 2>/dev/null || true
echo "remote backup: $backup"
echo "remote wrapper: $bin_dir/tode -> $share_dir/tode-remote-wrapper"
REMOTE

echo "deployed remote tode via $SSH_HOST"
echo "remote shell: $remote_shell"
echo "remote port: $PORT"

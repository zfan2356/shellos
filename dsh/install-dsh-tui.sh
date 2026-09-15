#!/usr/bin/env bash
# Internal helper: install the pinned dsh CLI and dsh-tui plugin, then make the
# tracked dsh configuration decisive on the target machine.
set -euo pipefail

TEMPLATE_DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DRY_RUN=0
SKIP_GLOBAL=0

usage() {
  cat >&2 <<'USAGE'
usage: install-dsh-tui.sh [--dsh-home <path>] [--skip-global-install] [--dry-run]

  --dsh-home <path>       harness home to configure (default $DSH_HOME or ~/.dsh)
  --skip-global-install   configure the existing install without touching npm
  --dry-run               print every change without writing anything
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dsh-home)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      DSH_HOME="$2"
      shift 2
      ;;
    --skip-global-install) SKIP_GLOBAL=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

[[ -n "$DSH_HOME" && "$DSH_HOME" == /* ]] || {
  echo "install-dsh-tui: --dsh-home must be an absolute path" >&2
  exit 2
}

VERSIONS_FILE="$TEMPLATE_DIR/versions.env"
[[ -r "$VERSIONS_FILE" ]] || {
  echo "install-dsh-tui: missing $VERSIONS_FILE" >&2
  exit 1
}
# shellcheck source=/dev/null
. "$VERSIONS_FILE"
: "${DSH_CLI_VERSION:?versions.env must pin DSH_CLI_VERSION}"
: "${DSH_TUI_VERSION:?versions.env must pin DSH_TUI_VERSION}"

# The dsh-tui launcher runs under node >= 22 while a machine may default to an
# older major, so the node root holding dsh, npm, and pnpm is selected here
# instead of trusting the caller's PATH.
select_node_root() {
  local dir
  for dir in "${NODE_ROOTS[@]}"; do
    [[ -n "$dir" && -x "$dir/node" && -x "$dir/npm" && -x "$dir/pnpm" ]] || continue
    printf '%s\n' "$dir"
    return 0
  done
  return 1
}

NODE_ROOTS=()
add_node_root() {
  local dir="$1" existing
  [[ -n "$dir" && -d "$dir" ]] || return 0
  for existing in ${NODE_ROOTS[@]+"${NODE_ROOTS[@]}"}; do
    [[ "$existing" == "$dir" ]] && return 0
  done
  NODE_ROOTS+=("$dir")
}

add_node_root "${SHELLOS_NODE_ROOT:-}"
add_node_root "$(dirname "$(command -v node 2>/dev/null || printf '/nonexistent')")"
add_node_root /usr/local/bin
add_node_root /usr/bin
add_node_root "$HOME/.local/bin"
# nvm layouts belong to a login user; the caller's HOME may be isolated (tests
# and CI), so discover every home instead of only $HOME.
for root in "$HOME" /root /home/*; do
  [[ -d "$root" ]] || continue
  for dir in "$root"/.nvm/versions/node/*/bin; do
    add_node_root "$dir"
  done
done

NODE_BIN="$(select_node_root || true)"
[[ -n "$NODE_BIN" ]] || {
  echo "install-dsh-tui: no node root provides node + npm + pnpm" >&2
  echo "install-dsh-tui: install node >= 22 plus pnpm (nvm + npm i -g pnpm), then rerun" >&2
  exit 1
}
export PATH="$NODE_BIN:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"

NODE_VERSION="$(node -v)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
(( NODE_MAJOR >= 22 )) || {
  echo "install-dsh-tui: dsh-tui requires node >= 22, found $NODE_VERSION in $NODE_BIN" >&2
  exit 1
}

run() {
  if (( DRY_RUN )); then
    printf 'dry-run: %s\n' "$*"
    return 0
  fi
  "$@"
}

installed_version() {
  node -e '
    const { readFileSync } = require("node:fs")
    try {
      const manifest = JSON.parse(readFileSync(process.argv[1], "utf8"))
      process.stdout.write(String(manifest.version ?? ""))
    } catch {
      process.stdout.write("")
    }
  ' "$1" 2>/dev/null || true
}

# npm's own view of where global packages and their bin links live.
NPM_PREFIX="$(npm config get prefix 2>/dev/null || true)"
if [[ -z "$NPM_PREFIX" || "$NPM_PREFIX" == "undefined" ]]; then
  NPM_PREFIX="$NODE_BIN/.."
fi
NODE_MODULES="$NPM_PREFIX/lib/node_modules"

install_global_pin() {
  local package="$1" pin="$2" current manifest
  manifest="$NODE_MODULES/$package/package.json"
  current="$(installed_version "$manifest")"
  if [[ "$current" == "$pin" ]]; then
    echo "install-dsh-tui: $package $pin already installed"
    return 0
  fi
  echo "install-dsh-tui: installing $package@$pin (found ${current:-none})"
  run npm install -g --no-fund --no-audit "$package@$pin"
}

if (( SKIP_GLOBAL == 0 )); then
  install_global_pin "@deepseek-ai/dsh" "$DSH_CLI_VERSION"
  install_global_pin "@deepseek-harness-tui/dsh-tui" "$DSH_TUI_VERSION"
fi

PROFILE_DIR="$DSH_HOME/profiles/dsh-tui"
PROFILE_MANIFEST="$PROFILE_DIR/package.json"

# Bootstrap the profile through the launcher's own documented path
# (`dsh plugin --profile dsh-tui add`), which scaffolds dsh-base as the first
# bundle layer. Re-running is how /update moves the pinned package forward.
if [[ -f "$PROFILE_MANIFEST" ]]; then
  echo "install-dsh-tui: profile present at $PROFILE_DIR (refreshing plugin layer)"
else
  echo "install-dsh-tui: bootstrapping profile at $PROFILE_DIR"
fi
run dsh plugin --profile dsh-tui add "@deepseek-harness-tui/dsh-tui@$DSH_TUI_VERSION"

# Repo state is decisive: the tracked configuration replaces whatever the
# machine had, after keeping a timestamped copy of the previous file.
STAMP="$(date +%Y%m%d-%H%M%S)"
sync_config() {
  local source="$1" target="$2" mode="$3" current
  current="$(cat "$target" 2>/dev/null || true)"
  if [[ "$current" == "$(cat "$source")" ]]; then
    echo "install-dsh-tui: $target already matches the repository"
    return 0
  fi
  if [[ -e "$target" ]]; then
    echo "install-dsh-tui: replacing $target (previous kept as $target.bak-$STAMP)"
    run cp -p "$target" "$target.bak-$STAMP"
  fi
  run install -m "$mode" "$source" "$target"
  echo "install-dsh-tui: wrote $target"
}

run mkdir -p "$DSH_HOME" "$PROFILE_DIR"
sync_config "$TEMPLATE_DIR/settings.yaml" "$DSH_HOME/settings.yaml" 600
sync_config "$TEMPLATE_DIR/cordis.patch.yml" "$PROFILE_DIR/cordis.patch.yml" 644

# Launchers on PATH: the global npm copy delegates to the profile copy, so a
# stale global never pins the version the TUI actually runs.
run mkdir -p "$HOME/.local/bin"
for launcher in dsh-tui dst; do
  source_bin="$NPM_PREFIX/bin/$launcher"
  link="$HOME/.local/bin/$launcher"
  [[ -x "$source_bin" ]] || {
    echo "install-dsh-tui: missing launcher $source_bin" >&2
    exit 1
  }
  if [[ "$(readlink -f "$link" 2>/dev/null || true)" == "$(readlink -f "$source_bin")" ]]; then
    continue
  fi
  if [[ -e "$link" && ! -L "$link" ]]; then
    echo "install-dsh-tui: refusing to replace non-symlink $link" >&2
    exit 1
  fi
  run ln -sfn "$source_bin" "$link"
  echo "install-dsh-tui: linked $link -> $source_bin"
done

if (( DRY_RUN )); then
  echo "install-dsh-tui: dry run complete"
  exit 0
fi

# Verification: the pinned plugin version must be the one inside the profile,
# and the tracked configuration must be byte-identical on disk.
[[ -f "$PROFILE_MANIFEST" ]] || {
  echo "install-dsh-tui: profile manifest missing after bootstrap" >&2
  exit 1
}
grep -Fq "\"@deepseek-harness-tui/dsh-tui\": \"^$DSH_TUI_VERSION\"" "$PROFILE_MANIFEST" ||
  grep -Fq "\"@deepseek-harness-tui/dsh-tui\": \"$DSH_TUI_VERSION\"" "$PROFILE_MANIFEST" || {
    echo "install-dsh-tui: profile does not pin dsh-tui $DSH_TUI_VERSION" >&2
    exit 1
  }
PLUGIN_MANIFEST="$PROFILE_DIR/node_modules/@deepseek-harness-tui/dsh-tui/package.json"
[[ -f "$PLUGIN_MANIFEST" ]] || {
  echo "install-dsh-tui: plugin package missing at $PLUGIN_MANIFEST" >&2
  exit 1
}
[[ "$(installed_version "$PLUGIN_MANIFEST")" == "$DSH_TUI_VERSION" ]] || {
  echo "install-dsh-tui: expected dsh-tui $DSH_TUI_VERSION, found $(installed_version "$PLUGIN_MANIFEST")" >&2
  exit 1
}
for pair in "$TEMPLATE_DIR/settings.yaml:$DSH_HOME/settings.yaml" \
            "$TEMPLATE_DIR/cordis.patch.yml:$PROFILE_DIR/cordis.patch.yml"; do
  cmp -s "${pair%%:*}" "${pair##*:}" || {
    echo "install-dsh-tui: configuration drift at ${pair##*:}" >&2
    exit 1
  }
done

# The API key is machine identity, never repository content: report it instead
# of trying to provision it.
if [[ ! -s "$DSH_HOME/.env" && ! -s "$DSH_HOME/.credentials.yaml" && -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "install-dsh-tui: DEEPSEEK_API_KEY is not configured for $DSH_HOME" >&2
  echo "install-dsh-tui: add it to $DSH_HOME/.env (DEEPSEEK_API_KEY=...) before launching" >&2
fi

echo "install-dsh-tui: dsh $DSH_CLI_VERSION + dsh-tui $DSH_TUI_VERSION ready in $DSH_HOME"

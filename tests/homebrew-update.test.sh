#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
work=$(mktemp -d /tmp/shellos-brew-test.XXXXXX)
trap 'rm -rf -- "$work"' EXIT
mkdir "$work/bin"
awk '/^update_homebrew\(\) \{/{copy=1} copy{print} copy && /^\}/{exit}' \
  "$REPO/scripts/reinstall-shellos.sh" > "$work/update.sh"
cat >> "$work/update.sh" <<'EOF'
update_homebrew
EOF
cat > "$work/bin/brew" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == --repository ]]; then echo /brew; exit 0; fi
printf '%s:%s:%s\n' "$GIT_HTTP_LOW_SPEED_LIMIT" "$GIT_HTTP_LOW_SPEED_TIME" "${GIT_CONFIG_COUNT:-0}" >> "$BREW_TEST_LOG"
if [[ "${BREW_TEST_SUCCESS:-0}" == 1 ]]; then exit 0; fi
[[ "${GIT_CONFIG_COUNT:-0}" == 2 && "${GIT_CONFIG_KEY_1:-}" == url.https://github.com/Homebrew/brew.insteadOf ]]
EOF
cat > "$work/bin/git" <<'EOF'
#!/usr/bin/env bash
echo "$BREW_TEST_REMOTE"
EOF
chmod +x "$work/bin/brew" "$work/bin/git"
export PATH="$work/bin:$PATH" BREW_TEST_LOG="$work/log"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=example.keep GIT_CONFIG_VALUE_0=yes
export BREW_TEST_REMOTE=https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew
bash "$work/update.sh" >/dev/null
diff -u <(printf '1024:30:1\n1024:30:2\n') "$work/log"
[[ "$GIT_CONFIG_COUNT" == 1 && "$GIT_CONFIG_VALUE_0" == yes ]]
export BREW_TEST_REMOTE=https://example.com/private-brew
if bash "$work/update.sh" >/dev/null; then echo "unexpected fallback for custom remote" >&2; exit 1; fi
export BREW_TEST_SUCCESS=1
bash "$work/update.sh" >/dev/null
echo "Homebrew update fallback tests: ok"

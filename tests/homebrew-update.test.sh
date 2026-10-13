#!/usr/bin/env bash
set -euo pipefail
export REPO="$(cd "$(dirname "$0")/.." && pwd)"
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
exec env -i PATH="$PATH" HOME="$HOME" \
  HOMEBREW_SHELLOS_GIT="$HOMEBREW_SHELLOS_GIT" \
  HOMEBREW_SHELLOS_MIRROR="${HOMEBREW_SHELLOS_MIRROR:-}" "$HOMEBREW_GIT_PATH" fetch
EOF
cat > "$work/bin/git" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == -C ]]; then cat "$work/remote"; exit 0; fi
printf '%s\\n' "\$*" >> "$work/log"
[[ -f "$work/success" || "\$*" == *url.https://github.com/Homebrew/brew.insteadOf=* ]]
EOF
chmod +x "$work/bin/brew" "$work/bin/git"
export PATH="$work/bin:$PATH"
echo https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew > "$work/remote"
bash "$work/update.sh" >/dev/null
[[ $(wc -l < "$work/log") == 2 ]]
grep -Fq 'http.lowSpeedLimit=1024 -c http.lowSpeedTime=30' "$work/log"
grep -Fq 'url.https://github.com/Homebrew/brew.insteadOf=https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew' "$work/log"
echo https://example.com/private-brew > "$work/remote"
if bash "$work/update.sh" >/dev/null; then echo "unexpected fallback for custom remote" >&2; exit 1; fi
touch "$work/success"
bash "$work/update.sh" >/dev/null
echo "Homebrew update fallback tests: ok"

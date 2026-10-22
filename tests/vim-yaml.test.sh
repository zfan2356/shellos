#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
work=$(mktemp -d /tmp/shellos-vim-test.XXXXXX)
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/home/.vim/ftdetect"
cp "$REPO/vim/ftdetect/shellos.vim" "$work/home/.vim/ftdetect/"
cat > "$work/home/.vimrc" <<'VIM'
set nocompatible
set t_Co=256
source $VIMRUNTIME/defaults.vim
VIM
cat > "$work/check.vim" <<'VIM'
for suffix in ['yaml.j2', 'yml.j2', 'yaml', 'yml']
  execute 'edit ' . fnameescape($SHELLOS_TEST_ROOT . '/config.' . suffix)
  call setline(1, ['optimizer:', '  enabled: true', '  rate: 0.95', '  value: {{ model_learning_rate }}'])
  call assert_equal('yaml', &filetype, suffix)
  call assert_equal('yaml', &syntax, suffix)
  call assert_match('yaml', synIDattr(synID(1, 1, 1), 'name'), suffix . ' key')
  call assert_match('yaml', synIDattr(synID(2, 12, 1), 'name'), suffix . ' boolean')
  call assert_match('yaml', synIDattr(synID(3, 9, 1), 'name'), suffix . ' number')
  bwipeout!
endfor
edit plain.py
call assert_equal('python', &filetype)
bwipeout!
edit plain.txt
call assert_notequal('yaml', &filetype)
if !empty(v:errors)
  call writefile(v:errors, $SHELLOS_TEST_ROOT . '/errors')
  cquit
endif
qa!
VIM
# Exercise both existing files (BufRead) and newly created files (BufNewFile).
for event in new existing; do
  if [[ "$event" == existing ]]; then
    for suffix in yaml.j2 yml.j2 yaml yml; do
      printf 'optimizer:\n  enabled: true\n' > "$work/config.$suffix"
    done
  fi
  if ! HOME="$work/home" SHELLOS_TEST_ROOT="$work" TERM=xterm-kitty \
    vim -N -u "$work/home/.vimrc" -i NONE -n -es -S "$work/check.vim"; then
    cat "$work/errors" >&2
    exit 1
  fi
done
echo "Vim YAML template highlighting: ok"

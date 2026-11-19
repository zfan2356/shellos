#!/usr/bin/env bash

verify_tode_extensions() {
  local inventory=$1 installed=$2 scope=$3
  local required_ids installed_ids entry
  required_ids=$(cut -d @ -f 1 "$inventory")
  installed_ids=$(cut -d @ -f 1 <<< "$installed")

  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    if [[ "$entry" == *@* ]]; then
      grep -Fqx "$entry" <<< "$installed" && continue
    else
      grep -Fqx "$entry" <<< "$installed_ids" && continue
    fi
    echo "$scope extension verification failed: expected $entry" >&2
    return 1
  done < "$inventory"

  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    case "$entry" in
      tode.tode-bridge|tode.tode-theme) continue ;;
    esac
    grep -Fqx "$entry" <<< "$required_ids" || {
      echo "$scope extension verification failed: unmanaged extension $entry" >&2
      return 1
    }
  done <<< "$installed_ids"
}

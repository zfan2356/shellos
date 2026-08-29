#!/usr/bin/env bash
# Internal full-reinstall helper: resolve the latest platform-specific VSIX
# from the official Visual Studio Marketplace and download it with curl.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
EXTENSION="${1:-}"
TARGET_PLATFORM="${2:-}"
OUTPUT="${3:-}"

if [[ "${SHELLOS_FULL_REINSTALL:-}" != 1 ]]; then
  echo "do not install extensions selectively; run $REPO/scripts/reinstall-shellos.sh <ssh-alias>" >&2
  exit 1
fi
if [[ $# -ne 3 || ! "$EXTENSION" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]]; then
  echo "usage: $0 <publisher.extension> <target-platform> <output.vsix>" >&2
  exit 2
fi
case "$TARGET_PLATFORM" in
  darwin-arm64|darwin-x64|linux-arm64|linux-x64) ;;
  *) echo "unsupported Marketplace target platform: $TARGET_PLATFORM" >&2; exit 2 ;;
esac
for command in curl python3; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "required command not found: $command" >&2
    exit 1
  }
done

mkdir -p "$(dirname "$OUTPUT")"
metadata=$(mktemp /tmp/shellos-marketplace-metadata.XXXXXX)
partial="$OUTPUT.part.$$"
cleanup() {
  rm -f -- "$metadata" "$partial"
}
trap cleanup EXIT

payload=$(printf '{"filters":[{"criteria":[{"filterType":7,"value":"%s"}],"pageNumber":1,"pageSize":1,"sortBy":0,"sortOrder":0}],"assetTypes":[],"flags":950}' "$EXTENSION")
curl --fail --silent --show-error --location \
  --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 20 \
  -H 'Accept: application/json;api-version=7.2-preview.1;excludeUrls=false' \
  -H 'Content-Type: application/json' \
  -H 'X-Market-Client-Id: VSCode 1.132.0' \
  --data "$payload" \
  'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=7.2-preview.1' \
  -o "$metadata"

read -r version vsix_url < <(
  python3 - "$metadata" "$EXTENSION" "$TARGET_PLATFORM" <<'PY'
import json
import sys

metadata_path, extension_id, target_platform = sys.argv[1:]
with open(metadata_path, encoding="utf-8") as stream:
    response = json.load(stream)

try:
    versions = response["results"][0]["extensions"][0]["versions"]
except (IndexError, KeyError, TypeError) as exc:
    raise SystemExit(f"Marketplace returned no versions for {extension_id}") from exc

for version in versions:
    if version.get("targetPlatform") != target_platform:
        continue
    for asset in version.get("files", []):
        if asset.get("assetType") == "Microsoft.VisualStudio.Services.VSIXPackage":
            print(version["version"], asset["source"])
            raise SystemExit(0)
raise SystemExit(
    f"Marketplace returned no {target_platform} VSIX for {extension_id}"
)
PY
)
case "$vsix_url" in
  https://*.gallerycdn.vsassets.io/*) ;;
  *) echo "refusing unexpected Marketplace asset URL: $vsix_url" >&2; exit 1 ;;
esac

echo "downloading $EXTENSION $version for $TARGET_PLATFORM from the official Marketplace CDN"
curl --fail --location --show-error \
  --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 20 \
  "$vsix_url" -o "$partial"

python3 - "$partial" "$EXTENSION" "$version" <<'PY'
import json
import sys
import zipfile

archive_path, expected_id, expected_version = sys.argv[1:]
with zipfile.ZipFile(archive_path) as archive:
    bad_member = archive.testzip()
    if bad_member:
        raise SystemExit(f"corrupt VSIX member: {bad_member}")
    manifest = json.loads(archive.read("extension/package.json"))

actual_id = f'{manifest.get("publisher", "")}.{manifest.get("name", "")}'.lower()
if actual_id != expected_id.lower():
    raise SystemExit(f"VSIX identity mismatch: expected {expected_id}, got {actual_id}")
if str(manifest.get("version", "")) != expected_version:
    raise SystemExit(
        f'VSIX version mismatch: expected {expected_version}, got {manifest.get("version")}'
    )
PY

mv -f -- "$partial" "$OUTPUT"
echo "downloaded and verified: $OUTPUT"

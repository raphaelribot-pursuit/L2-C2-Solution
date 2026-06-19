#!/usr/bin/env bash
# Download yt-dlp into Tauri bundle resources for release installers.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${SCRIPT_DIR}/../src-tauri/resources/bin"
mkdir -p "$DEST_DIR"

URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
DEST="${DEST_DIR}/yt-dlp"

echo "Downloading ${URL} -> ${DEST}"
curl -fsSL -o "$DEST" "$URL"
chmod +x "$DEST"

if [[ ! -f "$DEST" ]]; then
  echo "yt-dlp bundle download failed" >&2
  exit 1
fi

echo "Bundled yt-dlp ($(wc -c < "$DEST") bytes)"

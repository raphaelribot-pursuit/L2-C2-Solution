#!/usr/bin/env bash
# Build wisper on Linux with a GPU backend (no Tauri dev server).
# Examples:
#   ./build-linux.sh vulkan
#   ./build-linux.sh cuda
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="${1:-vulkan}"
exec "$ROOT/dev-linux.sh" --build-only --gpu-backend "$BACKEND"

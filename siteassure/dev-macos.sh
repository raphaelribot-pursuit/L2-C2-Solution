#!/usr/bin/env bash
# macOS dev launcher — Metal GPU is enabled automatically (Apple Silicon + Intel Macs).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v cmake >/dev/null 2>&1; then
  echo "CMake not found. Install with: brew install cmake"
  exit 1
fi

echo "Building with Apple Metal (whisper.cpp GGML_METAL)."
echo "Works on Apple Silicon and Intel Macs with a Metal-capable GPU."

if [[ "${1:-}" == "--build-only" ]]; then
  cargo build -p wisper
else
  npm run tauri -- dev
fi

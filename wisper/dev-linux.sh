#!/usr/bin/env bash
# Linux dev launcher — Vulkan or CUDA GPU (same feature flags as Windows).
# Usage:
#   ./dev-linux.sh
#   ./dev-linux.sh --gpu-backend vulkan
#   ./dev-linux.sh --gpu-backend cuda
#   ./dev-linux.sh --gpu-backend cpu
#   ./dev-linux.sh --build-only --gpu-backend vulkan
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

GPU_BACKEND="${WISPER_GPU_BACKEND:-auto}"
BUILD_ONLY=false

usage() {
  cat <<'EOF'
Usage: ./dev-linux.sh [options]

Options:
  --gpu-backend auto|vulkan|cuda|cpu   GPU backend (default: auto)
  --build-only                         cargo build only, no Tauri dev server
  -h, --help                           Show this help

Environment:
  WISPER_GPU_BACKEND   Same as --gpu-backend
  VULKAN_SDK           Vulkan SDK root (optional if system packages installed)
  CUDA_PATH            NVIDIA CUDA toolkit root
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gpu-backend)
      GPU_BACKEND="${2:?missing value for --gpu-backend}"
      shift 2
      ;;
    --build-only)
      BUILD_ONLY=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    return 1
  fi
}

check_linux_deps() {
  local missing=0
  require_cmd cmake || missing=1
  require_cmd cargo || missing=1
  require_cmd npm || missing=1

  if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
    echo "Missing: webkit2gtk-4.1 (Tauri 2). Example (Debian/Ubuntu):" >&2
    echo "  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev" >&2
    missing=1
  fi

  if [[ $missing -ne 0 ]]; then
    echo "Install Tauri Linux dependencies: https://v2.tauri.app/start/prerequisites/" >&2
    exit 1
  fi
}

resolve_vulkan() {
  if [[ -n "${VULKAN_SDK:-}" && -d "$VULKAN_SDK" ]]; then
    export VULKAN_SDK
    export PATH="$VULKAN_SDK/bin:$PATH"
    return 0
  fi
  if command -v vulkaninfo >/dev/null 2>&1 || pkg-config --exists vulkan 2>/dev/null; then
    return 0
  fi
  return 1
}

resolve_cuda() {
  if [[ -n "${CUDA_PATH:-}" && -d "$CUDA_PATH" ]]; then
    export CUDA_PATH
    export PATH="$CUDA_PATH/bin:$PATH"
    return 0
  fi
  if [[ -d /usr/local/cuda ]]; then
    export CUDA_PATH=/usr/local/cuda
    export PATH="$CUDA_PATH/bin:$PATH"
    return 0
  fi
  return 1
}

nvidia_gpu_present() {
  command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1
}

resolve_gpu_backend() {
  case "$GPU_BACKEND" in
    cpu)
      echo "cpu|"
      ;;
    cuda)
      echo "cuda|gpu-cuda"
      ;;
    vulkan)
      echo "vulkan|gpu-vulkan"
      ;;
    auto)
      if nvidia_gpu_present && resolve_cuda; then
        echo "cuda|gpu-cuda"
      elif resolve_vulkan; then
        echo "vulkan|gpu-vulkan"
      else
        echo "cpu|"
      fi
      ;;
    *)
      echo "Invalid --gpu-backend: $GPU_BACKEND (use auto, vulkan, cuda, cpu)" >&2
      exit 1
      ;;
  esac
}

check_linux_deps

IFS='|' read -r MODE FEATURE <<< "$(resolve_gpu_backend)"
echo "GPU backend selection: $MODE (requested: $GPU_BACKEND)"

run_build() {
  if [[ -n "$FEATURE" ]]; then
    echo "Cleaning whisper-rs-sys cache for backend switch..."
    cargo clean -p whisper-rs-sys
    echo "Building with GPU feature: $FEATURE"
    cargo build -p wisper --features "$FEATURE"
  else
    echo "Building CPU-only."
    cargo build -p wisper
  fi
}

run_dev() {
  if [[ -n "$FEATURE" ]]; then
    echo "Cleaning whisper-rs-sys cache for backend switch..."
    cargo clean -p whisper-rs-sys
    echo "Starting Tauri dev with GPU feature: $FEATURE"
    npm run tauri -- dev --features "$FEATURE"
  else
    echo "Starting Tauri dev (CPU-only)."
    npm run tauri -- dev
  fi
}

if [[ "$MODE" == "cuda" ]] && ! resolve_cuda; then
  echo "CUDA toolkit not found. Install NVIDIA CUDA and set CUDA_PATH, or use --gpu-backend vulkan." >&2
  exit 1
fi

if [[ "$MODE" == "vulkan" ]] && ! resolve_vulkan; then
  echo "Vulkan not found. Install Vulkan SDK or distro packages (vulkan-tools libvulkan-dev)." >&2
  exit 1
fi

if [[ "$BUILD_ONLY" == true ]]; then
  run_build
else
  run_dev
fi

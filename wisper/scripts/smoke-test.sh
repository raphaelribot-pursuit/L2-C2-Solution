#!/usr/bin/env bash
# CI-parity smoke test — run before opening a PR.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo ""
echo "==> wisper-core unit tests"
(cd wisper-core && cargo test --quiet)

echo ""
echo "==> wisper app check (CPU)"
cargo check -p wisper --quiet

echo ""
echo "==> frontend typecheck + build"
npm ci --silent
npm run build

echo ""
echo "Smoke test passed."

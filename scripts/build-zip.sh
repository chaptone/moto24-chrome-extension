#!/usr/bin/env bash
# Build a release-ready zip of the Moto24 PRB Chrome extension.
# Excludes repo plumbing, docs, and the build script itself.
# Output: dist/moto24-prb-extension-v<version>.zip
#
# Usage: bash scripts/build-zip.sh   (or: pnpm zip)

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./manifest.json').version")"
OUTPUT="dist/moto24-prb-extension-v${VERSION}.zip"

mkdir -p dist
rm -f "$OUTPUT"

zip -r "$OUTPUT" . \
  -x '.git/*' \
  -x '.github/*' \
  -x 'dist/*' \
  -x 'docs/*' \
  -x '*.md' \
  -x '.gitignore' \
  -x 'scripts/build-zip.sh' \
  -x 'package.json' \
  -x 'CLAUDE.md' \
  -x '*.pem' \
  -x '*.key' \
  -x '.DS_Store'

echo "Built: $OUTPUT"

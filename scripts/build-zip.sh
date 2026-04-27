#!/usr/bin/env bash
# Build a release-ready zip of the Moto24 PRB Chrome extension.
#
# Output: dist/moto24-prb-extension.zip (stable filename, version-independent)
# Inside the zip: files nested under a `moto24-prb-extension/` folder so
# extraction creates a predictable folder name on every platform — and
# dragging the extracted folder over an existing same-named folder on macOS
# triggers the "Replace?" prompt for clean officer-side updates.
#
# Usage: bash scripts/build-zip.sh   (or: pnpm zip)

set -euo pipefail

cd "$(dirname "$0")/.."

OUTPUT="dist/moto24-prb-extension.zip"
WRAPPER="moto24-prb-extension"
STAGING="dist/_staging"

mkdir -p dist
rm -f "$OUTPUT"
rm -rf "$STAGING"
mkdir -p "$STAGING/$WRAPPER"

# Whitelist: copy ONLY the files Chrome needs at runtime. This avoids
# accidentally shipping repo plumbing, build scripts, docs, or keys.
cp manifest.json "$STAGING/$WRAPPER/"
cp service-worker.js "$STAGING/$WRAPPER/"
cp -R popup "$STAGING/$WRAPPER/"
cp -R scripts "$STAGING/$WRAPPER/"
cp -R icons "$STAGING/$WRAPPER/"

# Drop the build script itself from the staged scripts/ — Chrome doesn't
# need it and it shouldn't ship to officers.
rm -f "$STAGING/$WRAPPER/scripts/build-zip.sh"

# Build the zip from the staging dir so the wrapper folder is the top-level
# entry inside the archive.
(cd "$STAGING" && zip -r "../../$OUTPUT" "$WRAPPER")

rm -rf "$STAGING"

echo "Built: $OUTPUT"

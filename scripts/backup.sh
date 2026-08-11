#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="${1:-$ROOT_DIR/backups/$STAMP}"
mkdir -p "$DEST"

if [[ -f "$ROOT_DIR/videos.json" ]]; then cp "$ROOT_DIR/videos.json" "$DEST/videos.json"; fi
if [[ -d "$ROOT_DIR/videos" ]]; then tar -czf "$DEST/videos.tgz" -C "$ROOT_DIR" videos; fi
if [[ -d "$ROOT_DIR/posters" ]]; then tar -czf "$DEST/posters.tgz" -C "$ROOT_DIR" posters; fi
if [[ -f "$ROOT_DIR/data/app.db" ]]; then cp "$ROOT_DIR/data/app.db" "$DEST/app.db"; fi
if [[ -d "$ROOT_DIR/data/media" ]]; then tar -czf "$DEST/media.tgz" -C "$ROOT_DIR/data" media; fi

echo "Backup created: $DEST"

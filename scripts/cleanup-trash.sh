#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRASH_DIR="${DATA_DIR:-$ROOT_DIR/data}/trash"
RETENTION_DAYS="${TRASH_RETENTION_DAYS:-7}"

if [[ ! -d "$TRASH_DIR" ]]; then
  echo "Trash directory does not exist: $TRASH_DIR"
  exit 0
fi

find "$TRASH_DIR" -type f -mtime "+$RETENTION_DAYS" -print -delete
echo "Trash cleanup complete: $TRASH_DIR (older than ${RETENTION_DAYS} days)"

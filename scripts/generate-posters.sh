#!/usr/bin/env bash

set -euo pipefail

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "未找到 ffmpeg，请先安装 ffmpeg。" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
cd "$project_root"

mkdir -p posters

find videos -type f -name '*.mp4' -print0 | while IFS= read -r -d '' video; do
  relative="${video#videos/}"
  unit="${relative%%/*}"
  filename="${relative#*/}"
  order="${filename%%-*}"

  if ! [[ "$order" =~ ^[0-9]+$ ]]; then
    echo "无法从文件名解析课程编号：$video" >&2
    exit 1
  fi

  mkdir -p "posters/$unit"
  poster="posters/$unit/$(printf '%02d' "$order").jpg"

  ffmpeg \
    -hide_banner \
    -loglevel error \
    -y \
    -ss 3 \
    -i "$video" \
    -frames:v 1 \
    -vf 'scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2:color=0xf4f7fb' \
    -q:v 4 \
    "$poster"

  echo "已生成：$poster"
done

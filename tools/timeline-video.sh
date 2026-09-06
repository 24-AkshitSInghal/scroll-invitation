#!/bin/sh
set -eu

# Build one hardware-decodable timeline from a theme's ordered frame clips.
# The generated files are committed assets; Vercel only copies them and does
# not need ffmpeg during deployment.

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
THEME=${1:-flowers-cloud-bird}
THEME_DIR="$ROOT/themes/$THEME"
THEME_JSON="$THEME_DIR/theme.json"
FRAME_DIR="$THEME_DIR/frames-720"
OUT_DIR="$THEME_DIR/video"

if [ ! -f "$THEME_JSON" ]; then
  echo "missing themes/$THEME/theme.json" >&2
  exit 1
fi
if [ ! -d "$FRAME_DIR" ]; then
  echo "missing themes/$THEME/frames-720" >&2
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required to generate the timeline video" >&2
  exit 1
fi

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/invitation-video.XXXXXX")
trap 'rm -rf -- "$TMP_DIR"' EXIT HUP INT TERM

CLIPS=$(node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.stdout.write([...new Set(t.scenes.map((s) => s.clip))].join("\n"));
' "$THEME_JSON")

INDEX=1
for CLIP in $CLIPS; do
  for FRAME in "$FRAME_DIR/$CLIP"/*.webp; do
    TARGET=$(printf '%s/%04d.webp' "$TMP_DIR" "$INDEX")
    ln -s "$FRAME" "$TARGET"
    INDEX=$((INDEX + 1))
  done
done

TOTAL=$((INDEX - 1))
mkdir -p "$TMP_DIR/reverse"
SOURCE_INDEX=$TOTAL
REVERSE_INDEX=1
while [ "$SOURCE_INDEX" -ge 1 ]; do
  SOURCE=$(printf '%s/%04d.webp' "$TMP_DIR" "$SOURCE_INDEX")
  TARGET=$(printf '%s/reverse/%04d.webp' "$TMP_DIR" "$REVERSE_INDEX")
  ln -s "$SOURCE" "$TARGET"
  SOURCE_INDEX=$((SOURCE_INDEX - 1))
  REVERSE_INDEX=$((REVERSE_INDEX + 1))
done

mkdir -p "$OUT_DIR"

# A half-second GOP makes backward jumps fast without turning every frame into
# a large keyframe. H.264 Main/yuv420p is the broad compatibility baseline for
# iOS Safari, Android Chrome, and Chromium-based Samsung Internet.
ffmpeg -hide_banner -loglevel warning -y \
  -framerate 24 -start_number 1 -i "$TMP_DIR/%04d.webp" \
  -an -c:v libx264 -preset slow -crf 23 -profile:v main -level 3.1 \
  -pix_fmt yuv420p -g 12 -keyint_min 12 -sc_threshold 0 -movflags +faststart \
  "$OUT_DIR/invitation-720.mp4"

ffmpeg -hide_banner -loglevel warning -y \
  -framerate 24 -start_number 1 -i "$TMP_DIR/%04d.webp" \
  -vf "scale=540:960:flags=lanczos" \
  -an -c:v libx264 -preset slow -crf 24 -profile:v main -level 3.1 \
  -pix_fmt yuv420p -g 12 -keyint_min 12 -sc_threshold 0 -movflags +faststart \
  "$OUT_DIR/invitation-540.mp4"

ffmpeg -hide_banner -loglevel warning -y \
  -framerate 24 -start_number 1 -i "$TMP_DIR/reverse/%04d.webp" \
  -an -c:v libx264 -preset slow -crf 23 -profile:v main -level 3.1 \
  -pix_fmt yuv420p -g 12 -keyint_min 12 -sc_threshold 0 -movflags +faststart \
  "$OUT_DIR/invitation-720-reverse.mp4"

ffmpeg -hide_banner -loglevel warning -y \
  -framerate 24 -start_number 1 -i "$TMP_DIR/reverse/%04d.webp" \
  -vf "scale=540:960:flags=lanczos" \
  -an -c:v libx264 -preset slow -crf 24 -profile:v main -level 3.1 \
  -pix_fmt yuv420p -g 12 -keyint_min 12 -sc_threshold 0 -movflags +faststart \
  "$OUT_DIR/invitation-540-reverse.mp4"

echo "generated themes/$THEME/video (forward/reverse, 720p/540p)"

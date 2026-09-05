#!/bin/bash
# Mobile tier: 720x1280, crf 25, GOP 3.
# Sized for what an iPhone can actually decode while scrubbing, not for nominal
# resolution. 1080x1920 was ~2.25x the pixels per seek and ~7MB per clip, which
# on a real device meant dropped frames and a long wait before anything painted.
set -e
SRC="${1:-../flowers_cloud_bird/clips}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/assets"
for i in 1 2 3 4 5 6 7 8; do
  ffmpeg -y -loglevel error -i "$SRC/clip$i.mp4" -an -vf "scale=720:-2,unsharp=5:5:0.5:5:5:0.0" \
    -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p \
    -g 3 -keyint_min 3 -sc_threshold 0 -movflags +faststart "$OUT/video/c$i-m.mp4"
  echo "clip$i -> $(du -h "$OUT/video/c$i-m.mp4" | cut -f1)"
done
echo "mobile total $(du -ch "$OUT"/video/c[1-8]-m.mp4 | tail -1 | cut -f1)"

#!/bin/bash
set -e
SRC="${1:-../flowers_cloud_bird/clips}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/assets"
mkdir -p "$OUT/video" "$OUT/poster"
for i in 1 2 3 4 5 6 7 8; do
  s="$SRC/clip$i.mp4"
  # desktop master: native 1080x1920, small GOP for cheap seeks, no audio
  ffmpeg -y -loglevel error -i "$s" -an -vf "unsharp=5:5:0.8:5:5:0.0" \
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
    -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart "$OUT/video/c$i.mp4"
  # mobile: 720 wide, tighter GOP (phone seek cost scales with frames-from-keyframe)
  ffmpeg -y -loglevel error -i "$s" -an -vf "scale=720:-2,unsharp=5:5:0.6:5:5:0.0" \
    -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
    -g 4 -keyint_min 4 -sc_threshold 0 -movflags +faststart "$OUT/video/c$i-m.mp4"
  # poster = the clip's actual first frame
  ffmpeg -y -loglevel error -i "$s" -vf "select=eq(n\,0),scale=540:-2" -frames:v 1 -q:v 4 "$OUT/poster/c$i.jpg"
  echo "clip$i done  $(du -h "$OUT/video/c$i.mp4" | cut -f1) / $(du -h "$OUT/video/c$i-m.mp4" | cut -f1)"
done

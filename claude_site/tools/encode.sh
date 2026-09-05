#!/bin/bash
# Regenerate assets/video + assets/poster from the source clips.
#   ./tools/encode.sh [path-to-clips]
# Both tiers are native 1080x1920 (full HD). The source clips run ~5-7 Mbps, so
# there is nothing above crf ~19 left to recover — the tiers differ in bitrate
# and GOP, not resolution. Seek cost is dominated by frames-from-keyframe, so the
# phone tier uses a tighter GOP; Blob playback already guarantees seekability, so
# neither tier needs all-intra.
set -e
SRC="${1:-../flowers_cloud_bird/clips}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/assets"
mkdir -p "$OUT/video" "$OUT/poster"
for i in 1 2 3 4 5 6 7 8; do
  s="$SRC/clip$i.mp4"
  ffmpeg -y -loglevel error -i "$s" -an -vf "unsharp=5:5:0.8:5:5:0.0" \
    -c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p \
    -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart "$OUT/video/c$i.mp4"
  ffmpeg -y -loglevel error -i "$s" -an -vf "unsharp=5:5:0.7:5:5:0.0" \
    -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p \
    -g 4 -keyint_min 4 -sc_threshold 0 -movflags +faststart "$OUT/video/c$i-m.mp4"
  ffmpeg -y -loglevel error -i "$s" -vf "select=eq(n\,0),scale=540:-2" -frames:v 1 -q:v 3 "$OUT/poster/c$i.jpg"
  echo "clip$i  $(du -h "$OUT/video/c$i.mp4" | cut -f1) / $(du -h "$OUT/video/c$i-m.mp4" | cut -f1)"
done
echo "desktop $(du -ch "$OUT"/video/c[1-8].mp4 | tail -1 | cut -f1)  mobile $(du -ch "$OUT"/video/c[1-8]-m.mp4 | tail -1 | cut -f1)"

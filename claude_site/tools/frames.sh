#!/bin/bash
# Extract each clip as a 1080x1920 WebP frame sequence.
#
# Why frames instead of video: scrubbing means seeking to arbitrary times, and on
# iOS that is both slow and unreliable — decoders are a limited resource and a
# scene that fails to decode is stranded on a still. Frames have no seek, no
# decoder, no codec state: scroll position picks an array index.
#
# The first and last frame of every sequence are the clip's true first and last
# frames, so the chain stays seam-exact.
set -e
SRC="${1:-../flowers_cloud_bird/clips}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/assets/frames"
N=${N:-56}
mkdir -p "$OUT"
for i in 1 2 3 4 5 6 7 8; do
  d="$OUT/c$i"; rm -rf "$d"; mkdir -p "$d"
  total=$(ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of csv=p=0 "$SRC/clip$i.mp4")
  expr=$(python3 -c "
n=$N; t=$total
idx=[round(k*(t-1)/(n-1)) for k in range(n)]
print('+'.join('eq(n\\\\,%d)'%v for v in sorted(set(idx))))
")
  ffmpeg -y -loglevel error -i "$SRC/clip$i.mp4" \
    -vf "select='$expr',scale=1080:1920:flags=lanczos" -fps_mode passthrough "$d/%03d.png"
  for f in "$d"/*.png; do
    cwebp -quiet -q 70 -m 6 "$f" -o "${f%.png}.webp"; rm "$f"
  done
  echo "c$i: $(ls "$d"/*.webp | wc -l | tr -d ' ') frames, $(du -sh "$d" | cut -f1)"
done
echo "TOTAL $(du -sh "$OUT" | cut -f1)"

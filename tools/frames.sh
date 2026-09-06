#!/bin/bash
# Extract each clip as a WebP frame sequence.
#
#   THEME=flowers-cloud-bird ./tools/frames.sh <clips-dir>
#   THEME=flowers-cloud-bird W=720 ./tools/frames.sh <clips-dir>
#
# Writes themes/<theme>/frames (1080) or frames-720. PATTERN sets the source
# filename when a theme's clips aren't named clipN.mp4, e.g. PATTERN='clip%d_a.mp4'.
# The interactive site needs the 720 tier; timeline-video.sh turns it into 720p
# and 540p H.264 files and build.mjs extracts only the exact stop posters.
# Keeping 1080 frames is optional source/archive material, not a delivery tier.
#
# The first and last frame of every sequence are the clip's true first and last
# frames, so the chain stays seam-exact.
set -e
SRC="${1:?usage: THEME=<name> [W=720] [PATTERN='clip%d.mp4'] tools/frames.sh <clips-dir>}"
THEME="${THEME:?set THEME=<theme-folder-name>}"
PATTERN="${PATTERN:-clip%d.mp4}"
W=${W:-1080}
H=$(( W * 16 / 9 ))
SUFFIX=""; [ "$W" != "1080" ] && SUFFIX="-$W"
OUT="$(cd "$(dirname "$0")/.." && pwd)/themes/$THEME/frames$SUFFIX"
N=${N:-56}
mkdir -p "$OUT"
for i in 1 2 3 4 5 6 7 8; do
  d="$OUT/c$i"; rm -rf "$d"; mkdir -p "$d"
    src="$SRC/$(printf "$PATTERN" "$i")"
  [ -f "$src" ] || { echo "missing $src"; exit 1; }
  total=$(ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of csv=p=0 "$src")
  expr=$(python3 -c "
n=$N; t=$total
idx=[round(k*(t-1)/(n-1)) for k in range(n)]
print('+'.join('eq(n\\\\,%d)'%v for v in sorted(set(idx))))
")
  ffmpeg -y -loglevel error -i "$src" \
    -vf "select='$expr',scale=$W:$H:flags=lanczos" -fps_mode passthrough "$d/%03d.png"
  for f in "$d"/*.png; do
    cwebp -quiet -q 70 -m 6 "$f" -o "${f%.png}.webp"; rm "$f"
  done
  echo "c$i: $(ls "$d"/*.webp | wc -l | tr -d ' ') frames, $(du -sh "$d" | cut -f1)"
done
echo "TOTAL $(du -sh "$OUT" | cut -f1)"

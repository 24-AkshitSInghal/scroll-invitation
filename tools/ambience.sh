#!/usr/bin/env bash
# ambience.sh — build a looping ambient bed from a theme's clips
# ---------------------------------------------------------------------------
#   ./tools/ambience.sh <clips-dir> <theme-name>
#   ./tools/ambience.sh flowers_cloud_bird/clips flowers-cloud-bird
#
# The clips carry their own audio — wind, birds, room tone. The site cannot use
# it directly: the video plays in one- to three-second bursts between stops, and
# the reverse timeline plays backwards, so the element's own soundtrack would
# stutter forwards and run reversed going back. So the audio is lifted out here
# and laid end to end into one continuous bed the page loops underneath the song.
#
# Joins are crossfaded rather than faded to silence — an 0.35s dip every eight
# seconds reads as pumping once you notice it. Levelled to -26 LUFS because this
# sits under a song and must never compete with it.
set -euo pipefail

CLIPS="${1:?usage: ambience.sh <clips-dir> <theme-name>}"
THEME="${2:?usage: ambience.sh <clips-dir> <theme-name>}"
OUT="themes/$THEME/audio"
XFADE="${XFADE:-0.6}"

shopt -s nullglob
files=("$CLIPS"/clip*.mp4)
[ ${#files[@]} -gt 0 ] || { echo "✗ no clip*.mp4 in $CLIPS"; exit 1; }

for f in "${files[@]}"; do
  ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$f" | grep -q audio \
    || { echo "✗ $(basename "$f") has no audio track"; exit 1; }
done

mkdir -p "$OUT"
inputs=(); filter=""; prev="[0:a]"
for i in "${!files[@]}"; do
  inputs+=(-i "${files[$i]}")
  [ "$i" -eq 0 ] && continue
  filter+="${prev}[${i}:a]acrossfade=d=${XFADE}:c1=tri:c2=tri[a${i}];"
  prev="[a${i}]"
done

total=$(python3 -c "
import subprocess,sys
fs=sys.argv[1:]
d=sum(float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f],capture_output=True,text=True).stdout) for f in fs)
print(round(d-${XFADE}*(len(fs)-1),2))" "${files[@]}")
fadeout=$(python3 -c "print(max(0, $total - 0.9))")

filter+="${prev}highpass=f=60,lowpass=f=11000,loudnorm=I=-26:TP=-3:LRA=9,afade=t=in:st=0:d=0.8,afade=t=out:st=${fadeout}:d=0.9[out]"

tmp="$(mktemp -t ambience).wav"
ffmpeg -v error -y "${inputs[@]}" -filter_complex "$filter" -map "[out]" -ac 1 -ar 44100 "$tmp"
ffmpeg -v error -y -i "$tmp" -c:a aac      -b:a 72k -movflags +faststart "$OUT/ambience.m4a"
ffmpeg -v error -y -i "$tmp" -c:a libmp3lame -b:a 80k "$OUT/ambience.mp3"
rm -f "$tmp"

echo "✓ $OUT/ambience.{m4a,mp3} — ${#files[@]} clips, ${total}s loop"
ls -lh "$OUT"

# ShubhMilan — scroll invitation

An Apple-style scroll-scrubbed invitation. The eight rendered clips form **one
continuous camera flight**; scroll doesn't animate anything, it sets the video's
`currentTime`. Because each clip was generated starting from the previous clip's
actual last frame, the joins are frame-identical and the flight reads as a single
unbroken shot.

Plain HTML/CSS/JS. No build step, no dependencies, no framework.

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

---

## Editing the content

Almost everything is in **`assets/js/invite.config.js`** — names, date, venue,
map query, RSVP settings, and the pacing of each scene. The wording that sits on
screen is in `index.html`, one `<section class="copy">` per scene, in order.

### Turning on the RSVP

The form works today: it validates, confirms, and keeps every response in the
visitor's `localStorage` so nothing is silently lost. It just has nowhere to
*send* them yet. Give it an endpoint and it starts posting JSON:

```js
rsvp: {
  endpoint: 'https://formspree.io/f/xxxxxxx',   // or any URL that accepts POST JSON
  whatsapp: '919876543210',                     // optional: adds a WhatsApp fallback button
}
```

The payload is `{ name, attending, message, submittedAt }`.

---

## The scenes

| # | Clip | Scene | Notes |
|---|------|-------|-------|
| 1 | c1 | Monogram opening | **Auto-flies itself** on load; `#ShubhMilan` appears as the monogram finishes drawing |
| 2 | c2 | The couple | Names inside the floral arch |
| 3 | c3 | Families | Both sets of parents |
| 4 | c4 | Save the date | **Scratch card** — antique-gold foil filling the medallion (73.5% of picture width, 1px inside the ring), with a gold bloom + petal burst on reveal |
| 5 | c5 | Ceremony | Live countdown + Add to calendar (`.ics`) |
| 6 | c6 | Venue | Address + Open map |
| 7 | c7 | RSVP | **Form** on the silk panel, held to 58% of the picture so both birds stay visible |
| 8 | c8 | Blessings | Closing line, names, hashtag |

### Pacing knobs (per section, in `invite.config.js`)

- **`scroll`** — viewport-heights of scroll the scene occupies. Bigger = slower.
- **`settle`** — `0..1`. The clip reaches its **final frame** at this point in the
  band and comes to a genuine **rest** there. Only for scenes meant to stop:
  the logo hold (1), the scratch card (4), the RSVP panel (7) and the finale (8).
  Scenes 4 and 7 settle early — `0.42` and `0.38` — so the medallion and the silk
  panel are locked perfectly still while someone is scratching or typing.
- **`linger`** — `0..0.6`. The alternative to stopping: it slows the camera
  through the middle of the scene, where the copy peaks, and lets it run at full
  speed into the seam. `f(0)=0` and `f(1)=1` are preserved exactly, so the frames
  either side of a join are still the ones the clips were chained on. The four
  transit scenes (2, 3, 5, 6) use this — a `settle` hold mid-flight reads as the
  camera stalling, which is what made the earlier joins feel like cuts.
- **`copy`** — `[fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd]` in local
  `0..1`. Individual elements can carry their own `data-fade="i0,i1,o0,o1"` to
  hand off within one scene (scene 1 uses this).

  A ramp that begins at `0` is still *invisible* at `0` — that's why the opening
  scene's ramps start slightly negative.

### Type

No `:has()` anywhere: iOS Safari 15 doesn't support it, and the one place it was
used (hiding the reveal button once the date is showing) would simply have failed
open on an older iPhone. The reveal code sets a class instead.

`#ShubhMilan` is the one thing guests have to remember, so it gets its own face:
**Playfair Display** italic 600 (`--font-tag`), well above the body serif in size
and weight, with the `#` in gold. It is deliberately *not* gradient-filled text —
`background-clip: text` combined with a bright drop-shadow glow bleached it to a
pale pink; solid ink with a plain halo is both richer and predictable everywhere.

---

### The opening flight

On a cold load at the top, the page flies the first scene itself over ~8.5s so
the monogram draws without the visitor doing anything, then stops and hands over.
Three things it has to get right, all in `autoIntro()`:

- **It waits for the clip.** Starting before the decoder can answer meant the
  scroll ran the whole way while the picture was still on frame 0 — the monogram
  finished drawing several seconds after the camera had already stopped.
- **It drops the smoothing.** The rAF lerp that makes hand-scrolling feel good
  puts the picture behind a scripted scroll, so `introActive` sets the follow
  factor to 1 and the clip tracks as fast as the decoder allows. (Seek coalescing
  still protects it.)
- **It never fights the visitor.** Any wheel, touchmove or keypress aborts it
  instantly, and it only runs from a cold start at the very top — a reload
  midway, or `prefers-reduced-motion`, skips it entirely.

## Why the code looks the way it does

Three things make scroll-scrubbed video work, and each is easy to get wrong:

1. **Clips are fetched as Blobs.** Many static hosts don't answer HTTP
   byte-range requests, which pins `video.seekable` to `[0,0]` and clamps every
   seek to frame 0 — the video looks frozen. An in-memory object URL is always
   fully seekable, so the host can't break it.
2. **Seeks are coalesced.** A new `currentTime` is never assigned while the
   decoder is still `seeking`. Without this a fast flick on a phone queues seeks
   faster than they resolve and the picture locks up.
3. **iOS priming.** A muted video that has never been played won't paint a
   seeked frame in iOS Safari. So the poster stays up until the clip's first real
   `seeked` event, and every video gets a muted play→pause on first touch. Don't
   remove the posters or the `playsinline`/`muted` attributes.

### Video-space coordinates

The clips are 1080×1920 and the scenes are `object-fit: cover`. On desktop the
stage is itself 9:16, so a percentage of the stage is a percentage of the
picture. **On a phone it isn't** — the stage is full-bleed and taller than 9:16,
so the film is cropped at the sides.

Anything that must land exactly on painted artwork — the scratch medallion, the
RSVP panel — is therefore positioned against `--vx / --vy / --vw / --vh`, which
the engine recomputes on every layout to describe where the video's own 0–100%
actually falls inside the stage. If you add another overlay pinned to something
in the film, use those, not percentages.

Measured off the frames themselves:

- medallion blank disc — centre `49.35% / 47.76%`, diameter `73.9%` of picture
  width (`74.6%` down — it is very slightly oval, so the foil takes the smaller).
  Measured by walking out from the disc's interior to the gold ring's luminance
  edge on a 540×960 sample of the final frame; eyeballing it off a screenshot had
  the centre ~1% high, which is enough to leave a visible crescent of bare ring
  along the bottom.
- RSVP silk panel — `18.5%–83%` across, `16.7%–81%` down

---

## Re-encoding the clips

`tools/encode.sh` regenerates everything in `assets/video` and `assets/poster`
from the source clips:

```bash
./tools/encode.sh ../flowers_cloud_bird/clips
```

**Both tiers are native 1080×1920 — full HD on every device.** The source clips
run about 5–7 Mbps, so there is nothing above `crf ~19` left to recover; the two
tiers differ in bitrate and GOP, not resolution. Seek cost is dominated by how
many frames sit between the target and the previous keyframe, so the phone tier
uses a tighter GOP (`-g 4`) — while all-intra would balloon an 8s clip to ~25 MB
for no visible gain, since Blob playback already guarantees seekability.

**Current weight: 68 MB desktop, 53 MB mobile** across all eight clips. Nothing
loads up front — the engine fetches only what is within ~1.5 screens of the
viewport, so landing on the page costs one clip (~7 MB). If you'd rather trade
sharpness for data on phones, change the second ffmpeg line in `tools/encode.sh`
to `scale=720:-2` with `-crf 24`: that halves the mobile tier to ~26 MB.

---

## Music

`Kudmayi` is already trimmed to start at **0:10** of the original and faded at
both ends, so `loop` doesn't click on the wrap — the whole file is the loop.
Swap it in `music` in `invite.config.js`; `tools/` has no audio step, the file was
made with:

```bash
ffmpeg -ss 10 -t 150 -i song.webm -vn \
  -af "afade=t=in:st=0:d=1.2,afade=t=out:st=148.2:d=1.8,loudnorm=I=-18:TP=-1.5:LRA=11" \
  -c:a aac -b:a 128k -movflags +faststart assets/audio/kudmayi.m4a
```

The toggle sits top-right. **Browsers refuse un-muted autoplay until the visitor
has interacted with the page and there is no way around that** — so the player
asks once on load, and if it is refused it arms the very next gesture (tap,
scroll or key) to start. The button always shows the true state, so nobody is
left wondering whether music is meant to be playing. It also pauses when the tab
is hidden and resumes when it comes back.

## Accessibility & graceful degradation

- The scratch card has a **"Reveal the date"** button, parked in the open cloud
  below the medallion — nobody is locked behind a rub gesture.
- Music never starts without a gesture in browsers that require one, and it is
  never the only channel for anything.
- `prefers-reduced-motion`: no video is fetched at all. The posters stay up and
  cross-dissolve, which is also the cheapest possible path on a weak device.
- If a clip fails to load, its poster carries the scene. Because each poster is
  that clip's real first frame — and therefore the previous clip's last frame —
  even a failed load shows the correct picture.
- The right-hand rail jumps between scenes; each dot is a real focusable button.

---

## Still to come

The couple's photograph and the final RSVP wording were going to be supplied
later. Drop the photo into `assets/img/` and it can sit in scene 2 or 8; the RSVP
copy is in the scene 7 block of `index.html`.

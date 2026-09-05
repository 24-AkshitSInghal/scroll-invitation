# ShubhMilan — scroll invitation

An Apple-style scroll-scrubbed invitation. The eight rendered clips form **one
continuous camera flight** across ten scenes; scroll doesn't animate anything, it sets the video's
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
map query, hosts and their phone numbers, RSVP settings, and the pacing of each
scene. The wording that sits on
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
| 3 | — | The two of us | The couple's photograph, arch-framed inside the wreath. **No clip of its own** — holds clip 2's final frame (`poster/c2b.jpg`) |
| 4 | c3 | Families | Both sets of parents |
| 5 | c4 | Save the date | **Scratch card** — antique-gold foil filling the medallion (73.5% of picture width, 1px inside the ring), with a gold bloom + petal burst on reveal |
| 6 | c5 | Ceremony | Live countdown + Add to calendar (`.ics`) |
| 7 | c6 | Venue | Address + Open map |
| 8 | c7 | RSVP | **Form** on the silk panel, held to 58% of the picture so both birds stay visible |
| 9 | c8 | Blessings | Closing line, names, hashtag |
| 10 | — | With love | Hosts + tap-to-call numbers. **No clip of its own**: the camera has already come to rest, so this scene holds clip 8's final frame as a still (`poster/c9.jpg`) and the card settles onto it. Same picture across the seam, so nothing moves. |

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
- **`parallax`** — viewport-heights the scene's copy drifts as you pass through
  it, centred on mid-scene so it rises through the frame rather than starting or
  ending displaced. **The film itself is never transformed** — doing so would
  break the seams and pull the video-space anchors off their artwork — so all
  depth comes from the overlays moving at their own rate against it.
- **`anchored`** — `true` for the three scenes whose overlay sits on painted
  artwork: the scratch medallion, the RSVP silk panel and the portrait frame.
  It suppresses the entrance rise as well as the parallax. This matters more than
  it looks: the entrance offset alone was displacing the scratch card and the
  RSVP panel by up to 13.5px while they faded in — already inside the window
  where they accept a scratch or a tap.
- **`copy`** — `[fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd]` in local
  `0..1`. Individual elements can carry their own `data-fade="i0,i1,o0,o1"` to
  hand off within one scene (scene 1 uses this).

  A ramp that begins at `0` is still *invisible* at `0` — that's why the opening
  scene's ramps start slightly negative.

### The scratch foil

The foil is painted from the page's own gold ramp read off the CSS custom
properties at paint time — `--gold-deep` → `--gold` → `--gold-soft` →
`--gold-bright`, with `--cream` as the sheen raking across the middle — rather
than one-off hex values, so retuning the palette retunes the foil. The reveal
bloom, the petal sparks and the date's glow are on the same tokens.

The "scratch to reveal" hint is `--ink-soft`, not `--gold-deep`: gold-on-gold
measured **2.86:1** against the foil actually behind it, under the 3:1 floor for
large text. `--ink-soft` is the same palette's secondary ink and measures 4.48:1.

### Parallax layers

Individual elements opt into their own depth with `data-par` (and optionally
`data-par-scale`); the engine writes the result to a `--par` custom property each
frame, and the element folds that into whatever transform it already uses for its
own positioning, so the two never clobber each other. The portrait uses this: the
photograph and the names below it travel at different rates against the static
wreath, the names further because they read as nearer.

Two things that are easy to get wrong here:

- **`data-par` is a percentage of the PICTURE's height, not the viewport's.**
  These layers sit on painted artwork, and on a tall desktop window the stage is
  capped at 1180px while the viewport keeps growing — a `vh`-based drift then
  travels further across the picture than intended and slides the photograph into
  the wreath's lower flowers. Resolved to px against `--vh`, phone and tall
  desktop measure identically.
- **The portrait scales about its bottom edge** (`transform-origin: 50% 100%`).
  That edge is the binding constraint against the flowers; letting the scale
  breathe upward into the roomier top margin keeps it clear at every scroll
  position.

### A scene with no clip

Sections 3 and 10 set `clip: null`. `loadClip()` skips those entirely, so nothing is
fetched and the poster carries the scene — and because that poster is the frame
the previous clip ends on, the join is invisible without a second copy of the
video. Use the same trick for any further closing panels: extract the last frame,
point `poster` at it, leave `clip` null. It costs one JPEG instead of a second
copy of a video, and because clip 3 was itself chained from clip 2's last frame,
dropping a still scene in between leaves the flight continuous on both sides.

### Swapping the photograph

`assets/img/couple.jpg` (760×1188). Replace it and keep a portrait aspect.

`.portrait` is arch-topped, 47% of the picture width, centred on `50.5% / 42.2%`.
The wreath clip 2 rests on has an opening of `24%–78%` across and `15.6%–64.6%`
down; the frame lands at `27%–74%` and `21.5%–62.9%`, deliberately **inset
inside** that rather than filling it: the opening is an oval, so a rectangle
spanning its full height pushes its top corners into the flowers. It sits low in
the opening on purpose (5.9% of air above, 1.7% below) — the lower flowers are
the binding constraint, so moving the photo further down means shrinking it
rather than just shifting it. Arch-topped and not oval, because an oval crops the
lehenga and both pairs of feet — most of what makes the photograph.

The names are a separate `.portrait__names`, not a `<figcaption>`, so they can be
positioned independently of the frame: they sit at `80%` of the picture height,
clear of the wreath, which bottoms out around `76%`. Playfair Display italic —
the same display face as the hashtag — capped by `8.2vw` as well as viewport
height so `white-space: nowrap` can't overflow a narrow, tall phone.

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

## The film is frames, not video

The first two builds scrubbed eight `<video>` elements by setting `currentTime`.
On a desktop that is fine. On an iPhone 15 over Vercel it was not: the film ran
to about clip 4 and then stopped, some clips failed to appear at all on refresh,
and what was left was copy sliding over a still image.

The reason is that scrubbing asks a video decoder to do the thing it is worst at
— decode at an arbitrary point in a dependency chain, thousands of times — while
video decoders are a limited system resource a phone will not hand out ten of.
A scene whose decoder never came up simply never painted, and there was no
recovering it. Every fix short of removing video was treating a symptom.

So scroll now picks an array index instead:

- **`assets/frames/cN/001..056.webp`** — 56 frames per clip at 1080x1920, 448
  frames, **26MB for the whole film**, which is *less* than the mobile video tier
  it replaced. Frame 1 and frame 56 are the clip's true first and last, so the
  chain is still seam-exact.
- **No seeking, no decoder, no codec state.** Nothing can be in a bad state.
- **One canvas.** Ten stacked full-screen layers was work the compositor repeated
  every frame; a crossfade is now two `drawImage` calls.

Decoding all 448 frames would be 3.7GB, so `film.js` never does: frames are held
as compressed Blobs and only a window around the playhead is decoded, via
`createImageBitmap` (which decodes off the main thread), with bitmaps outside the
window closed. If the exact frame isn't ready the renderer draws the nearest one
that is — a fast flick degrades to a slightly stale frame rather than a stall.

Regenerate with `tools/frames.sh`; `N=72 ./tools/frames.sh` for a finer sequence
at proportionally more bytes.

### The gate

Everything loads behind the **Open Invitation** button. It costs a wait up front,
but it is the only honest way to promise the scroll never stutters — and the tap
is a real user gesture, which is also the one moment iOS will reliably let the
music start.

If you would rather people got in sooner, `loadAll()` already fetches in scene
order, so opening the gate once the first two sequences are in and letting the
rest continue in the background is a small change.

### Other things that were costing time

- All ten posters fetched at once against the clip on screen; the Google Fonts
  stylesheet was render-blocking from a third-party origin (now async); the 2.4MB
  song was `preload="auto"` and raced the first clip (now `metadata`).
- Every `backdrop-filter` is a full-screen readback per frame and they are
  ruinous on iOS mid-scroll. They now apply only under
  `(hover: hover) and (pointer: fine)`, with opaque equivalents on phones.
- `vercel.json` marks the frames, audio and images `immutable` for a year, so a
  second visit opens instantly.

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

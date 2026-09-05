# ShubhMilan — scroll invitation

An Apple-style scroll-driven invitation. The eight rendered clips form **one
continuous camera flight** across ten scenes; scroll doesn't animate anything, it
picks a frame. Because each clip was generated starting from the previous clip's
actual last frame, the joins are frame-identical and the flight reads as a single
unbroken shot.

**There is no video on this page.** The film is a WebP frame sequence drawn into
a canvas — see *The film is frames* below for why that matters.

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
| 1 | c1 | Monogram opening | Greeting centred on landing; the monogram completes at 70% and `#ShubhMilan` lands with it |
| 2 | c2 (0–72%) | The couple | Names inside the floral arch |
| 3 | c2 (72–100%) | The two of us | The couple's photograph. **The second half of clip 2** — the camera keeps drifting while the photo is up, rather than freezing on a still |
| 4 | c3 | Families | Both sets of parents |
| 5 | c4 | Save the date | **Reveal button** in the middle of the medallion, with a gold bloom + petal burst |
| 6 | c5 | Ceremony | Live countdown + Add to calendar (`.ics`) |
| 7 | c6 | Venue | Address + Open map |
| 8 | c7 | RSVP | **Form** on the silk panel, held to 58% of the picture so both birds stay visible |
| 9 | c8 (0–70%) | Blessings | Closing line, names, hashtag |
| 10 | c8 (70–100%) | With love | Hosts + tap-to-call numbers. **The last 30% of clip 8** — the wreath finishes drawing across this scene, so the card lands exactly as the film runs out |

### Pacing knobs (per section, in `invite.config.js`)

- **`scroll`** — viewport-heights of scroll the scene occupies. Bigger = slower.
- **`settle`** — `0..1`. The clip reaches its **final frame** at this point in the
  band and comes to a genuine **rest** there. Only for scenes meant to stop: the
  logo hold (1, at `0.70`), the medallion (5, at `0.42`) and the RSVP panel
  (8, at `0.34`) — the last two settle early so the artwork is locked perfectly
  still while someone is tapping or typing on it.
- **`linger`** — `0..0.6`. The alternative to stopping: it slows the camera
  through the middle of the scene, where the copy peaks, and lets it run at full
  speed into the seam. `f(0)=0` and `f(1)=1` are preserved exactly, so the frames
  either side of a join are still the ones the clips were chained on. The four
  transit scenes (2, 3, 5, 6) use this — a `settle` hold mid-flight reads as the
  camera stalling, which is what made the earlier joins feel like cuts.
- **`from`/`to`** — the **slice** of its clip a scene owns, `0..1`. See
  *Clip slices* below.
- **`anchored`** — `true` for the scenes whose overlay sits on painted artwork:
  the medallion, the RSVP silk panel and the portrait frame. It suppresses the
  entrance rise. This matters more than it looks: that 1.6vh offset alone was
  displacing the medallion and the RSVP panel while they faded in — already
  inside the window where they accept a tap.
- **`copy`** — `[fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd]` in local
  `0..1`. Individual elements can carry their own `data-fade="i0,i1,o0,o1"` to
  hand off within one scene (scene 1 uses this).

  A ramp that begins at `0` is still *invisible* at `0` — that's why the opening
  scene's ramps start slightly negative.

### Reveal, not scratch

The bloom, the petal sparks and the date's glow are painted from the page's own
gold ramp — `--gold-deep` → `--gold` → `--gold-soft` → `--gold-bright`, with
`--cream` as the highlight — so retuning the palette retunes them.

The scratch canvas is gone. It covered ~74% of the screen and had to claim touch
gestures to detect a rub, which meant a swipe beginning on the medallion could
not scroll the page — a delightful idea that quietly cost the page the one thing
it exists to do. A gold button sits in the middle of the disc instead and hands
over to the date on tap; the bloom and the petal burst are unchanged.

### No parallax

The overlays used to drift against the film at their own rate. It is off
everywhere now (`parallax: 0`, no `data-par`): with the scenes lengthened, the
drift read as the copy sliding rather than as depth, and it was the first thing
blamed whenever the page felt unsteady.

### Clip slices, not stills

A scene can own a **slice** of its clip via `from`/`to`, and two do: the couple
play clip 2 to 72% and the photograph carries it from there; blessings play clip
8 to 70% and the closing card carries the rest.

This replaced two scenes that held a single frozen frame. Freezing was the
"scroll pauses" everyone felt — the page kept scrolling but the picture stopped
dead, which reads as the site hanging. A slice keeps the camera drifting under
the overlay, and consecutive slices of the same sequence are seamless by
construction: it is the same clip, still running. Verified 40→40 and 39→39 at the
two joins.

It also means the film now ends *with* the invitation: the wreath finishes
drawing itself across the final scene, so the closing card and the last frame
arrive together.

### Swapping the photograph

`assets/img/couple.jpg` (760×1188). Replace it and keep a portrait aspect.

`.portrait` is arch-topped, 47% of the picture width, centred on `50.5% / 42.2%`.
The wreath has an opening of `24%–78%` across and `15.6%–64.6%` down; the frame lands at `27%–74%` and `21.5%–62.9%`, deliberately **inset
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

### The scrim, and why the opening opts out

Centred and lower copy sit on a soft cream scrim so text survives the busiest
frames. It rides the copy's own opacity, which is right everywhere the copy
arrives and leaves with its scene.

The opening is the exception: its copy is held from the first pixel to the last
(`copy: [-0.05, -0.01, 1, 1]`), so the scrim never lifted — and it was still
veiling the film at 70%, exactly where the monogram finishes drawing itself. A
monogram seen through a white wash just looks dull.

So `data-scrim="own"` disables the pseudo-element and the section supplies a
`.copy__scrim` with its own `data-fade`, timed to leave with the greeting: full
at 0, gone by 0.40, **zero by the time the logo lands**. Any other scene that
holds its copy for a whole scene should do the same.

One trap: the fade driver sets `pointer-events` on everything it animates, and
this element covers the entire stage — it is pinned `none !important` so it can
never become a hit target.

### The phone, on a wide screen

A 9:16 film leaves most of a desktop empty, so the stage sits inside a **device
shell** above 861px — titanium rail, black glass bezel, Dynamic Island with its
camera dot, side buttons, and a soft reflection pooling underneath. Above 1180px
the space beside it becomes **the room**: the invitation's details set as print on
the left, an oversized monogram watermark behind, and on the right the hashtag
plus a live readout of which scene you are in.

Two things to know if you touch this:

- **`.device` is `display: contents` below 861px**, so the shell disappears from
  layout entirely and the stage is a direct child of the centring wrapper again —
  every measurement in `scroll-film.js` is unchanged. But `display: contents`
  *promotes the shell's children into that grid*, so the buttons and the island
  would become grid items in their own right and squeeze the stage into a strip
  at the bottom. They are `display: none` until the shell exists.
- **The stage's height comes from `--vph`, not `100%`.** The shell shrink-wraps
  its content, so a percentage inside it has no definite parent to resolve
  against and the whole thing collapses to zero. `measure()` publishes the
  viewport height it already computes; the stage reads that.

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

### The phone's URL bar

A phone browser shows its URL bar and tab strip on load and slides them away on
the first scroll — the visible viewport grows by roughly 80px, mid-scroll, with
no reload. Two things have to be true through that, and they pull in opposite
directions:

- **The film must fill whatever is now visible.** The canvas used to carry an
  inline pixel height set at load, so when the viewport grew it stayed short and
  left a bare cream strip along the bottom. It has no inline size now: `.film` is
  `inset: 0` on the stage, the stage is `100%` of a `position: fixed; inset: 0`
  wrapper — which *is* the visible viewport, more reliably than `dvh` — and only
  the backing store is resized in JS.
- **The reader must not be moved.** Rebuilding the scroll bands changes where
  every scene starts, which yanks the page mid-scroll. So the resize path is
  split: `measure()` (canvas + video-space anchors) runs on any resize, and the
  full `layout()` only when the width actually changes. `visualViewport`'s own
  resize/scroll events are listened to as well, because iOS does not always fire
  a plain `resize` for the bar.

Verified by growing 760px -> 850px mid-scene: the canvas follows to the pixel and
the scroll position, active scene and frame index are all unchanged.

`theme-color` is declared for both colour schemes so Safari tints its chrome to
the invitation's ivory rather than falling back to dark grey on a phone in dark
mode, and `<html>` carries the same ivory so an overscroll bounce never exposes
white.

### It behaves like a card, not a document

`user-select: none` and `-webkit-touch-callout: none` on `<html>`, so dragging
across the film never leaves a blue selection or pops a callout. **Form fields
opt back in** (`input, textarea, select`) — selection there is how you edit.

Zoom is off for the same reason: the layout is measured against a 9:16 frame and
every overlay is pinned to painted artwork, so a pinch pulls the scratch card and
the RSVP panel off their marks. iOS has ignored `user-scalable=no` since iOS 10,
so the meta tag alone does not hold — `touch-action: pan-y` drops the pinch while
keeping vertical scroll, and `interactions.js` cancels Safari's own
`gesturestart`/`gesturechange`/`gestureend` and the second tap of a double-tap.
It is a deliberate accessibility trade-off; undo it by removing that block and
`maximum-scale=1` if you would rather people could zoom.

### Two things that swallowed the swipe

Reported as "it sticks for a few seconds and won't let me scroll", and blamed on
the parallax. It was not the parallax — it was two elements claiming the gesture:

- **The scratch foil** had `touch-action: none`. It covers ~74% of the screen, so
  a swipe that began anywhere on the medallion was consumed and the page did not
  move at all. It is `pan-y` now: vertical belongs to the page, and the drag stays
  undecided until it has travelled 8px, so mostly-sideways scratches and
  mostly-vertical scrolls away.
- **The RSVP card** had `overscroll-behavior: contain` with `overflow-y: auto`.
  The card is sized to fit, so there was nothing to scroll inside it and the
  `contain` stopped the swipe chaining to the page — it went nowhere.

Both scenes hold their artwork still (`settle` below 1), so the film looked frozen
at the same moment the page stopped responding, which is why it read as one fault.

Decoded-frame memory made it worse on arrival: frames were decoded at their native
1080x1920 (8.3MB each) with a window of nine, *plus* frame 0 of all eight
sequences pinned for the whole visit — about 66MB of standing cost. Frames now
decode to the size actually drawn, the window is seven, and nothing is pinned.

### The damped playhead

Frames were indexed straight off scroll position, so a hard flick jumped the
index by dozens of frames at once and read as a cut — the camera appearing
somewhere new rather than travelling there.

`viewY` now *chases* the scroll rather than matching it, and every scene derives
from it: frame index, opacity, copy fade, parallax. A flick becomes a fast
fly-through of the actual film. The per-frame step is capped so the picture
cannot advance faster than the eye can follow, and the cap widens with distance
so a rail jump across the whole invitation still arrives promptly instead of
crawling:

| gesture | rendered frames | time @60fps | distinct film frames shown |
|---|---|---|---|
| flick one scene | 51 | 0.85s | 25 of 56 |
| flick three scenes | 87 | 1.45s | 39 |
| rail jump to the end | 137 | 2.28s | 65 |

Two details worth keeping: the loop re-reads only while the playhead is moving
(once settled it costs one subtraction per frame), and on `visibilitychange` the
playhead **snaps** to the real scroll position rather than flying through
everything the visitor scrolled past while looking elsewhere.

Tune it in `advance()`: `0.16` is the follow rate, `0.055` the floor on the
per-frame step (as a fraction of viewport height) and `0.02` how fast the cap
widens with distance. `prefers-reduced-motion` bypasses the whole thing.

### No opening auto-scroll

The film used to fly its first scene on load. It doesn't any more: the landing
screen centres "You are invited" and **Scroll to begin** in the middle of the
frame, so the first thing anyone reads is what to do. Moving the page for people
made it unclear whether anything was theirs to control. The opening hashtag is
parked at 77.5% of the picture so it lands *below* the monogram once that
finishes drawing, rather than over it.

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

### Two frame tiers

`assets/frames` is 1080x1920 (26MB); `assets/frames-720` is 720x1280 (17MB).
**Every touch device takes the light tier**, desktop takes the full one.

The reason is decode, not download. `createImageBitmap` decodes the *whole*
source image before it resizes it to the canvas, so the cost scales with source
pixels — a phone drawing into a 720-wide canvas was paying **2.25x** to produce
detail it then threw away. The canvas is capped at 2x DPR, so even the widest
phone draws into ~860px: from a 720 source that is a 1.19x upscale on a screen
held at arm's length, which is invisible. Desktop, where none of this struggled
and the picture is studied up close, keeps 1080.

`?q=lite` and `?q=hi` force a tier — the only honest way to compare them on a
real device. `saveData`, a 2G connection, or `deviceMemory <= 4` also force lite.

### Guarded style writes

The scene loop runs on every frame the playhead moves, across ten sections.
Writing opacity, transform and pointer-events unconditionally was ~40 style
mutations a frame, and on a budget phone that recalc competes with the frame
decode for the same main thread. Every write is now compared first, and opacity
is rounded to 3dp so imperceptible changes don't invalidate style at all.

## Regenerating the film

`tools/frames.sh` re-extracts every clip as a 1080x1920 WebP sequence:

```bash
./tools/frames.sh ../flowers_cloud_bird/clips          # 1080 -> assets/frames
W=720 ./tools/frames.sh ../flowers_cloud_bird/clips    # 720  -> assets/frames-720
N=72 ./tools/frames.sh ../flowers_cloud_bird/clips     # finer, proportionally more bytes
```

Regenerate **both** tiers whenever the clips change, or phones will show a stale
film.

It picks `N` frames spanning each clip's true first and last frame, so the chain
stays seam-exact whatever `N` you choose. Set the same number as `frameCount` in
`invite.config.js`. At the default 56 the whole film is **26MB** across 448
frames — less than the mobile video tier it replaced.

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

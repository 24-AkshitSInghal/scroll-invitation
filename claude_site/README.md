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

The payload is `{ name, attending, guests, message, submittedAt }`.

---

## The scenes

| # | Clip | Scene | Notes |
|---|------|-------|-------|
| 1 | c1 | Monogram opening | Greeting on landing; `#ShubhMilan` appears as the monogram finishes drawing (~88% in) |
| 2 | c2 | The couple | Names inside the floral arch |
| 3 | c3 | Families | Both sets of parents |
| 4 | c4 | Save the date | **Scratch card** — a gold-foil canvas over the medallion |
| 5 | c5 | Ceremony | Live countdown + Add to calendar (`.ics`) |
| 6 | c6 | Venue | Address + Open map |
| 7 | c7 | RSVP | **Form** on the silk panel |
| 8 | c8 | Blessings | Monogram, closing line, hashtag |

### Pacing knobs (per section, in `invite.config.js`)

- **`scroll`** — viewport-heights of scroll the scene occupies. Bigger = slower.
- **`settle`** — `0..1`. The clip reaches its **final frame** at this point in the
  band and holds there for the rest of it. This is what makes the interactive
  scenes work: scene 4 settles at `0.42` and scene 7 at `0.38`, so the medallion
  and the silk panel are locked perfectly still while someone is scratching or
  typing. Leave it at `1` for a scene that should keep moving the whole way.
- **`copy`** — `[fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd]` in local
  `0..1`. Individual elements can carry their own `data-fade="i0,i1,o0,o1"` to
  hand off within one scene (scene 1 uses this).

  A ramp that begins at `0` is still *invisible* at `0` — that's why the opening
  scene's ramps start slightly negative.

---

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

- medallion blank disc — centre `49.8% / 46.9%`, diameter `74%` of picture width
- RSVP silk panel — `18.5%–83%` across, `16.7%–81%` down

---

## Re-encoding the clips

`tools/encode.sh` regenerates everything in `assets/video` and `assets/poster`
from the source clips:

```bash
./tools/encode.sh ../flowers_cloud_bird/clips
```

Settings and why: native 1080×1920 at `crf 20` with a **small GOP (`-g 8`)**.
Seek cost is dominated by how many frames sit between the target and the previous
keyframe, so a short GOP scrubs smoothly — while all-intra would balloon an 8s
clip to ~25 MB for no visible gain, since Blob playback already guarantees
seekability. Mobile variants are 720 wide, `-g 4`, `crf 23`.

**Current weight: 61 MB desktop, 34 MB mobile** across all eight clips. Nothing
loads up front — the engine fetches only what is within ~1.5 screens of the
viewport, so landing on the page costs one clip (~5 MB on mobile). If you'd
rather trade sharpness for data, change the mobile line in `tools/encode.sh` to
`scale=640:-2` and `-crf 26` and re-run: that's about 24 MB, roughly 30% lighter.

---

## Accessibility & graceful degradation

- The scratch card has a **"Reveal the date"** button — nobody is locked behind a
  rub gesture.
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

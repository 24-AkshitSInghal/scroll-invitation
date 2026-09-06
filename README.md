# Scroll invitations — one repo, many sites

A swipe- and wheel-driven invitation where the camera flies through a
rendered world. One codebase, any number of **themes** (films) and **clients**
(people), each deployed as its own site.

```bash
node tools/build.mjs tayal     # → dist/
cd dist && python3 -m http.server 4173
```

---

## The three parts

|  | what it is | changes when |
|---|---|---|
| `engine/` | renderer, base CSS, page shell, copy blocks | you improve the product |
| `themes/` | a film: source frames, web videos, palette, anchors, pacing | you commission new artwork |
| `clients/` | names, dates, venue, phones, logo, photo, song | you sign someone |

**Onboarding a client should touch `clients/` only.** If it doesn't, that's a gap
in the theme or the blocks — fix it there, not in the engine.

```
engine/
  index.html          page shell with {{slots}}
  blocks/*.html       one copy template per kind of scene
  css/base.css        everything not theme-specific
  js/{film,scroll-film,interactions}.js
themes/<theme>/
  theme.json          palette · anchors · scene list · pacing
  frames-720/         source frames used to build the web film and posters
  video/              720p + 540p H.264 timelines used by the site
clients/<client>/
  client.json         all the words and dates
  assets/             monogram.png · couple.jpg · song.m4a + song.mp3
tools/
  frames.sh           clips → frame sequences
  timeline-video.sh   ordered frames → hardware-decodable web films
  build.mjs           engine + theme + client → dist/
```

---

## Deploying many sites from one repo

**One Vercel project per client**, all pointing at this repo, each with a
different `CLIENT` environment variable:

| setting | value |
|---|---|
| Build Command | `node tools/build.mjs $CLIENT` |
| Output Directory | `dist` |
| Install Command | *(leave empty — no dependencies)* |
| Environment Variable | `CLIENT` = `tayal` |

Then point that project at `tayal.com` or `invite.tayal.com`.

### Stop every push rebuilding every site

By default all of them watch the same repo and branch, so one client's typo fix
redeploys everybody — which gives back most of the isolation the separate
projects bought. Set, in each project:

**Settings → Git → Ignored Build Step:**

```
bash tools/should-build.sh
```

It rebuilds this client only when the push touched something the site is
actually made of — `clients/<them>/`, the theme they use, `engine/`, `tools/`,
or `vercel.json`. Another client's copy, or a theme they don't use, is skipped.

It is deliberately fail-safe: no `CLIENT`, an unreadable `client.json`, or a
shallow clone that hides the base commit all end in a build. Skipping a deploy
that was needed is much worse than running one that wasn't.

Note it reads backwards — Vercel treats **exit 1 as "build"** and exit 0 as
"skip".

### Freezing a client near their date

An engine change legitimately rebuilds everyone, and you do not want that
landing on someone the night before their wedding. Two ways to hold a site
still, in increasing order of firmness:

1. **Settings → Git → Production Branch** — point their project at a branch you
   only merge into deliberately (`live/tayal`), and `main` can move freely.
2. **Settings → Git → disconnect**, then redeploy that project by hand when you
   choose. Nothing automatic can touch it.

Either way, promote the last known-good deployment from the project's
Deployments tab if something does go out wrong — it is instant and does not need
a build.

**Why one project each rather than one project with routes.** Every client gets
their own domain, their own deploy history and their own rollback. A change you
make for one cannot take another's live invitation down on their wedding week —
which is the entire risk in this business. Routes under a shared project would
mean one deployment for everybody and a middleware layer to split domains.
Projects are free; blast radius is not.

**Bandwidth.** A visitor downloads one tier — 4.6MB on a constrained device or
8MB on a capable one — once, plus the client's music and images. Static assets
are immutable and served from Vercel's CDN.

**Repo size.** Source frames stay in the theme so films can be regenerated, but
`dist/` contains only the two MP4s and 11 stop posters—not all 448 frames.

---

## Adding a client

```bash
cp -r clients/_template clients/sharma
# fill in client.json, drop the three assets in
node tools/build.mjs sharma
```

Then a new Vercel project with `CLIENT=sharma`. That is the whole job.

---

## Adding a theme

A theme is **eight rendered clips that chain seamlessly** — each generated from
the previous one's actual last frame, so the joins are frame-identical and the
whole thing reads as one unbroken flight. That property is what the engine is
built on; a theme that doesn't have it will show cuts.

1. **Frames and web video.** Generate the 720p source frames, then encode the two
   delivery tiers:
   ```bash
   THEME=my-theme W=720 ./tools/frames.sh path/to/clips
   ./tools/timeline-video.sh my-theme
   # PATTERN='clip%d_a.mp4' if the files aren't named clipN.mp4
   ```
2. **`theme.json`.** Copy an existing one. Set the palette, then list the scenes:
   which clip each uses, which block it carries, and its pacing.
3. **Anchors — the part that cannot be guessed.** Anything sitting *on* painted
   artwork (the date button on a medallion, the RSVP card on a blank panel, the
   photograph in a wreath) is positioned as a fraction of the **picture**, and
   those fractions are specific to your clips. Build the theme, open it with
   **`?grid`**, and read them off the percentage rule laid over the film.
4. **Watch it.** Pacing copied from another theme means nothing until you move
   through it. `scroll` is the scene's virtual span, `settle` brings the camera to a stop
   (only where someone has to tap or type), `linger` slows it through the middle
   without stopping, `from`/`to` give a scene a slice of its clip.

`themes/mahal-night-wedding` is at step 3 — frames and palette in, anchors and
pacing still the defaults. Its `theme.json` lists what each of its clips shows.

### Anchors and blocks

Blocks are reusable; anchors are not. `savethedate` renders the same button and
date on any theme, but *where* that button sits is `--a-reveal-x/y/w` in the
theme. If a new theme has no medallion, either point that block at whatever it
does have, or drop the scene.

Current anchor variables: `--a-tag-y`, `--a-portrait-x/y/w`, `--a-names-y`,
`--a-reveal-x/y/w`, `--a-rsvp-y/w/h`.

---

## How the film works

Everything below is a decision that came from a real failure, not a preference.

### It is normal video, not video scrubbing

The old video implementation repeatedly set `currentTime` from scroll position.
That is random seeking, which is expensive. The later WebP/canvas implementation
avoided video seeking but replaced it with hundreds of JavaScript image decodes,
large bitmap windows and a permanent paint loop. That traded one mobile bottleneck
for another.

The current engine encodes all ordered theme frames into **one linear H.264
timeline**. Moving forward calls `video.play()` and lets the browser present the
frames at their natural 24fps cadence. JavaScript only updates text overlays when
`requestVideoFrameCallback` (or its rAF fallback) reports a presented frame. At a
stop the video pauses and JavaScript goes idle. Backward navigation performs one
short-keyframe seek under a 180ms poster fade; it never tries to play video in
reverse.

This is the important distinction: native video is the fast path; continuously
scrubbing native video is not.

### Two delivery tiers

Both files are H.264 Main Profile, level 3.1, `yuv420p`, 24fps and fast-start for
broad Safari/Chrome/Samsung compatibility. The normal tier is 720×1280 (~8MB),
and the constrained tier is 540×960 (~4.6MB). Save Data, slow connections,
4GB-or-less devices, four-core-or-less devices, or a negative Media Capabilities
result select the light tier. `?q=lite` and `?q=hi` remain manual overrides.

### The gate

The selected MP4 loads completely behind **Open Invitation**. It costs a short
wait, but removes network stalls from the story. The tap is also the user gesture
that lets music start reliably on mobile browsers.

### Stops and gestures

The page uses fixed story stops rather than binding every touchmove pixel to a
media seek. A completed vertical swipe or wheel/trackpad gesture moves exactly
one stop regardless of gesture distance; arrow keys and the rail work too. An
inertia lock prevents one strong flick from skipping several stops. No film work
runs in the browser's input-critical touchmove path.

A theme declares where the film comes to rest. Every scene contributes one stop —
the middle of its copy window — and a scene may name its own with
`"stops": [0.02, 0.96]`, which is how the opening holds twice: once on the
greeting, once on the monogram after it has drawn itself.

The engine checks `getVideoPlaybackQuality()` after transitions. If a device
still drops more than 12% of presented frames, it automatically switches the
rest of the invitation to exact static stop posters. Reduced-motion users start
in that mode. A calm, fully usable card is better degradation than repeated lag.

### Video-space coordinates

Clips are 1080×1920 drawn `cover`. On desktop the stage is itself 9:16, so a
percentage of the stage is a percentage of the picture. **On a phone it is not** —
the stage is full-bleed and taller, so the film is cropped at the sides. Anything
that must land on painted artwork is positioned against `--vx/--vy/--vw/--vh`,
which the engine recomputes on every layout. Use those, never plain percentages.

### The phone's URL bar

It can slide away and change the viewport height, sometimes with no window resize
event. The stage height comes from `--vph`, published by `measure()` from
`visualViewport`. Those events are coalesced into a single animation-frame
measurement; there is no permanent render loop.

### Things that quietly swallowed the scroll

Both cost real usability before they were found, and both are easy to reintroduce:

- The scratch canvas had `touch-action: none` and covered ~74% of the screen, so
  a swipe starting on it could not scroll the page. It is a **button** now.
- The RSVP card had `overscroll-behavior: contain` with nothing to scroll inside
  it, so swipes over the form went nowhere.
- Swipes beginning on a real input, button or link are intentionally left to that
  control. Everywhere else, the direction is interpreted after touchend.

Three times the failure was an overlay quietly claiming the middle of the screen.
Named controls in a bar of their own end the whole category.

### It behaves like a card

`user-select: none`, no callout, no zoom. iOS has ignored `user-scalable=no`
since iOS 10, so `touch-action: pan-y` plus cancelling Safari's `gesture*` events
is what actually holds. Form fields opt back in. It is a deliberate accessibility
trade-off — every overlay is pinned to artwork and a pinch pulls them off — and
undoing it is one CSS block plus `maximum-scale`.

### On a wide screen

Above 861px the stage sits in a device shell; above 1180px the space beside it
becomes the room: the details as print, a monogram watermark, a live scene
readout. `.device` is `display: contents` below 861px — but that *promotes its
children into the centring grid*, so the buttons and island are `display: none`
until the shell exists, or they become grid items and squeeze the stage into a
strip.

---

## Regenerating a film

```bash
THEME=<theme> W=720 ./tools/frames.sh <clips-dir>
./tools/timeline-video.sh <theme>
```

The timeline tool produces both browser delivery tiers. `frameCount` in
`theme.json` must match the frames per clip. The build copies the videos and only
the exact stills needed at story stops.

## The shareable video

```bash
tools/.venv/bin/python tools/video.py tayal      # → dist-video/tayal-invitation.mp4
```

One MP4 of the same film with the same words, for WhatsApp. It reads the same
`client.json` and `theme.json` as the site — nothing is written twice — and takes
about six minutes.

**The two interactive things become the reason to open the site.** The date is
simply shown revealed rather than behind a button, and the RSVP panel becomes a
card that says *RSVP on the invitation* with the client's `url`. The video is the
thing that travels; the site is where anyone actually replies. Set `url` in
`client.json` or that call to action renders blank.

Three things this had to solve, all worth knowing before editing it:

- **Scroll can hold; video cannot.** A scene with `settle` below 1 reaches its
  last frame early and then waits, motionless, for as long as someone keeps
  scrolling. A clip just ends. Played straight, the date card flashed over a
  medallion that had not finished forming, and the photograph — which owns only
  the last quarter of its clip — got a window too short to read and was dropped
  entirely. Clips carrying a scene that needs dwell are extended with a freeze of
  their final frame, and those overlays are placed inside it.
- **Overlays are drawn with Pillow, not ffmpeg's `drawtext`.** The design leans
  on heavy letter-spacing and `drawtext` cannot do tracking at all. Each overlay
  is composed to a transparent 1080×1920 PNG; ffmpeg only fades and composites.
- **A still PNG has no timeline.** Passed to ffmpeg plainly it is one frame at
  t=0, the fades have nothing to run along, and no text appears — which looks
  exactly like the overlays were forgotten. Each is `-loop`ed to the film's
  length.

`TARGET_MB` (default 15) sizes the encode so WhatsApp passes it through instead
of re-compressing it. `TARGET_MB=0` gives a full-quality master for anything else.

Fonts live in `engine/fonts/` and Pillow in `tools/.venv` (`python3 -m venv
tools/.venv && tools/.venv/bin/pip install Pillow`).

## Turning on RSVP

`rsvp.endpoint` in `client.json`. Until it is set the form still validates,
confirms and keeps every response in the visitor's `localStorage`, so nothing is
silently lost. Payload: `{ name, attending, message, submittedAt }`.

## Accessibility

The date has a button, not a rub gesture. `prefers-reduced-motion` drops the
damping and the drifting petals. The rail is real focusable buttons. Phone
numbers are `tel:` links.

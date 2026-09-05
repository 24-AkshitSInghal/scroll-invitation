# Scroll invitations — one repo, many sites

A scroll-driven invitation where the camera flies through a rendered world as you
scroll. One codebase, any number of **themes** (films) and **clients** (people),
each deployed as its own site.

```bash
node tools/build.mjs tayal     # → dist/
cd dist && python3 -m http.server 4173
```

---

## The three parts

|  | what it is | changes when |
|---|---|---|
| `engine/` | renderer, base CSS, page shell, copy blocks | you improve the product |
| `themes/` | a film: frame sequences, palette, anchors, pacing | you commission new artwork |
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
  frames/             1080×1920 WebP, 56 per clip
  frames-720/         720×1280, what every phone actually gets
clients/<client>/
  client.json         all the words and dates
  assets/             monogram.png · couple.jpg · song.m4a + song.mp3
tools/
  frames.sh           clips → frame sequences
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

**Bandwidth.** A visitor downloads one tier — ~17MB on a phone, ~26MB on desktop
— once, then it is `immutable` for a year. Vercel's free 100GB/month is roughly
6,000 phone visits across all projects combined. A wedding is a few hundred.

**Repo size.** Each theme is ~45MB of frames across both tiers, committed. That
is fine for a handful of themes. Past roughly ten, move `themes/*/frames*` to Git
LFS or to a bucket that `build.mjs` pulls from — the build already treats frames
as a copy step, so that swap is local to one function.

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

1. **Frames.** Both tiers, always:
   ```bash
   THEME=my-theme ./tools/frames.sh path/to/clips
   THEME=my-theme W=720 ./tools/frames.sh path/to/clips
   # PATTERN='clip%d_a.mp4' if the files aren't named clipN.mp4
   ```
2. **`theme.json`.** Copy an existing one. Set the palette, then list the scenes:
   which clip each uses, which block it carries, and its pacing.
3. **Anchors — the part that cannot be guessed.** Anything sitting *on* painted
   artwork (the date button on a medallion, the RSVP card on a blank panel, the
   photograph in a wreath) is positioned as a fraction of the **picture**, and
   those fractions are specific to your clips. Build the theme, open it with
   **`?grid`**, and read them off the percentage rule laid over the film.
4. **Watch it.** Pacing copied from another theme means nothing until you scroll
   it. `scroll` is how long a scene lasts, `settle` brings the camera to a stop
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

### It is frames, not video

Earlier builds scrubbed `<video>` by setting `currentTime`. On a desktop that is
fine. On an iPhone it ran to about clip 4 and stopped: scrubbing asks a decoder
to do the thing it is worst at — decode at an arbitrary point in a dependency
chain, thousands of times — and decoders are a limited system resource. A scene
whose decoder never came up sat on a still for the rest of the visit, and there
was no recovering it.

So scroll picks an array index instead. **56 WebP frames per clip; 26MB for a
whole film**, less than the mobile video tier it replaced. No seeking, no decoder,
no codec state that can be wrong. The first and last frame of every sequence are
the clip's true first and last, so the chain stays seam-exact.

Decoding all 448 frames would be 3.7GB, so `film.js` never does: frames are held
as compressed Blobs, only a window around the playhead is decoded via
`createImageBitmap` (off the main thread), and bitmaps outside the window are
closed. If the exact frame isn't ready the renderer draws the nearest one that
is — a fast flick degrades to a slightly stale frame, never a stall.

### Two tiers, and why

`frames-720` exists because **decode cost scales with source pixels, not with the
size you draw at** — `createImageBitmap` decodes the whole 1080 image before
resizing it. A phone drawing into a 720-wide canvas was paying 2.25× for detail
it then threw away. Every touch device takes the light tier; desktop keeps 1080.
`?q=lite` / `?q=hi` force either, which is the only honest way to compare on a
real device.

### The gate

Everything loads behind **Open Invitation**. It costs a wait, but it is the only
way to promise the scroll never stutters — and the tap is a real user gesture,
which is also the one moment iOS will reliably let the music start.

### The damped playhead

Frames indexed straight off scroll meant a hard flick jumped dozens of frames and
read as a cut. `viewY` chases the scroll rather than matching it, and every scene
derives from it, so a flick becomes a fast fly-through of the actual film. The
per-frame step is capped, and the cap widens with distance so a rail jump still
arrives promptly. Tune it in `advance()`.

### Video-space coordinates

Clips are 1080×1920 drawn `cover`. On desktop the stage is itself 9:16, so a
percentage of the stage is a percentage of the picture. **On a phone it is not** —
the stage is full-bleed and taller, so the film is cropped at the sides. Anything
that must land on painted artwork is positioned against `--vx/--vy/--vw/--vh`,
which the engine recomputes on every layout. Use those, never plain percentages.

### The phone's URL bar

It slides away on first scroll and the viewport grows ~80px mid-scroll, sometimes
with no resize event at all. The stage height comes from `--vph`, published by
`measure()` from `visualViewport`, and the render loop re-measures whenever the
height changes — so the canvas can never fall out of step. `measure()` runs on
any resize; the full `layout()` that rebuilds scroll bands only on a width change,
because rebuilding bands mid-scroll yanks the reader's position.

### Things that quietly swallowed the scroll

Both cost real usability before they were found, and both are easy to reintroduce:

- The scratch canvas had `touch-action: none` and covered ~74% of the screen, so
  a swipe starting on it could not scroll the page. It is a **button** now.
- The RSVP card had `overscroll-behavior: contain` with nothing to scroll inside
  it, so swipes over the form went nowhere.

**Anything overlaying the film must either let vertical gestures through or be
small.**

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
THEME=<theme> ./tools/frames.sh <clips-dir>          # 1080
THEME=<theme> W=720 ./tools/frames.sh <clips-dir>    # 720
N=72 THEME=<theme> ./tools/frames.sh <clips-dir>     # finer, more bytes
```

Both tiers, every time, or phones will show a stale film. `N` frames span each
clip's true first and last frame whatever you choose, so the chain stays
seam-exact — set the same number as `frameCount` in `theme.json`.

## Turning on RSVP

`rsvp.endpoint` in `client.json`. Until it is set the form still validates,
confirms and keeps every response in the visitor's `localStorage`, so nothing is
silently lost. Payload: `{ name, attending, message, submittedAt }`.

## Accessibility

The date has a button, not a rub gesture. `prefers-reduced-motion` drops the
damping and the drifting petals. The rail is real focusable buttons. Phone
numbers are `tel:` links.

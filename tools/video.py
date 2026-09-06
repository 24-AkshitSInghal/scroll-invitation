#!/usr/bin/env python3
"""
video.py — render a client's invitation as one shareable MP4.

    tools/.venv/bin/python tools/video.py tayal

The site is the product; this is the thing that travels. It plays the same film
with the same words, and where the site is interactive it does the honest thing
instead: the date is simply shown revealed, and the RSVP panel becomes a card
pointing at the real invitation, which is where anyone can actually reply.

Why the overlays are drawn here rather than screenshotted from the page: the
design leans on heavy letter-spacing, which ffmpeg's drawtext cannot do at all.
Pillow can, so each overlay is composed to a transparent PNG at full 1080x1920
and handed to ffmpeg purely to fade and composite.

It reads the same client.json and theme.json as the website — nothing about the
invitation is written twice.
"""

import json, os, re, subprocess, sys, textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "engine" / "fonts"


def die(msg):
    print("✗ " + msg, file=sys.stderr)
    sys.exit(1)


def sh(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        die("ffmpeg failed\n" + (r.stderr[-1500:] or r.stdout[-1500:]))
    return r.stdout


# ── inputs ────────────────────────────────────────────────────────────────────
client_name = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("CLIENT")
if not client_name:
    die("usage: tools/.venv/bin/python tools/video.py <client>")

cdir = ROOT / "clients" / client_name
if not (cdir / "client.json").exists():
    die(f"no clients/{client_name}/client.json")
client = json.loads((cdir / "client.json").read_text())

tdir = ROOT / "themes" / client["theme"]
# "//"-prefixed keys are just documentation living in valid JSON — no stripping needed
theme = json.loads((tdir / "theme.json").read_text())
clips_dir = Path(client.get("videoClips") or theme.get("clips") or "")
if not clips_dir.is_absolute():
    clips_dir = ROOT / clips_dir
if not clips_dir.is_dir():
    die(f'no source clips. Add "clips": "<path>" to {client["theme"]}/theme.json '
        f'(relative to the repo root) — the video is built from the original '
        f'footage, not the frame sequences, so the motion stays at full frame rate.')

W, H = 1080, 1920
pal = theme["palette"]
strip = lambda s: re.sub(r"<[^>]+>", "\n", s).replace("&amp;", "&").replace("&rsquo;", "’").strip()


def hexc(key, fallback="#000000"):
    return pal.get(key, fallback)


def font(name, size):
    f = FONTS / name
    if not f.exists():
        die(f"missing font {f} — see tools/video.py header")
    return ImageFont.truetype(str(f), size)


# ── text drawing ──────────────────────────────────────────────────────────────
def tracked(draw, xy, text, fnt, fill, spacing=0, anchor_x="center", shadow=None):
    """Draw one line with letter-spacing. Pillow has no tracking, so step glyphs
    by hand — the design's small caps are unreadable without it."""
    widths = [draw.textlength(ch, font=fnt) for ch in text]
    total = sum(widths) + spacing * max(0, len(text) - 1)
    x = xy[0] - total / 2 if anchor_x == "center" else xy[0]
    for dx, dy, col in (shadow or []):
        cx = x
        for ch, w in zip(text, widths):
            draw.text((cx + dx, xy[1] + dy), ch, font=fnt, fill=col, anchor="lm")
            cx += w + spacing
    cx = x
    for ch, w in zip(text, widths):
        draw.text((cx, xy[1]), ch, font=fnt, fill=fill, anchor="lm")
        cx += w + spacing
    return total


HALO = [(0, 2, (255, 250, 242, 210)), (0, -2, (255, 250, 242, 150)),
        (2, 0, (255, 250, 242, 150)), (-2, 0, (255, 250, 242, 150))]


def scrim(img, kind, strength=None):
    """The same soft cream wash the site puts behind copy. Built as a small
    gradient and scaled up rather than stroked as rings — stacking hundreds of
    low-alpha ellipses gave a faint, banded result that left text barely
    readable over bright cloud, which is most of this film."""
    sw, sh_ = 72, 128
    peak = strength if strength is not None else (0.88 if kind == "center" else 0.95)
    small = Image.new("L", (sw, sh_), 0)
    px = small.load()
    for y in range(sh_):
        for x in range(sw):
            if kind == "center":
                dx = (x - sw / 2) / (sw / 2)
                dy = (y - sh_ / 2) / (sh_ / 2) * 1.55
                d = min(1.0, (dx * dx + dy * dy) ** 0.5)
                a_ = (1.0 - d) ** 1.45
            else:
                t = max(0.0, (y - sh_ * 0.40) / (sh_ * 0.60))
                a_ = min(1.0, t) ** 1.15
            px[x, y] = int(255 * a_ * peak)
    layer = Image.new("RGBA", (W, H), (255, 250, 242, 255))
    layer.putalpha(small.resize((W, H), Image.LANCZOS))
    return Image.alpha_composite(img, layer)


def fit(d, text, name, size, max_frac=0.88, spacing=0, floor=24):
    """Shrink until the line fits the frame. Names, venues and URLs all vary per
    client, and a 1080px frame does not forgive an overflow."""
    while size > floor:
        f = font(name, size)
        w = sum(d.textlength(c, font=f) for c in text) + spacing * max(0, len(text) - 1)
        if w <= W * max_frac:
            return f
        size -= 2
    return font(name, floor)


def rule(d, cy, width=150, col=None):
    col = col or hexc("--gold-soft", "#d9bd85")
    d.line([(W / 2 - width / 2, cy), (W / 2 + width / 2, cy)], fill=col, width=2)


# ── the overlays, in order ────────────────────────────────────────────────────
def blank():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def ov_open():
    img = scrim(blank(), "center")
    d = ImageDraw.Draw(img)
    eb = client["open"]["eyebrow"].upper()
    tracked(d, (W / 2, H * 0.50), eb, fit(d, eb, "Jost.ttf", 34, 0.62, 15),
            hexc("--gold-deep"), spacing=15, shadow=HALO)
    rule(d, H * 0.525)
    d.text((W / 2, H * 0.565), strip(client["open"]["lede"]), font=font("Jost.ttf", 44),
           fill=hexc("--ink-soft"), anchor="mm")
    return img


def ov_tag():
    img = blank()
    d = ImageDraw.Draw(img)
    tag = "#" + client["hashtag"]
    f = font("PlayfairDisplay-Italic.ttf", 132)
    w = d.textlength(tag, font=f)
    d.text((W / 2 - w / 2, H * 0.775), "#", font=f, fill=hexc("--tag-hash", "#a8842f"), anchor="lm")
    d.text((W / 2 - w / 2 + d.textlength("#", font=f), H * 0.775), client["hashtag"],
           font=f, fill=hexc("--tag-ink", "#7d2340"), anchor="lm")
    return img


def ov_couple():
    img = scrim(blank(), "center")
    d = ImageDraw.Draw(img)
    eb = strip(client["coupleBlock"]["eyebrow"]).upper()
    tracked(d, (W / 2, H * 0.40), eb, fit(d, eb, "Jost.ttf", 30, 0.68, 13),
            hexc("--gold-deep"), spacing=13, shadow=HALO)
    size = 104
    longest = max(client["couple"]["groom"], client["couple"]["bride"], key=len)
    while size > 52 and d.textlength(longest, font=font("CormorantGaramond-Italic.ttf", size)) > W * 0.88:
        size -= 4
    fi = font("CormorantGaramond-Italic.ttf", size)
    d.text((W / 2, H * 0.455), client["couple"]["groom"], font=fi, fill=hexc("--ink"), anchor="mm")
    d.text((W / 2, H * 0.505), "&", font=font("CormorantGaramond-Italic.ttf", 66),
           fill=hexc("--gold"), anchor="mm")
    d.text((W / 2, H * 0.555), client["couple"]["bride"], font=fi, fill=hexc("--ink"), anchor="mm")
    d.text((W / 2, H * 0.615), strip(client["coupleBlock"]["lede"]), font=font("Jost.ttf", 40),
           fill=hexc("--ink-soft"), anchor="mm")
    return img


def ov_portrait():
    """The photograph, arch-topped, on the theme's portrait anchor."""
    img = blank()
    src = cdir / "assets" / client["photo"]["src"]
    if not src.exists():
        return img
    a = theme["anchors"]
    pw = int(a["--a-portrait-w"] * W)
    ph = int(pw * client["photo"]["height"] / client["photo"]["width"])
    photo = Image.open(src).convert("RGBA").resize((pw, ph), Image.LANCZOS)

    mask = Image.new("L", (pw, ph), 0)
    md = ImageDraw.Draw(mask)
    r = pw // 2
    md.rounded_rectangle([0, 0, pw, ph], radius=18, fill=255)
    md.pieslice([0, 0, pw, 2 * r], 180, 360, fill=255)
    md.rectangle([0, r, pw, ph], fill=255)

    cx, cy = int(a["--a-portrait-x"] * W), int(a["--a-portrait-y"] * H)
    box = (cx - pw // 2, cy - ph // 2)
    mat = Image.new("RGBA", (pw + 22, ph + 22), (255, 250, 242, 235))
    mm = Image.new("L", (pw + 22, ph + 22), 0)
    ImageDraw.Draw(mm).rounded_rectangle([0, 0, pw + 21, ph + 21], radius=r + 11, fill=255)
    img.paste(mat, (box[0] - 11, box[1] - 11), mm)
    img.paste(photo, box, mask)

    d = ImageDraw.Draw(img)
    names = f'{client["couple"]["groomShort"]}  &  {client["couple"]["brideShort"]}'
    d.text((W / 2, a["--a-names-y"] * H), names,
           font=font("CormorantGaramond-Italic.ttf", 74), fill=hexc("--ink"), anchor="mm")
    return img


def ov_family():
    img = scrim(blank(), "center")
    d = ImageDraw.Draw(img)
    f = client["family"]
    eb = strip(f["eyebrow"]).upper()
    tracked(d, (W / 2, H * 0.375), eb, fit(d, eb, "Jost.ttf", 28, 0.74, 11),
            hexc("--gold-deep"), spacing=11, shadow=HALO)
    y = H * 0.445
    for role, names in ((f["groomRole"], f["groomParents"]), (f["brideRole"], f["brideParents"])):
        tracked(d, (W / 2, y), role.upper(), font("Jost.ttf", 26), hexc("--gold-deep"), spacing=10)
        y += 62
        for line in strip(names).split("\n"):
            d.text((W / 2, y), line.strip(), font=font("CormorantGaramond.ttf", 62),
                   fill=hexc("--ink"), anchor="mm")
            y += 74
        y += 34
        if role == f["groomRole"]:
            rule(d, y - 60, 2)
    return img


def ov_date():
    """On the site this is behind a button. In a video there is nothing to press,
    so it is simply shown."""
    img = blank()
    d = ImageDraw.Draw(img)
    a = theme["anchors"]
    cy = a["--a-reveal-y"] * H
    e = client["event"]
    tracked(d, (W / 2, cy - 175), e["saveLabel"].upper(), font("Jost.ttf", 32),
            hexc("--gold-deep"), spacing=16)
    big, rest = e["dateBig"], strip(e["dateStacked"]).split("\n")
    fb = font("CormorantGaramond-Italic.ttf", 168)
    fr = font("CormorantGaramond-Italic.ttf", 124)
    wb, wr = d.textlength(big + " ", font=fb), d.textlength(rest[0], font=fr)
    x0 = W / 2 - (wb + wr) / 2
    d.text((x0, cy - 40), big, font=fb, fill="#47281f", anchor="lm")
    d.text((x0 + wb, cy - 40), rest[0], font=fr, fill="#47281f", anchor="lm")
    if len(rest) > 1:
        d.text((W / 2, cy + 75), rest[1], font=fr, fill="#47281f", anchor="mm")
    tracked(d, (W / 2, cy + 175), e["weekday"].upper(), font("Jost.ttf", 30),
            hexc("--gold-deep"), spacing=13)
    return img


def ov_ceremony():
    img = scrim(blank(), "center")
    d = ImageDraw.Draw(img)
    e = client["event"]
    nm = strip(e["name"]).upper()
    tracked(d, (W / 2, H * 0.415), nm, fit(d, nm, "Jost.ttf", 30, 0.70, 13),
            hexc("--gold-deep"), spacing=13, shadow=HALO)
    fb = font("CormorantGaramond-Italic.ttf", 118)
    line = f'{e["dateBig"]} {e["dateRest"]}'
    d.text((W / 2, H * 0.478), line, font=fb, fill=hexc("--ink"), anchor="mm")
    tracked(d, (W / 2, H * 0.535), e["time"].upper(), font("Jost.ttf", 34),
            hexc("--ink"), spacing=8)
    return img


def ov_venue():
    img = scrim(blank(), "lower")
    d = ImageDraw.Draw(img)
    v = client["venue"]
    tracked(d, (W / 2, H * 0.665), v["eyebrow"].upper(), font("Jost.ttf", 30),
            hexc("--gold-deep"), spacing=15, shadow=HALO)
    d.text((W / 2, H * 0.725), v["name"],
           font=fit(d, v["name"], "CormorantGaramond-Italic.ttf", 104),
           fill=hexc("--ink"), anchor="mm")
    y = H * 0.785
    for line in strip(v["address"]).split("\n"):
        d.text((W / 2, y), line.strip(), font=font("Jost.ttf", 40),
               fill=hexc("--ink-soft"), anchor="mm")
        y += 58
    return img


def ov_rsvp(url):
    """The one place the video cannot do what the site does. Rather than fake a
    form, it says where the real one is."""
    img = scrim(blank(), "center")
    d = ImageDraw.Draw(img)
    r = client["rsvp"]
    d.text((W / 2, H * 0.415), strip(r["title"]), font=font("CormorantGaramond-Italic.ttf", 100),
           fill=hexc("--ink"), anchor="mm")
    dl = strip(r["deadline"]).upper()
    tracked(d, (W / 2, H * 0.472), dl, fit(d, dl, "Jost.ttf", 28, 0.72, 11),
            hexc("--gold-deep"), spacing=11)
    rule(d, H * 0.512)
    tracked(d, (W / 2, H * 0.552), "RSVP ON THE INVITATION",
            fit(d, "RSVP ON THE INVITATION", "Jost.ttf", 30, 0.68, 12),
            hexc("--ink-soft"), spacing=12)
    if url:
        d.text((W / 2, H * 0.605), url, font=font("Jost.ttf", 42),
               fill=hexc("--magenta"), anchor="mm")
    return img


def ov_finale():
    img = scrim(blank(), "center")
    d = ImageDraw.Draw(img)
    for i, line in enumerate(strip(client["finale"]["line"]).split("\n")):
        d.text((W / 2, H * 0.395 + i * 56), line.strip(), font=font("Jost.ttf", 42),
               fill=hexc("--ink-soft"), anchor="mm")
    pair = client["couple"]["shortPair"]
    size = 96
    while size > 48 and d.textlength(pair, font=font("CormorantGaramond-Italic.ttf", size)) > W * 0.88:
        size -= 4          # long names must not run off a 1080px frame
    d.text((W / 2, H * 0.505), pair, font=font("CormorantGaramond-Italic.ttf", size),
           fill=hexc("--ink"), anchor="mm")
    tag = "#" + client["hashtag"]
    f = font("PlayfairDisplay-Italic.ttf", 92)
    w = d.textlength(tag, font=f)
    d.text((W / 2 - w / 2, H * 0.575), "#", font=f, fill=hexc("--tag-hash", "#a8842f"), anchor="lm")
    d.text((W / 2 - w / 2 + d.textlength("#", font=f), H * 0.575), client["hashtag"],
           font=f, fill=hexc("--tag-ink", "#7d2340"), anchor="lm")
    return img


def ov_hosts(url):
    img = scrim(blank(), "center")
    d = ImageDraw.Draw(img)
    h = client["hosts"]
    d.text((W / 2, H * 0.40), strip(h["line"]), font=font("CormorantGaramond-Italic.ttf", 76),
           fill=hexc("--ink"), anchor="mm")
    rule(d, H * 0.445)
    eb = strip(h["eyebrow"]).upper()
    tracked(d, (W / 2, H * 0.485), eb, fit(d, eb, "Jost.ttf", 28, 0.66, 13),
            hexc("--gold-deep"), spacing=13)
    d.text((W / 2, H * 0.535), h["family"],
           font=fit(d, h["family"], "CormorantGaramond-Italic.ttf", 96),
           fill=hexc("--ink"), anchor="mm")
    nums = "   ·   ".join(p["display"] for p in h.get("phones", []))
    if nums:
        tracked(d, (W / 2, H * 0.595), nums, font("Jost.ttf", 40), hexc("--ink-soft"), spacing=3)
    if url:
        rule(d, H * 0.632)
        u = url.upper()
        tracked(d, (W / 2, H * 0.668), u, fit(d, u, "Jost.ttf", 32, 0.62, 6),
                hexc("--magenta"), spacing=6)
    return img


# ── timeline ──────────────────────────────────────────────────────────────────
def probe(p):
    return float(sh(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                     "-of", "csv=p=0", str(p)]).strip())


clips = sorted(clips_dir.glob("*.mp4"), key=lambda p: int(re.search(r"(\d+)", p.stem).group(1)))
if len(clips) < 8:
    die(f"expected 8 clips in {clips_dir}, found {len(clips)}")
durs = [probe(c) for c in clips]

url = client.get("url", "")

"""Scroll and video disagree about time, and this is where that has to be
resolved.

On the site a scene with `settle` below 1 reaches its final frame early and then
holds it, motionless, for as long as the reader keeps scrolling — which is how
the medallion and the RSVP panel stay still under a finger. Linear video has no
such luxury: the clip simply ends. Played straight, the date card flashed up over
a medallion that had not finished forming, and the photograph — which owns only
the last quarter of its clip — got a window too short to read and was dropped
altogether.

So clips that carry a scene needing dwell are extended with a freeze of their
last frame, and those overlays are placed inside that freeze. It is the video's
equivalent of stopping to look."""

DWELL = {"savethedate", "rsvp", "portrait", "hosts", "finale"}
HOLD_LONG, HOLD_SHORT = 3.0, 1.2

hold = [0.0] * len(clips)
for sc in theme["scenes"]:
    ci = int(re.sub(r"\D", "", sc["clip"])) - 1
    if ci < len(clips) and (sc.get("settle", 1) < 1 or sc["block"] in DWELL):
        hold[ci] = max(hold[ci], HOLD_LONG if sc.get("settle", 1) < 1 else HOLD_SHORT)

starts, t = [], 0.0
for i, c in enumerate(clips):
    starts.append(t)
    t += durs[i] + hold[i]
total = t

work = ROOT / ".video-work"
work.mkdir(exist_ok=True)
for f in work.glob("*"):
    f.unlink()

# each clip, with its freeze if it has one, then concatenated
segs = []
for i, c in enumerate(clips):
    seg = work / f"seg{i:02d}.mp4"
    vf = "fps=24"
    if hold[i] > 0:
        vf += f",tpad=stop_mode=clone:stop_duration={hold[i]}"
    sh(["ffmpeg", "-y", "-loglevel", "error", "-i", str(c), "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-an", str(seg)])
    segs.append(seg)

lst = work / "clips.txt"
lst.write_text("".join(f"file '{s.resolve()}'\n" for s in segs))
base = work / "base.mp4"
sh(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
    "-c", "copy", str(base)])

OVERLAY = {
    "couple": ov_couple, "portrait": ov_portrait, "family": ov_family,
    "savethedate": ov_date, "ceremony": ov_ceremony, "venue": ov_venue,
    "finale": ov_finale,
}

plan = []
for sc in theme["scenes"]:
    ci = int(re.sub(r"\D", "", sc["clip"])) - 1
    if ci >= len(clips):
        continue
    dur, hld, cs = durs[ci], hold[ci], starts[ci]
    a0, a1 = sc.get("from", 0.0), sc.get("to", 1.0)
    # the moving part of this scene, in video time
    m0, m1 = cs + dur * a0, cs + dur * a1
    last_on_clip = a1 >= 0.999

    if sc.get("settle", 1) < 1 or (sc["block"] in DWELL and last_on_clip):
        # show it once the picture has come to rest, and hold it through the freeze
        t0 = m1 - 0.8
        t1 = cs + dur + hld - 0.35
    else:
        span = m1 - m0
        t0 = m0 + span * 0.28
        t1 = m1 - min(0.6, span * 0.12)

    block = sc["block"]
    if block == "open":
        t0 = m0 + 1.0
        mid = m0 + (m1 - m0) * 0.55
        plan.append((ov_open(), t0, mid))
        plan.append((ov_tag(), m1 - 3.4, cs + dur + hld - 0.3))
    elif block == "rsvp":
        plan.append((ov_rsvp(url), t0, t1))
    elif block == "hosts":
        plan.append((ov_hosts(url), t0, min(t1, total) - 0.2))
    elif block in OVERLAY:
        plan.append((OVERLAY[block](), t0, t1))

plan = [(img, x, y) for img, x, y in plan if y > x + 0.8]

FADE = 0.7
inputs, filters, last = ["-i", str(base)], [], "0:v"
for i, (img, t0, t1) in enumerate(plan):
    p = work / f"ov{i:02d}.png"
    img.save(p)
    # -loop gives the still a timeline. Without it a PNG is a single frame at
    # t=0, the fades have nothing to run along, and the overlay never appears —
    # which looked exactly like the text had been forgotten.
    inputs += ["-loop", "1", "-framerate", "24", "-t", f"{total:.2f}", "-i", str(p)]
    n = i + 1
    filters.append(
        f"[{n}:v]format=rgba,"
        f"fade=t=in:st={t0:.2f}:d={FADE}:alpha=1,"
        f"fade=t=out:st={max(t0, t1 - FADE):.2f}:d={FADE}:alpha=1[o{n}];"
        f"[{last}][o{n}]overlay=0:0:enable='between(t,{max(0, t0 - FADE):.2f},{t1 + FADE:.2f})'[v{n}]"
    )
    last = f"v{n}"

audio, amap = [], []
song = cdir / "assets" / f'{client.get("music", {}).get("file", "song")}.m4a'
if song.exists():
    inputs += ["-i", str(song)]
    ai = len(plan) + 1
    filters.append(f"[{ai}:a]atrim=0:{total:.2f},afade=t=in:st=0:d=1.5,"
                   f"afade=t=out:st={total - 2.5:.2f}:d=2.5,volume=0.85[a]")
    amap = ["-map", "[a]", "-c:a", "aac", "-b:a", "128k"]

out = ROOT / "dist-video"
out.mkdir(exist_ok=True)
mp4 = out / f"{client_name}-invitation.mp4"

# Aim at a size WhatsApp will pass through rather than re-compress. Left to a
# plain CRF this lands near 29MB, and WhatsApp then crushes it to something far
# worse than encoding for the budget ourselves. TARGET_MB=0 disables the cap.
target_mb = float(os.environ.get("TARGET_MB", 15))
if target_mb > 0:
    kbps = int((target_mb * 8192) / total) - 128        # leave room for audio
    rate = ["-b:v", f"{kbps}k", "-maxrate", f"{int(kbps * 1.45)}k",
            "-bufsize", f"{int(kbps * 2.5)}k"]
else:
    rate = ["-crf", "21"]

sh(["ffmpeg", "-y", "-loglevel", "error", *inputs,
    "-filter_complex", ";".join(filters),
    "-map", f"[{last}]", *amap,
    "-c:v", "libx264", "-preset", "slow", *rate, "-pix_fmt", "yuv420p",
    "-profile:v", "high", "-level", "4.0", "-movflags", "+faststart",
    "-r", "24", "-shortest", str(mp4)])

mb = mp4.stat().st_size / 1048576
print(f"✓ {mp4.relative_to(ROOT)}")
print(f"  {total:.0f}s · 1080x1920 · {mb:.1f} MB")
if mb > 16:
    print("  ! over ~16MB — WhatsApp will re-compress it. Lower TARGET_MB.")
else:
    print("  fits WhatsApp without re-compression · TARGET_MB=0 for a full-quality master")

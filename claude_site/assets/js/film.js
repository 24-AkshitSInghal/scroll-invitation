/* ============================================================================
   film.js — the frame store and canvas renderer
   ----------------------------------------------------------------------------
   The film used to be eight <video> elements scrubbed by setting currentTime.
   That works on a desktop and is genuinely unreliable on a phone: seeking means
   decoding at an arbitrary point in a codec's dependency chain, video decoders
   are a limited system resource, and a scene whose decoder never came up was
   stranded on a still image for the rest of the visit.

   So there is no video here at all. Each clip is a sequence of 1080x1920 WebP
   frames and scroll position picks an array index. No seeking, no decoder
   limits, no codec state to go wrong — and the first and last frame of every
   sequence are the clip's true first and last, so the chain stays seam-exact.

   The two costs that replaces are download and decode, and both are managed:

   · Frames are fetched as Blobs and held compressed (~34MB for the whole film).
     Decoding all of them would be 3.7GB, so we never do.
   · Only a small window around the playhead is decoded, via createImageBitmap —
     which decodes off the main thread — and bitmaps outside the window are
     closed. If the exact frame isn't ready yet the renderer draws the nearest
     one that is, so a fast flick degrades to a slightly stale frame instead of
     a stall.

   Everything paints into ONE canvas. Ten stacked full-screen layers was work the
   compositor did on every frame; here a crossfade is just two drawImage calls.
   ========================================================================== */

window.Film = (function () {
  'use strict';

  const DECODE_AHEAD = 3;    // frames kept decoded either side of the playhead

  /* Decode to the size actually being drawn, not the file's native 1080x1920.
     A native bitmap is 8.3MB; at a phone's real backing-store size it is nearer
     5MB, and with two scenes' windows alive at a seam that difference is tens of
     megabytes of pressure — which a phone answers with the pauses that read as
     the page freezing on arrival. Set by the renderer whenever it resizes. */
  let decodeW = 0, decodeH = 0;
  const FETCH_PARALLEL = 6;  // concurrent frame requests

  function Sequence(dir, count) {
    this.dir = dir;
    this.count = count;
    this.blobs = new Array(count);
    this.bitmaps = new Array(count);
    this.pending = new Array(count);
    this.loaded = 0;
  }

  Sequence.prototype.url = function (i) {
    return this.dir + '/' + String(i + 1).padStart(3, '0') + '.webp';
  };

  /* Fetch every frame of this sequence, a few at a time. Resolves when the last
     one lands; `onOne` ticks the loading bar. */
  Sequence.prototype.fetchAll = function (onOne) {
    const self = this;
    let next = 0;
    function one() {
      const i = next++;
      if (i >= self.count) return Promise.resolve();
      return fetch(self.url(i))
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status))))
        .then((b) => { self.blobs[i] = b; self.loaded++; if (onOne) onOne(); })
        .catch(() => { self.loaded++; if (onOne) onOne(); })   // a gap is survivable
        .then(one);
    }
    const runners = [];
    for (let k = 0; k < FETCH_PARALLEL; k++) runners.push(one());
    return Promise.all(runners);
  };

  Sequence.prototype.decode = function (i) {
    if (this.bitmaps[i] || this.pending[i] || !this.blobs[i]) return;
    const self = this;
    const opts = decodeW
      ? { resizeWidth: decodeW, resizeHeight: decodeH, resizeQuality: 'medium' }
      : undefined;
    this.pending[i] = createImageBitmap(this.blobs[i], opts)
      .then((bm) => { self.bitmaps[i] = bm; self.pending[i] = null; })
      .catch(() => { self.pending[i] = null; });
  };

  /* Keep a window decoded around `centre` and release everything else. Called
     every frame; it is cheap because it only acts on the edges. */
  Sequence.prototype.window = function (centre) {
    const lo = Math.max(0, centre - DECODE_AHEAD);
    const hi = Math.min(this.count - 1, centre + DECODE_AHEAD);
    for (let i = lo; i <= hi; i++) this.decode(i);
    // Release everything outside the window, frame 0 included. Pinning frame 0
    // of all eight sequences kept ~66MB resident for the whole visit, which is
    // exactly the kind of standing cost a phone cannot carry alongside the
    // window it actually needs.
    for (let i = 0; i < this.count; i++) {
      if (i < lo || i > hi) {
        const bm = this.bitmaps[i];
        if (bm) { try { bm.close(); } catch (e) {} this.bitmaps[i] = null; }
      }
    }
  };

  /* The nearest decoded frame to `i`, so the renderer always has something to
     draw even mid-flick. */
  Sequence.prototype.nearest = function (i) {
    if (this.bitmaps[i]) return this.bitmaps[i];
    for (let d = 1; d <= this.count; d++) {
      if (this.bitmaps[i - d]) return this.bitmaps[i - d];
      if (this.bitmaps[i + d]) return this.bitmaps[i + d];
    }
    return null;
  };

  Sequence.prototype.ready = function () { return this.loaded >= this.count; };

  /* -- renderer ------------------------------------------------------------ */
  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.w = 0; this.h = 0;
  }

  Renderer.prototype.resize = function (cssW, cssH) {
    // Cap the backing store at 2x: a third device pixel on a phone costs real
    // fill rate and is invisible on this material.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (w === this.w && h === this.h) return;
    this.canvas.width = this.w = w;
    this.canvas.height = this.h = h;
    // Frames are 9:16; decode them to the height we draw at, so drawImage has no
    // downscale to do either.
    decodeH = Math.min(1920, h);
    decodeW = Math.round(decodeH * 1080 / 1920);
    // No inline CSS size: `.film` is inset:0 on the stage, so the canvas always
    // covers whatever the stage currently is. Pinning it in pixels here meant
    // that when a phone's URL bar collapsed and the viewport grew, the canvas
    // stayed at its old height and left a bare strip along the bottom.
  };

  /* Draw one frame with `cover` geometry — the same crop the video had, so the
     video-space anchors (scratch medallion, RSVP panel, portrait) still land on
     their artwork. */
  Renderer.prototype.paint = function (bm, alpha) {
    if (!bm || alpha <= 0) return;
    const ctx = this.ctx;
    const s = Math.max(this.w / bm.width, this.h / bm.height);
    const dw = bm.width * s, dh = bm.height * s;
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    ctx.drawImage(bm, (this.w - dw) / 2, (this.h - dh) / 2, dw, dh);
    ctx.globalAlpha = 1;
  };

  Renderer.prototype.clear = function () {
    this.ctx.fillStyle = '#efe4d2';
    this.ctx.fillRect(0, 0, this.w, this.h);
  };

  return { Sequence, Renderer };
})();

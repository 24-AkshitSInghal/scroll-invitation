/* ============================================================================
   scroll-film.js — scroll-driven camera flight for the ShubhMilan invitation
   ----------------------------------------------------------------------------
   Scroll drives time, not motion: eight pre-rendered 9:16 clips form one
   continuous camera flight, and scroll position picks the frame to show.

   The film is a WebP frame sequence rather than video — see film.js for why, and
   for how frames are fetched, decoded in a window, and composited. This file
   owns the mapping from scroll position to frame, the copy, and the chrome.

   The pacing knobs that shape that mapping (`settle`, `linger`, `parallax`,
   `anchored`) are documented in invite.config.js.
   ========================================================================== */

(function () {
  'use strict';

  const cfg = window.INVITE;
  const SECTIONS = cfg.sections;
  const N = SECTIONS.length;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const smallMQ = matchMedia('(max-width: 860px)');
  const isMobile = () => coarse || smallMQ.matches;

  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
  /* Slows time through the middle of a scene and speeds it back up toward the
     edges. f(0)=0 and f(1)=1 exactly, so the frames either side of a seam are
     the ones the clips were chained on — the join stays frame-identical. */
  const lingerEase = (t, k) => (k ? (t -= 0.5, clamp(0.5 + t * (1 - k) + k * 4 * t * t * t)) : t);
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);

  /* -- geometry ----------------------------------------------------------- */
  let vh = innerHeight, laidOutW = innerWidth, total = 0;

  const stage = $('.stage');
  const track = $('.track');
  const rail = $('.rail');
  const progress = $('.progress__fill');

  /* Build one scene layer per section, each holding a poster and (once loaded)
     its video. They are stacked; opacity picks the active one. */
  /* One canvas for the whole film. Ten stacked full-screen layers was work the
     compositor repeated every frame; a crossfade here is two drawImage calls. */
  const canvas = document.createElement('canvas');
  canvas.className = 'film';
  canvas.setAttribute('aria-hidden', 'true');
  stage.insertBefore(canvas, stage.firstChild);
  const renderer = new Film.Renderer(canvas);

  // One Sequence per distinct clip — scenes that rest on another clip's final
  // frame share its sequence rather than shipping a second copy.
  const seqs = {};
  function seqFor(dir) {
    if (!seqs[dir]) seqs[dir] = new Film.Sequence(dir, cfg.frameCount || 56);
    return seqs[dir];
  }

  const scenes = SECTIONS.map((s, i) => ({
    i, cfg: s, seq: seqFor(s.frames),
    target: 0, op: 0, frameIndex: 0, visible: false, start: 0, end: 0,
    w: s.scroll || cfg.diveScroll, settle: s.settle || 1, linger: s.linger || 0,
  }));


  const copies = Array.from(document.querySelectorAll('.copy'));

  /* Elements carrying data-fade="i0,i1,o0,o1" run their own opacity ramp inside
     their scene, so one scene can hand off between two lines of copy — the
     opening greeting stepping aside as the monogram finishes drawing itself. */
  const fades = copies.map((c) =>
    Array.from(c.querySelectorAll('[data-fade]')).map((el) => ({
      el, r: el.dataset.fade.split(',').map(Number),
    }))
  );

  /* Depth. The film is a camera move and must never be transformed — doing so
     would break the seams and pull the video-space anchors off their artwork —
     so the sense of depth comes from the overlays travelling at their own rate
     against it. Each scene drifts by its `parallax` (viewport-heights across the
     whole scene); elements carrying data-par get their own layer on top, written
     to a --par custom property so it composes with whatever transform the element
     already uses for its own positioning.

     data-par is a percentage of the PICTURE's height, not the viewport's, and is
     resolved to px here. Those layers sit on painted artwork, and on a tall
     desktop window the stage is capped at 1180px while the viewport is taller —
     a vh-based drift would then travel further across the picture than intended
     and slide the photograph into the wreath's lower flowers. */
  const layers = copies.map((c) =>
    Array.from(c.querySelectorAll('[data-par]')).map((el) => ({
      el, d: parseFloat(el.dataset.par) || 0,
      scale: parseFloat(el.dataset.parScale) || 0,
    }))
  );

  /* -- section rail ------------------------------------------------------- */
  SECTIONS.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'rail__dot';
    b.type = 'button';
    b.setAttribute('aria-label', s.label);
    b.innerHTML = '<span class="rail__label">' + s.label + '</span>';
    b.addEventListener('click', () => {
      const sc = scenes[i];
      scrollTo({ top: sc.start + (sc.end - sc.start) * 0.62, behavior: reduce ? 'auto' : 'smooth' });
    });
    rail.appendChild(b);
  });
  const dots = Array.from(rail.children);

  /* -- loading ------------------------------------------------------------- */
  /* Every frame is fetched up front, behind the invitation gate. The whole film
     is ~26MB — less than the video it replaced — and once it is in, scrolling
     touches nothing but memory: no request, no decode chain, no stall. */
  function loadAll(onProgress) {
    const list = Object.keys(seqs).map((k) => seqs[k]);
    const total = list.reduce((n, q) => n + q.count, 0);
    let done = 0;
    const tick = () => { done++; onProgress(done / total); };
    // In scene order, so the opening is ready first even mid-load.
    return list.reduce((p, q) => p.then(() => q.fetchAll(tick)), Promise.resolve());
  }

  /* -- scroll read (layout + opacity, cheap) -------------------------------- */
  let ticking = false, activeIndex = -1;

  /* The clips are 1080×1920 and the scenes are `object-fit: cover`, so on a tall
     phone the film is cropped at the sides and a percentage of the STAGE is no
     longer the same percentage of the PICTURE. Anything that has to sit exactly
     on painted artwork — the scratch medallion, the RSVP silk panel — is
     positioned against these variables instead, which describe where the video's
     own 0–100% actually lands inside the stage. On desktop the stage is already
     9:16, so the offsets are zero and this reduces to plain percentages. */
  let picH = 0;    // the film's displayed height in px — the unit for data-par
  function mapVideoSpace() {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    if (!sw || !sh) return;
    const scale = Math.max(sw / 1080, sh / 1920);      // cover
    const dw = 1080 * scale, dh = 1920 * scale;
    const s = stage.style;
    s.setProperty('--vx', ((sw - dw) / 2) + 'px');
    s.setProperty('--vy', ((sh - dh) / 2) + 'px');
    s.setProperty('--vw', dw + 'px');
    s.setProperty('--vh', dh + 'px');
    picH = dh;
    renderer.resize(sw, sh);
  }

  /* Split deliberately. `measure` is everything safe to redo at any moment — the
     canvas backing store and the video-space anchors. `layout` additionally
     rebuilds the scroll bands, which moves where every scene begins and so
     yanks the reader's position; that must only happen on a real width change. */
  function measure() {
    mapVideoSpace();
    read();
  }

  function layout() {
    vh = innerHeight;
    laidOutW = innerWidth;
    mapVideoSpace();
    let off = 0;
    scenes.forEach((sc) => { sc.start = off * vh; off += sc.w; sc.end = off * vh; });
    total = off;
    // +1vh of runway so the final scene can complete its flight.
    track.style.height = (total * vh + vh) + 'px';
    read();
  }

  function read() {
    const y = scrollY || pageYOffset;
    const fade = (cfg.crossfade || 0.1) * vh;
    const mobile = isMobile();

    let ci = 0;
    for (let i = 0; i < N; i++) if (y >= scenes[i].start) ci = i;

    for (let i = 0; i < N; i++) {
      const sc = scenes[i];

      const local = clamp((y - sc.start) / (sc.end - sc.start));
      // `linger` slows the camera through the middle of the scene without ever
      // stopping it, and `settle` brings it to a genuine rest early. Transit
      // scenes use the first so the flight runs straight through the seam; only
      // the scenes designed to come to rest use the second.
      sc.target = clamp(lingerEase(local, sc.linger) / sc.settle);

      let outside = 0;
      if (y < sc.start) outside = sc.start - y;
      else if (y > sc.end) outside = y - sc.end;
      sc.op = smooth(1 - outside / fade);
      sc.visible = sc.op > 0.002;
      // `still` scenes rest on their sequence's last frame — that is how the
      // portrait and the closing card sit on the frame the previous clip ended
      // on without a second copy of anything.
      const t = sc.cfg.still ? 1 : sc.target;
      sc.frameIndex = Math.round(clamp(t) * (sc.seq.count - 1));

      // ---- copy ----
      const c = copies[i];
      const [i0, i1, o0, o1] = sc.cfg.copy || [0.2, 0.4, 0.75, 0.95];
      let cop = smooth((local - i0) / (i1 - i0));
      if (o1 > o0) cop = Math.min(cop, smooth(1 - (local - o0) / (o1 - o0)));
      if (y < sc.start || y > sc.end) cop = Math.min(cop, sc.op);
      c.style.opacity = cop;
      // Entrance rise plus the scene's own drift, centred on mid-scene so the
      // copy travels through the frame rather than starting or ending displaced.
      // An anchored scene gets neither: its overlay sits on painted artwork, and
      // even the entrance offset would have it scratching or typing against a
      // target 1.6vh away from where it looks.
      if (reduce || sc.cfg.anchored) {
        c.style.transform = 'none';
      } else {
        const par = (sc.cfg.parallax || 0) * (0.5 - local);
        c.style.transform = 'translate3d(0,' + ((1 - cop) * 1.6 + par).toFixed(3) + 'vh,0)';
      }

      if (!reduce) {
        for (const L of layers[i]) {
          L.el.style.setProperty('--par', (L.d / 100 * picH * (0.5 - local)).toFixed(2) + 'px');
          if (L.scale) L.el.style.setProperty('--par-scale', (1 + L.scale * (0.5 - local)).toFixed(4));
        }
      }
      // Interactive scenes need a generous hit window, not a razor-thin peak.
      c.style.pointerEvents = cop > 0.55 ? 'auto' : 'none';
      const cvis = cop > 0.002;
      if (cvis !== c._vis) { c.style.visibility = cvis ? 'visible' : 'hidden'; c._vis = cvis; }
      c.classList.toggle('is-live', cop > 0.55);

      for (const f of fades[i]) {
        const [a0, a1, b0, b1] = f.r;
        let o = smooth((local - a0) / (a1 - a0));
        if (b1 > b0) o = Math.min(o, smooth(1 - (local - b0) / (b1 - b0)));
        f.el.style.opacity = o;
        f.el.style.pointerEvents = o > 0.55 ? 'auto' : 'none';
      }
    }

    if (ci !== activeIndex) {
      activeIndex = ci;
      dots.forEach((d, k) => d.classList.toggle('is-active', k === ci));
      document.body.dataset.scene = SECTIONS[ci].id;
    }

    progress.style.transform = 'scaleY(' + clamp(y / (total * vh)) + ')';
    document.documentElement.classList.toggle('is-scrolled', y > vh * 0.35);
    ticking = false;
  }

  /* -- render loop ---------------------------------------------------------- */
  function frame() {
    // Composite the visible scenes the way stacked opacity layers would: the
    // faintest as the base, the rest blended over it. Across a seam both sides
    // hold the same picture, so the dissolve is invisible either way.
    const vis = [];
    for (let i = 0; i < N; i++) if (scenes[i].visible) vis.push(scenes[i]);
    if (vis.length) {
      vis.sort((p, q) => p.op - q.op);
      for (let k = 0; k < vis.length; k++) {
        const sc = vis[k];
        const idx = sc.frameIndex;
        sc.seq.window(idx);
        renderer.paint(sc.seq.nearest(idx), k === 0 ? 1 : sc.op);
      }
    }
    requestAnimationFrame(frame);
  }

  /* -- wiring --------------------------------------------------------------- */
  addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(read); }
  }, { passive: true });

  // Mobile browsers fire `resize` whenever the URL bar slides. Re-running layout
  // there rebuilds the track height and yanks the scroll position, so on touch we
  // only relayout when the width actually changed (rotation still arrives via
  // orientationchange).
  /* A phone fires `resize` every time the URL bar slides away, and the viewport
     genuinely grows by ~80px when it does. Rebuilding the bands there would jump
     the page mid-scroll, but ignoring it outright — which is what this used to do
     — left the canvas at its old height and a bare strip along the bottom. So:
     re-measure always, re-lay-out only when the width actually changed. */
  addEventListener('resize', () => {
    if (innerWidth !== laidOutW) layout();
    else measure();
  });
  // The reliable signal for the URL bar on iOS; `resize` is not always fired.
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', measure);
    visualViewport.addEventListener('scroll', measure);
  }
  addEventListener('orientationchange', () => setTimeout(layout, 120));
  addEventListener('load', layout);

  // rAF stops while the tab is hidden, which leaves `ticking` latched and the
  // clips parked on a stale frame. Clear the latch and re-read on return.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    ticking = false;
    read();
  });

  if (reduce) document.documentElement.classList.add('is-reduced');
  layout();
  requestAnimationFrame(frame);

  /* -- the invitation gate --------------------------------------------------- */
  /* Load the whole film first, then let the visitor in. It costs a wait up
     front, but it is the only way to promise that nothing stutters afterwards —
     and the tap that opens it is a real user gesture, which is also what lets
     the music start on iOS. */
  const curtain = $('.curtain');
  const bar = $('.curtain__fill');
  const pct = $('.curtain__pct');
  const openBtn = $('.curtain__open');
  let opened = false;

  function open() {
    if (opened) return;
    opened = true;
    curtain.classList.add('is-up');
    document.documentElement.classList.remove('is-locked');
    setTimeout(() => { if (curtain.parentNode) curtain.remove(); }, 1200);
    window.dispatchEvent(new CustomEvent('invitation:open'));   // music listens
  }

  document.documentElement.classList.add('is-locked');
  openBtn.addEventListener('click', open);

  loadAll((p) => {
    const v = Math.round(p * 100);
    if (bar) bar.style.transform = 'scaleX(' + p.toFixed(3) + ')';
    if (pct) pct.textContent = v + '%';
  }).then(() => {
    // Warm the opening frames so the first scroll has bitmaps ready.
    scenes[0].seq.window(0);
    curtain.classList.add('is-ready');
    if (pct) pct.textContent = '';
  });

  // The film no longer flies itself on load. The landing screen says "scroll to
  // begin" in the middle of the frame; moving the page for people made it
  // unclear whether anything was theirs to control.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  window.FILM = { scenes, layout, read, isMobile };
})();

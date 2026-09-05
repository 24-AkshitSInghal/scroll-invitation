/* ============================================================================
   scroll-film.js — scroll-driven camera flight for the ShubhMilan invitation
   ----------------------------------------------------------------------------
   Scroll drives time, not motion: eight pre-rendered 9:16 clips form one
   continuous camera flight, and scroll position picks the frame to show.

   The film is a WebP frame sequence rather than video — see film.js for why, and
   for how frames are fetched, decoded in a window, and composited. This file
   owns the mapping from scroll position to frame, the copy, and the chrome.

   The pacing knobs that shape that mapping (`settle`, `linger`, `from`/`to`,
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
  const stagewrap = $('.stagewrap');
  const track = $('.track');
  const rail = $('.rail');
  const progress = $('.progress__fill');
  const roomCount = $('.room__count');
  const roomScene = $('.room__scene');
  const roomOf = $('.room__of');
  if (roomOf) roomOf.textContent = '/ ' + String(SECTIONS.length).padStart(2, '0');

  /* One canvas for the whole film. Ten stacked full-screen layers was work the
     compositor repeated every frame; a crossfade here is two drawImage calls. */
  const canvas = document.createElement('canvas');
  canvas.className = 'film';
  canvas.setAttribute('aria-hidden', 'true');
  stage.insertBefore(canvas, stage.firstChild);
  const renderer = new Film.Renderer(canvas);

  /* Which frame tier to download. Decode cost scales with the SOURCE pixels, not
     with the size we draw at: createImageBitmap has to decode the whole 1080
     image before it can resize it down, so a budget phone drawing into a
     720-wide canvas was paying 2.25x for detail it then threw away. It also
     halves the wait at the gate.

     Decided once, before anything is fetched. `?q=lite` / `?q=hi` overrides it,
     which is the only honest way to compare the two on a real device. */
  const LITE = (function () {
    const q = new URLSearchParams(location.search).get('q');
    if (q === 'lite') return true;
    if (q === 'hi') return false;
    // Every touch device takes the light tier. The canvas is capped at 2x DPR,
    // so even the widest phone draws into ~860px — from a 720 source that is a
    // 1.19x upscale on a screen held at arm's length, which is invisible, in
    // exchange for half the download and 2.25x less decode per frame. Desktop,
    // where none of this ever struggled and the picture is studied up close,
    // keeps the full 1080.
    if (coarse) return true;
    const c = navigator.connection || {};
    if (c.saveData) return true;
    if (/2g/.test(c.effectiveType || '')) return true;
    if ((navigator.deviceMemory || 8) <= 4) return true;   // Chrome only; absent = assume capable
    return false;
  })();

  // One Sequence per distinct clip — scenes that share a clip share its frames.
  const seqs = {};
  function seqFor(dir) {
    const d = LITE ? dir.replace('/frames/', '/frames-720/') : dir;
    if (!seqs[d]) seqs[d] = new Film.Sequence(d, cfg.frameCount || 56);
    return seqs[d];
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
  let activeIndex = -1;

  /* The playhead. Frames are indexed straight off scroll position, so a hard
     flick used to jump the index by dozens of frames at once and read as a cut —
     the camera appearing somewhere new rather than travelling there.
     `viewY` chases the real scroll instead of matching it, and every scene
     derives from `viewY`: frame, opacity and copy fade alike. A flick becomes a
     fast fly-through of the actual film instead of a teleport.

     The per-frame step is capped so the film cannot advance faster than the eye
     can follow — about 2 film-frames per rendered frame at the floor — and the
     cap widens with distance so a rail jump across the whole invitation still
     arrives in well under a second rather than crawling. */
  let viewY = 0, settled = true;

  function advance() {
    const y = scrollY || pageYOffset;
    if (reduce) { viewY = y; return true; }           // no extra motion
    const d = y - viewY;
    const ad = Math.abs(d);
    if (ad < 0.6) { viewY = y; return true; }         // arrived
    const far = Math.min(12, ad / (vh || 800));
    const cap = (vh || 800) * (0.055 + 0.02 * far);
    let step = d * 0.16;
    if (step > cap) step = cap; else if (step < -cap) step = -cap;
    viewY += step;
    return false;
  }

  /* The clips are 1080×1920 and the scenes are `object-fit: cover`, so on a tall
     phone the film is cropped at the sides and a percentage of the STAGE is no
     longer the same percentage of the PICTURE. Anything that has to sit exactly
     on painted artwork — the medallion, the RSVP silk panel, the portrait — is
     positioned against these variables instead, which describe where the video's
     own 0–100% actually lands inside the stage. On desktop the stage is already
     9:16, so the offsets are zero and this reduces to plain percentages. */
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
    renderer.resize(sw, sh);
  }

  /* Split deliberately. `measure` is everything safe to redo at any moment — the
     canvas backing store and the video-space anchors. `layout` additionally
     rebuilds the scroll bands, which moves where every scene begins and so
     yanks the reader's position; that must only happen on a real width change. */
  /* How tall the film actually is. Percentages and `dvh` both hand this decision
     to the browser, and iOS in particular disagrees with itself about whether a
     fixed element tracks the URL bar — which is how the copy could grow while the
     picture behind it did not. One number, set here, and everything downstream
     (stage box, canvas CSS box, canvas backing store, cover geometry) follows it. */
  function viewportH() {
    return Math.round(window.visualViewport ? visualViewport.height : innerHeight);
  }

  let appliedH = 0;
  function measure() {
    const h = viewportH();
    appliedH = h;
    stagewrap.style.height = h + 'px';
    // Also published as a variable: the phone shell shrink-wraps its content, so
    // a `height: 100%` inside it has no definite parent to resolve against.
    document.documentElement.style.setProperty('--vph', h + 'px');
    mapVideoSpace();
    read();
  }

  function layout() {
    vh = viewportH();
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
    const y = viewY;
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
      /* A scene can own a SLICE of its clip rather than the whole thing, via
         `from`/`to`. That is how the photograph and the closing card get their
         own screen without the film stopping dead underneath them: the previous
         scene plays its clip up to the cut, this one carries on from exactly
         there. Consecutive slices of the same sequence are seamless by
         construction — it is the same clip, still running. */
      const f0 = sc.cfg.from != null ? sc.cfg.from : 0;
      const f1 = sc.cfg.to != null ? sc.cfg.to : 1;
      const t = f0 + (f1 - f0) * clamp(sc.target);
      sc.frameIndex = Math.round(t * (sc.seq.count - 1));

      // ---- copy ----
      const c = copies[i];
      const [i0, i1, o0, o1] = sc.cfg.copy || [0.2, 0.4, 0.75, 0.95];
      let cop = smooth((local - i0) / (i1 - i0));
      if (o1 > o0) cop = Math.min(cop, smooth(1 - (local - o0) / (o1 - o0)));
      if (y < sc.start || y > sc.end) cop = Math.min(cop, sc.op);
      /* Every write here is guarded. This loop runs on every frame the playhead
         is moving, across ten sections; writing opacity, transform and
         pointer-events unconditionally was ~40 style mutations a frame, and on a
         budget phone that recalc competes with the decode for the same main
         thread. Rounding opacity to 3dp also stops imperceptible changes from
         invalidating style at all. */
      const copR = Math.round(cop * 1000) / 1000;
      if (copR !== c._op) { c.style.opacity = copR; c._op = copR; }

      // A small entrance rise, and nothing else — the overlays no longer drift
      // against the film. An anchored scene gets not even that: its overlay sits
      // on painted artwork, and 1.6vh of offset is enough to have someone tapping
      // a target that isn't where it looks.
      const tf = (reduce || sc.cfg.anchored)
        ? 'none'
        : 'translate3d(0,' + ((1 - copR) * 1.6).toFixed(2) + 'vh,0)';
      if (tf !== c._tf) { c.style.transform = tf; c._tf = tf; }

      // Interactive scenes need a generous hit window, not a razor-thin peak.
      const live = copR > 0.55;
      if (live !== c._live) {
        c.style.pointerEvents = live ? 'auto' : 'none';
        c.classList.toggle('is-live', live);
        c._live = live;
      }
      const cvis = copR > 0.002;
      if (cvis !== c._vis) { c.style.visibility = cvis ? 'visible' : 'hidden'; c._vis = cvis; }

      for (const f of fades[i]) {
        const [a0, a1, b0, b1] = f.r;
        let o = smooth((local - a0) / (a1 - a0));
        if (b1 > b0) o = Math.min(o, smooth(1 - (local - b0) / (b1 - b0)));
        o = Math.round(o * 1000) / 1000;
        if (o !== f._op) { f.el.style.opacity = o; f._op = o; }
        const fl = o > 0.55;
        if (fl !== f._live) { f.el.style.pointerEvents = fl ? 'auto' : 'none'; f._live = fl; }
      }
    }

    if (ci !== activeIndex) {
      activeIndex = ci;
      dots.forEach((d, k) => d.classList.toggle('is-active', k === ci));
      document.body.dataset.scene = SECTIONS[ci].id;
      // the readout beside the phone, on a wide screen
      if (roomCount) roomCount.textContent = String(ci + 1).padStart(2, '0');
      if (roomScene) roomScene.textContent = SECTIONS[ci].label;
    }

    progress.style.transform = 'scaleY(' + clamp(y / (total * vh)) + ')';
    document.documentElement.classList.toggle('is-scrolled', y > vh * 0.35);
  }

  /* -- render loop ---------------------------------------------------------- */
  function frame() {
    // Some browsers do not fire any resize for the URL bar sliding away. Reading
    // the viewport height is free (no layout), so just check it every frame and
    // re-measure when it moves — the picture can never fall out of step.
    if (viewportH() !== appliedH) measure();

    // Advance the playhead toward the scroll position and re-read only while it
    // is actually moving; once settled this costs one subtraction per frame.
    const arrived = advance();
    if (!arrived || !settled) { read(); settled = arrived; }

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
  addEventListener('scroll', () => { settled = false; }, { passive: true });

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

  // rAF stops while the tab is hidden, so the playhead is wherever it was left.
  // Snap it to the real scroll position on return rather than flying the film
  // through everything the visitor scrolled past while looking elsewhere.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    viewY = scrollY || pageYOffset;
    settled = false;
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

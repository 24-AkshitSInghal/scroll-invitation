/* ============================================================================
   scroll-film.js — the camera flight for the ShubhMilan invitation
   ----------------------------------------------------------------------------
   A gesture drives time, not motion: eight pre-rendered 9:16 clips form one
   continuous camera flight, and a playhead `viewY` picks the frame to show.

   The document itself does not scroll. `viewY` rests on one of a fixed list of
   stops and is animated between them by `goTo()`; a swipe, wheel notch or arrow
   key moves exactly one stop. That is what makes the film affordable on a cheap
   phone — the whole path is known before the animation starts, so decoding runs
   ahead of it. See "Stops, not scrolling" in the README.

   The film is a WebP frame sequence rather than video — see film.js for why, and
   for how frames are fetched, decoded in a window, and composited. This file
   owns the mapping from `viewY` to frame, the copy, and the chrome.

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
      const k = stops.findIndex((st) => st.sc === scenes[i]);
      if (k >= 0) goTo(k);
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

  /* ── the playhead ────────────────────────────────────────────────────────
     The film no longer follows a finger. It moves between a fixed set of STOPS —
     one per scene — and the code drives every transition.

     That is not a styling choice, it is what made it usable on a cheap phone.
     Free scrubbing decodes frames *during* the gesture, at whatever rate the
     finger dictates, and a slow decoder simply cannot keep up: you get the
     stutter. With stops, the whole path is known the moment the gesture ends, so
     decoding runs AHEAD of the animation instead of racing it — and if the
     decoder still falls behind, the transition stretches rather than skipping
     frames. It degrades to slightly slower, never to juddery.

     Everything downstream is unchanged: `viewY` still means the same thing, and
     read() still derives frame, opacity and copy fade from it. Only what moves
     `viewY` is different. */
  let viewY = 0, settled = true;

  const stops = [];            // { y, scene } in scene order
  let cur = 0;                 // which stop we are at or heading to
  let moving = false, fromY = 0, toY = 0, elapsed = 0, dur = 0, lastNow = 0;

  function buildStops() {
    stops.length = 0;
    scenes.forEach((sc) => {
      // A scene rests where its copy is fully in. `stops` in the theme overrides
      // that — the opening needs two, one on the greeting and one on the
      // monogram once it has drawn itself.
      const locals = sc.cfg.stops || [clamp(sc.cfg.copy ? sc.cfg.copy[1] : 0.5)];
      locals.forEach((l) => stops.push({ y: sc.start + (sc.end - sc.start) * clamp(l), sc }));
    });
    stops.sort((a, b) => a.y - b.y);
  }

  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  /* Which frame is on screen at a given position, and is it decoded yet? This is
     the same mapping read() uses, pulled out so the animation can ask about a
     position it has not moved to yet. */
  function frameAt(y) {
    let best = null, bestOp = -1;
    for (let i = 0; i < N; i++) {
      const sc = scenes[i];
      const local = clamp((y - sc.start) / (sc.end - sc.start));
      let outside = 0;
      if (y < sc.start) outside = sc.start - y;
      else if (y > sc.end) outside = y - sc.end;
      const op = smooth(1 - outside / ((cfg.crossfade || 0.1) * vh));
      if (op > bestOp) {
        bestOp = op;
        const f0 = sc.cfg.from != null ? sc.cfg.from : 0;
        const f1 = sc.cfg.to != null ? sc.cfg.to : 1;
        const t = f0 + (f1 - f0) * clamp(lingerEase(local, sc.linger) / sc.settle);
        best = { seq: sc.seq, idx: Math.round(t * (sc.seq.count - 1)) };
      }
    }
    return best;
  }

  const ready = (y) => { const f = frameAt(y); return !f || !!f.seq.bitmaps[f.idx]; };

  /* Warm a path in the order it will be played. The order is known and
     monotonic, so nothing is decoded twice and nothing is decoded in vain —
     which is exactly what free scrubbing could never promise.

     `frac` limits how much of the path to warm: the head start asks for the
     first stretch only, so the transition can begin while the rest decodes
     behind it. */
  function primePath(y0, y1, frac) {
    const steps = 26;
    const end = Math.max(1, Math.round(steps * (frac == null ? 1 : frac)));
    const keep = performance.now() + KEEP_WARM;
    for (let k = 0; k <= end; k++) {
      const f = frameAt(y0 + (y1 - y0) * (k / steps));
      if (f) { f.seq.decode(f.idx); f.seq.keepUntil = keep; }
    }
  }

  /* How long a warmed-but-unseen sequence is allowed to hold its frames. Long
     enough to survive the gap between warming the next stop and flying to it;
     short enough that wandering back and forth does not accumulate the whole
     film in memory. */
  const KEEP_WARM = 3000;

  /* How long a sequence must have been off screen before its frames are freed.
     Long enough to outlast a fast pass through a scene, short enough that the
     film does not accumulate in memory. */
  const IDLE_RELEASE = 2000;

  /* How much of the opening stretch is decoded before a transition is allowed to
     start. Without it the film sets off, immediately runs out of frames and is
     held by `advance()` — which is correct but reads as a stumble right at the
     moment attention is highest. Waiting a beat first is invisible; stumbling is
     not. Capped so a slow device never feels stuck on the button. */
  const HEAD_START = 0.22, HEAD_WAIT_MAX = 900;
  const STALL_MAX = 140;          // longest the camera may wait on one frame
  let arming = null, heldSince = 0;

  function pathReady(y0, y1, frac) {
    const steps = 26;
    const end = Math.max(1, Math.round(steps * frac));
    for (let k = 0; k <= end; k++) {
      const f = frameAt(y0 + (y1 - y0) * (k / steps));
      if (f && !f.seq.bitmaps[f.idx]) return false;
    }
    return true;
  }

  function goTo(i, instant) {
    i = Math.max(0, Math.min(stops.length - 1, Math.round(i)));
    if (!stops.length) return;
    cur = i;
    arming = null;
    heldSince = 0;
    fromY = viewY;
    toY = stops[i].y;

    // A slower camera is not only better-looking, it is cheaper: the same frames
    // spread over more time is a lower demand on the decoder. This is the one
    // knob that trades wall-clock for smoothness, and smoothness wins — the film
    // is meant to read like footage, not like a page turn.
    const span = Math.abs(toY - fromY) / (vh || 800);
    dur = (reduce || instant) ? 0 : Math.min(4200, 1500 + span * 520);
    elapsed = 0;
    moving = dur > 0 && Math.abs(toY - fromY) > 1;
    if (!moving) { viewY = toY; settled = false; Film.setMoving(false); syncNav(); return; }

    settled = false;
    Film.setMoving(true);
    primePath(fromY, toY, HEAD_START);
    // Hold at the near end until the opening stretch exists, then let it run.
    arming = { until: performance.now() + HEAD_WAIT_MAX };
    syncNav();
  }

  function advance() {
    const now = performance.now();
    const dt = lastNow ? Math.min(48, now - lastNow) : 16;
    lastNow = now;
    if (!moving) return true;

    // Still waiting for the head start. Keep decoding, hold the camera still.
    if (arming) {
      if (now < arming.until && !pathReady(fromY, toY, HEAD_START)) {
        primePath(fromY, toY, HEAD_START);
        return false;
      }
      arming = null;
      primePath(fromY, toY);           // the rest, now that we are under way
    }

    /* Only let the clock run when the frame we are about to show exists, so a
       slow decoder slows the camera rather than making it skip — but bound the
       wait. A jump across the whole film (a rail dot, or End) crosses more
       scenes than can be decoded at any speed, and an unbounded hold there did
       not slow the flight, it stopped it: twelve seconds in, still moving.

       After STALL_MAX of waiting we go on regardless. `nearest()` then draws the
       closest frame that does exist, which is the degradation this design was
       always meant to have — a slightly stale frame, never a stall. */
    const next = elapsed + dt;
    const peek = fromY + (toY - fromY) * easeInOut(Math.min(1, next / dur));
    if (next >= dur || ready(peek) || (heldSince && now - heldSince > STALL_MAX)) {
      elapsed = next;
      heldSince = 0;
    } else if (!heldSince) {
      heldSince = now;
    }

    const p = Math.min(1, elapsed / dur);
    viewY = fromY + (toY - fromY) * easeInOut(p);
    if (p >= 1) {
      moving = false;
      Film.setMoving(false);   // back to a small, symmetric window
      syncNav();
      return true;
    }
    return false;
  }

  /* ── navigation ───────────────────────────────────────────────────────────
     Two buttons, and nothing else that moves the film.

     Swipe-to-advance was ambiguous in both directions: an overlay could swallow
     it, and there was no way to tell a reader that a swipe was the thing to do.
     A named control says what it does, cannot be intercepted by whatever happens
     to be under the thumb, and — the reason it is here — makes the next
     destination knowable while the reader is standing still, which is when there
     is time to decode it. Keys stay wired for anyone not using a pointer. */
  const nav = $('.nav');
  const btnPrev = $('.nav__btn--prev');
  const btnNext = $('.nav__btn--next');

  function syncNav() {
    if (!nav) return;
    const first = cur <= 0, last = cur >= stops.length - 1;
    if (btnPrev) btnPrev.disabled = first;
    if (btnNext) btnNext.disabled = last;
    nav.classList.toggle('is-busy', moving);
    const label = $('.nav__count');
    if (label) label.textContent = (cur + 1) + ' / ' + stops.length;
  }

  /* Decode the neighbouring transitions while the reader is at rest. This is the
     whole reason the buttons pay for themselves: at a stop there are exactly two
     places to go, both known, and the reader is reading. By the time they press,
     the opening stretch is usually already in memory. */
  let idleWarm = 0;
  function warmNeighbours() {
    if (moving || !stops.length) return;
    const now = performance.now();
    if (now < idleWarm) return;
    idleWarm = now + 400;
    if (cur + 1 < stops.length) primePath(viewY, stops[cur + 1].y, HEAD_START);
    if (cur - 1 >= 0) primePath(viewY, stops[cur - 1].y, HEAD_START * 0.6);
  }

  if (btnNext) btnNext.addEventListener('click', () => { if (!moving) goTo(cur + 1); });
  if (btnPrev) btnPrev.addEventListener('click', () => { if (!moving) goTo(cur - 1); });

  addEventListener('keydown', (e) => {
    if (e.target && e.target.closest && e.target.closest('input,textarea,select')) return;
    if (moving) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'PageDown' || k === ' ') { e.preventDefault(); goTo(cur + 1); }
    else if (k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); goTo(cur - 1); }
    else if (k === 'Home') { e.preventDefault(); goTo(0); }
    else if (k === 'End') { e.preventDefault(); goTo(stops.length - 1); }
  });

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
    // Nothing scrolls the document any more — the film is driven by goTo(). The
    // track stays in the markup only so the bands keep their pixel arithmetic.
    track.style.height = '0px';
    buildStops();
    if (!moving) viewY = stops.length ? stops[Math.min(cur, stops.length - 1)].y : 0;
    read();
    syncNav();
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

    progress.style.transform = 'scaleY(' + clamp(total ? y / (total * vh) : 0) + ')';
    document.documentElement.classList.toggle('is-scrolled', cur > 0);
  }

  /* -- render loop ---------------------------------------------------------- */
  function frame() {
    // Some browsers do not fire any resize for the URL bar sliding away. Reading
    // the viewport height is free (no layout), so just check it every frame and
    // re-measure when it moves — the picture can never fall out of step.
    if (viewportH() !== appliedH) measure();

    // Advance the playhead toward the stop it is travelling to, and re-read only
    // while it is actually moving; once settled this costs one comparison a frame.
    const arrived = advance();
    if (!arrived || !settled) { read(); settled = arrived; }
    else warmNeighbours();     // idle time is decode time for the next two stops

    // Composite the visible scenes the way stacked opacity layers would: the
    // faintest as the base, the rest blended over it. Across a seam both sides
    // hold the same picture, so the dissolve is invisible either way.
    const vis = [];
    for (let i = 0; i < N; i++) if (scenes[i].visible) vis.push(scenes[i]);

    /* Release anything neither on screen nor on its way there — but only after
       it has been off screen for a while. Releasing the moment a scene stops
       being painted looks tidier and is much worse: on a long jump scenes flick
       in and out of visibility, and each reappearance re-decoded its whole
       window. That thrash saturated the decode threads and took the render loop
       from 60fps to 2. Hysteresis costs a few megabytes and avoids all of it. */
    const nowMs = performance.now();
    for (let i = 0; i < N; i++) {
      const sc = scenes[i];
      if (sc.visible) { sc.seq.lastSeen = nowMs; continue; }
      if ((sc.seq.keepUntil || 0) >= nowMs) continue;
      if (nowMs - (sc.seq.lastSeen || 0) < IDLE_RELEASE) continue;
      sc.seq.release();
    }
    if (vis.length) {
      vis.sort((p, q) => p.op - q.op);
      for (let k = 0; k < vis.length; k++) {
        const sc = vis[k];
        const idx = sc.frameIndex;
        sc.seq.window(idx, moving ? (toY >= fromY ? 1 : -1) : 0);
        renderer.paint(sc.seq.nearest(idx), k === 0 ? 1 : sc.op);
      }
    }
    requestAnimationFrame(frame);
  }

  /* -- wiring --------------------------------------------------------------- */
  /* A phone fires `resize` every time the URL bar slides away, and the viewport
     genuinely grows by ~80px when it does. Rebuilding the bands there moves every
     stop, but ignoring it outright — which is what this used to do — left the
     canvas at its old height and a bare strip along the bottom. So: re-measure
     always, re-lay-out only when the width actually changed. */
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

  // rAF stops while the tab is hidden, so no time passes for the playhead and it
  // is still mid-transition where it was left. Discard the time spent away rather
  // than counting it as animation, and repaint from wherever it actually is.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    lastNow = 0;                       // don't count time spent away as animation
    settled = false;
    read();
  });

  if (reduce) document.documentElement.classList.add('is-reduced');
  // ?grid lays a percentage rule over the picture for measuring a new theme's
  // anchors — see the note in base.css.
  if (/[?&]grid\b/.test(location.search)) document.documentElement.classList.add('is-grid');
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
    goTo(0, true);
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

  window.FILM = { scenes, stops, layout, read, isMobile, goTo,
                  at: () => cur, y: () => viewY, moving: () => moving };
})();

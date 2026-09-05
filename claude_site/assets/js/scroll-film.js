/* ============================================================================
   scroll-film.js — scroll-scrubbed camera flight for the ShubhMilan invitation
   ----------------------------------------------------------------------------
   Scroll drives time, not motion: eight pre-rendered 9:16 clips form one
   continuous camera flight, and scroll position sets each clip's currentTime.
   Nothing here is framework-specific.

   The three things that make this work, and are easy to get wrong:

   1. BLOB PLAYBACK. Static hosts that don't answer HTTP byte-range requests pin
      video.seekable to [0,0], which clamps every seek to frame 0 — the clip
      looks frozen. Fetching each clip as a Blob and playing it from an in-memory
      object URL sidesteps the host entirely; blobs are always fully seekable.

   2. SEEK COALESCING. Never assign currentTime while the decoder is still
      `seeking`. On a phone a fast flick otherwise queues seeks faster than they
      resolve and the picture locks up. We skip the frame and snap to the latest
      target as soon as the decoder frees up.

   3. iOS PRIMING. A muted video that has never been played won't paint a seeked
      frame in iOS Safari — the scene stays blank. So the poster stays up until
      the clip's first real `seeked` event, and every video gets a muted
      play→pause on the first touch.
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
  const scenes = SECTIONS.map((s, i) => {
    const el = document.createElement('div');
    el.className = 'scene';
    el.dataset.i = i;
    const img = document.createElement('img');
    img.className = 'scene__poster';
    img.alt = '';
    img.decoding = 'async';
    // Only the opening poster is wanted up front. The other nine are fetched as
    // the viewer approaches them — ten at once is ~600KB of requests competing
    // with the clip that is actually on screen.
    if (i === 0) img.src = s.poster;
    el.appendChild(img);
    stage.insertBefore(el, stage.firstChild);
    return {
      i, cfg: s, el, img,
      video: null, ready: false, loading: false, painted: false,
      cur: 0, target: 0, visible: false, start: 0, end: 0,
      w: s.scroll || cfg.diveScroll, settle: s.settle || 1, linger: s.linger || 0,
    };
  });

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

  /* -- clip loading -------------------------------------------------------- */
  /* Two strategies, chosen by what the host can actually do.

     Streaming (preferred): point the <video> at the URL and let the browser
     fetch by range as it seeks. Frames appear after a few hundred KB instead of
     after the whole file, which is the difference between a scene painting
     immediately and a phone showing a still for several seconds. Requires the
     host to answer HTTP range requests — a CDN does, `python -m http.server`
     does not.

     Blob (fallback): fetch the whole file and play it from an object URL. Always
     seekable, but nothing paints until the last byte lands. */
  let rangeOK = null;                       // null = not yet probed
  function probeRange(url) {
    if (rangeOK !== null) return Promise.resolve(rangeOK);
    return fetch(url, { headers: { Range: 'bytes=0-1' } })
      .then((r) => { rangeOK = (r.status === 206); return rangeOK; })
      .catch(() => { rangeOK = false; return false; });
  }

  function attach(sc, src, revoke) {
    const v = document.createElement('video');
    v.className = 'scene__video';
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
    v.src = src;
    sc.revoke = revoke || null;

    v.addEventListener('loadedmetadata', () => { sc.ready = true; read(); });
    v.addEventListener('loadeddata', () => {
      try { v.pause(); } catch (e) {}
      prime(v);
    });

    /* Revealing the clip. The poster stays up until a real frame has painted,
       because iOS won't paint a seeked-but-never-played muted video and we'd
       otherwise flash an empty scene.

       The catch: if that signal never arrives, the scene is stuck showing a
       still for ever — which is exactly what a scroll past the opening looked
       like on iOS. So take the first of three, rather than betting on one:
       a presented frame (the only signal that actually means "painted"), a
       completed seek, or a late check that the decoder has frames at all. */
    function reveal() {
      if (sc.painted) return;
      sc.painted = true;
      sc.el.classList.add('has-clip');
    }
    if (typeof v.requestVideoFrameCallback === 'function') {
      try { v.requestVideoFrameCallback(reveal); } catch (e) {}
    }
    v.addEventListener('seeked', reveal, { once: true });
    sc.revealTimer = setTimeout(() => { if (v.readyState >= 3) reveal(); }, 2500);

    sc.el.appendChild(v);
    sc.video = v;
  }

  function loadClip(sc) {
    // Under reduced motion we never fetch video at all: the posters stay up and
    // simply cross-dissolve. No decode cost, no scrubbed motion.
    if (reduce || sc.loading || !sc.cfg.clip) return;
    sc.loading = true;
    const url = (isMobile() && sc.cfg.clipMobile) ? sc.cfg.clipMobile : sc.cfg.clip;

    probeRange(url).then((ok) => {
      if (ok) { attach(sc, url); return; }
      fetch(url)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status))))
        .then((blob) => {
          const obj = URL.createObjectURL(blob);
          attach(sc, obj, obj);
        })
        .catch(() => { sc.loading = false; });   // poster carries the scene
    });
  }

  /* A phone can only keep a handful of video decoders alive at once; ten 
     1080-tall clips sitting in the DOM is what turns a smooth scrub into a
     slideshow. Keep a small window around the viewer and tear the rest down —
     the poster takes over instantly, and reloading is cheap once cached. */
  function releaseClip(sc) {
    if (!sc.video) return;
    const v = sc.video;
    clearTimeout(sc.revealTimer);
    sc.video = null; sc.ready = false; sc.loading = false; sc.painted = false;
    sc.cur = sc.target;
    sc.el.classList.remove('has-clip');
    try { v.pause(); } catch (e) {}
    try { v.removeAttribute('src'); v.load(); } catch (e) {}
    if (sc.revoke) { URL.revokeObjectURL(sc.revoke); sc.revoke = null; }
    if (v.parentNode) v.parentNode.removeChild(v);
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
      // How far ahead we fetch, and how many decoders we keep alive. A phone
      // pays for both: every extra clip is bandwidth competing with the one on
      // screen, and a live decoder it may not have to spare.
      const near = Math.abs(i - ci) <= (mobile ? 1 : 2);
      if (Math.abs(i - ci) <= 2 && !sc.img.src) sc.img.src = sc.cfg.poster;
      if (near) loadClip(sc);
      else if (sc.video && Math.abs(i - ci) > (mobile ? 2 : 3)) releaseClip(sc);

      const local = clamp((y - sc.start) / (sc.end - sc.start));
      // `linger` slows the camera through the middle of the scene without ever
      // stopping it, and `settle` brings it to a genuine rest early. Transit
      // scenes use the first so the flight runs straight through the seam; only
      // the scenes designed to come to rest use the second.
      sc.target = clamp(lingerEase(local, sc.linger) / sc.settle);

      let outside = 0;
      if (y < sc.start) outside = sc.start - y;
      else if (y > sc.end) outside = y - sc.end;
      const op = smooth(1 - outside / fade);
      const vis = op > 0.001;
      if (vis !== sc.visible) sc.el.style.visibility = vis ? 'visible' : 'hidden';
      sc.el.style.opacity = op;
      sc.visible = vis;
      sc.el.style.zIndex = (i === ci) ? 60 : 40 + Math.round(op * 10);

      // Before the clip paints, give the poster a touch of drift so a slow
      // connection still feels alive rather than frozen.
      if (!sc.painted) {
        sc.img.style.transform = reduce ? 'none' : 'scale(' + (1.02 + local * 0.06).toFixed(4) + ')';
      }

      // ---- copy ----
      const c = copies[i];
      const [i0, i1, o0, o1] = sc.cfg.copy || [0.2, 0.4, 0.75, 0.95];
      let cop = smooth((local - i0) / (i1 - i0));
      if (o1 > o0) cop = Math.min(cop, smooth(1 - (local - o0) / (o1 - o0)));
      if (y < sc.start || y > sc.end) cop = Math.min(cop, op);
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

  /* -- seek loop (rAF, the only place currentTime is written) --------------- */
  function frame() {
    const mobile = isMobile();
    const eps = mobile ? 0.016 : 0.008;   // coarser step on phones = fewer decodes
    for (let i = 0; i < N; i++) {
      const sc = scenes[i];
      if (!sc.ready || !sc.video) continue;
      // Only drive what is actually on screen. Seeking an invisible clip costs
      // exactly as much as seeking a visible one, and on a phone those wasted
      // decodes are taken straight out of the one the viewer is looking at.
      if (!sc.visible) { sc.cur = sc.target; continue; }
      if (sc.video.seeking) continue;                       // coalesce — see header

      // During the scripted intro we drive the clip as fast as the decoder will
      // go: the smoothing that makes hand-scrolling feel good would leave the
      // monogram several seconds behind its own reveal.
      sc.cur += (sc.target - sc.cur) * (introActive ? 1 : 0.18);
      const dur = sc.video.duration || 1;
      const t = clamp(sc.cur, 0, 0.999) * dur;
      if (Math.abs(sc.video.currentTime - t) > eps) {
        try { sc.video.currentTime = t; } catch (e) {}
      }
    }
    requestAnimationFrame(frame);
  }

  let introActive = false;

  /* -- iOS priming ---------------------------------------------------------- */
  function prime(v) {
    if (!isMobile() || !v || v._primed) return;
    v._primed = true;
    try {
      const p = v.play();
      if (p && p.then) {
        p.then(() => { try { v.pause(); } catch (e) {} })
         .catch(() => { v._primed = false; });   // let a later gesture retry
      }
    } catch (e) { v._primed = false; }
  }
  // iOS grants playback on a *transient* user activation, so a clip that loads
  // later is outside the window the first touch opened. Re-prime on every
  // gesture instead of once — it is a no-op for anything already primed.
  function onGesture() { scenes.forEach((sc) => prime(sc.video)); }
  addEventListener('pointerdown', onGesture, { passive: true });
  addEventListener('touchstart', onGesture, { passive: true });
  addEventListener('touchend', onGesture, { passive: true });

  /* -- wiring --------------------------------------------------------------- */
  addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(read); }
  }, { passive: true });

  // Mobile browsers fire `resize` whenever the URL bar slides. Re-running layout
  // there rebuilds the track height and yanks the scroll position, so on touch we
  // only relayout when the width actually changed (rotation still arrives via
  // orientationchange).
  addEventListener('resize', () => {
    if (coarse && innerWidth === laidOutW) return;
    layout();
  });
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

  /* -- opening curtain ------------------------------------------------------ */
  // Hold the ivory curtain until the first scene can actually carry the screen,
  // so nobody ever sees an empty stage. Poster is enough; video is a bonus.
  const curtain = $('.curtain');
  let lifted = false;
  function lift() {
    if (lifted) return;
    lifted = true;
    curtain.classList.add('is-up');
    setTimeout(() => curtain.remove(), 1400);
  }
  if (scenes[0].img.complete) setTimeout(lift, 900);
  else scenes[0].img.addEventListener('load', () => setTimeout(lift, 700));
  setTimeout(lift, 6000);   // never trap the visitor behind a slow asset

  /* -- the opening flight --------------------------------------------------- */
  /* Once the curtain is up we fly the first scene ourselves, slowly, so the
     monogram draws itself without the visitor having to do anything — then stop
     and hand over. Any real scroll intent aborts it instantly: this must never
     fight someone who has decided to move. */
  function autoIntro() {
    if (reduce) return;
    const sc = scenes[0];
    const target = sc.start + (sc.end - sc.start) * 0.93;   // monogram complete
    const DUR = 8500;
    let t0 = null, stop = false;

    const cancel = () => {
      if (stop) return;
      stop = true;
      introActive = false;
      removeEventListener('wheel', cancel);
      removeEventListener('touchmove', cancel);
      removeEventListener('keydown', cancel);
    };
    addEventListener('wheel', cancel, { passive: true });
    addEventListener('touchmove', cancel, { passive: true });
    addEventListener('keydown', cancel);

    function step(ts) {
      if (stop) return;
      if (t0 === null) t0 = ts;
      const p = clamp((ts - t0) / DUR);
      // ease-in-out: drifts away from rest, and arrives at rest
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      scrollTo(0, target * e);
      if (p < 1) requestAnimationFrame(step); else cancel();
    }
    introActive = true;
    requestAnimationFrame(step);
  }

  /* Don't start flying before the clip can answer — otherwise the scroll runs
     the whole way while the decoder is still opening the file, and the monogram
     draws itself long after the camera has stopped. */
  function whenFirstClipReady(fn, waited) {
    waited = waited || 0;
    if (scenes[0].ready || waited > 8000) fn();
    else setTimeout(() => whenFirstClipReady(fn, waited + 120), 120);
  }
  // Only from a cold start at the top — never yank someone who reloaded midway
  // or followed a link with a restored scroll position.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  addEventListener('load', () => {
    if ((scrollY || pageYOffset) >= 4) return;
    whenFirstClipReady(() => {
      if ((scrollY || pageYOffset) < 4) setTimeout(autoIntro, 700);
    });
  });

  window.FILM = { scenes, layout, read, isMobile };
})();

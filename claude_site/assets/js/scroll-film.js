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
    img.src = s.poster;
    img.alt = '';
    img.decoding = 'async';
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
  function loadClip(sc) {
    // Under reduced motion we never fetch video at all: the posters stay up and
    // simply cross-dissolve. No decode cost, no scrubbed motion.
    if (reduce || sc.loading) return;
    sc.loading = true;
    const url = (isMobile() && sc.cfg.clipMobile) ? sc.cfg.clipMobile : sc.cfg.clip;

    fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status))))
      .then((blob) => {
        const v = document.createElement('video');
        v.className = 'scene__video';
        v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
        v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
        v.src = URL.createObjectURL(blob);

        v.addEventListener('loadedmetadata', () => { sc.ready = true; read(); });
        v.addEventListener('loadeddata', () => {
          try { v.pause(); } catch (e) {}
          if (userReady) prime(v);
        });
        // Only drop the poster once a real frame has actually painted.
        v.addEventListener('seeked', () => {
          sc.painted = true;
          sc.el.classList.add('has-clip');
        }, { once: true });

        sc.el.appendChild(v);
        sc.video = v;
      })
      .catch(() => { sc.loading = false; });   // poster carries the scene
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

    let ci = 0;
    for (let i = 0; i < N; i++) if (y >= scenes[i].start) ci = i;

    for (let i = 0; i < N; i++) {
      const sc = scenes[i];
      // Prefetch anything within ~1.5 screens of the viewport.
      if (y > sc.start - 1.5 * vh && y < sc.end + 1.5 * vh) loadClip(sc);

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
      sc.el.style.opacity = op;
      sc.visible = op > 0.001;
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
      c.style.transform = reduce ? 'none' : 'translateY(' + ((1 - cop) * 1.6).toFixed(2) + 'vh)';
      // Interactive scenes need a generous hit window, not a razor-thin peak.
      c.style.pointerEvents = cop > 0.55 ? 'auto' : 'none';
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
    const eps = isMobile() ? 0.022 : 0.008;   // coarser step on phones = fewer decodes
    for (let i = 0; i < N; i++) {
      const sc = scenes[i];
      if (!sc.ready || !sc.video) continue;
      if (sc.video.seeking) continue;                       // coalesce — see header
      if (!sc.visible && Math.abs(sc.cur - sc.target) < 0.002) continue;

      sc.cur += (sc.target - sc.cur) * 0.18;                // rAF smoothing
      const dur = sc.video.duration || 1;
      const t = clamp(sc.cur, 0, 0.999) * dur;
      if (Math.abs(sc.video.currentTime - t) > eps) {
        try { sc.video.currentTime = t; } catch (e) {}
      }
    }
    requestAnimationFrame(frame);
  }

  /* -- iOS priming ---------------------------------------------------------- */
  let userReady = false;
  function prime(v) {
    if (!isMobile() || !v) return;
    try {
      const p = v.play();
      if (p && p.then) p.then(() => { try { v.pause(); } catch (e) {} }).catch(() => {});
    } catch (e) {}
  }
  function onFirstGesture() {
    if (userReady) return;
    userReady = true;
    scenes.forEach((sc) => prime(sc.video));
  }
  addEventListener('pointerdown', onFirstGesture, { once: true, passive: true });
  addEventListener('touchstart', onFirstGesture, { once: true, passive: true });

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

  window.FILM = { scenes, layout, read, isMobile };
})();

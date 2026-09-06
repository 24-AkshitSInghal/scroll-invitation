/* ============================================================================
   scroll-film.js — stopped story navigation over one native video timeline
   ----------------------------------------------------------------------------
   A swipe, wheel gesture or key advances one intentional story stop. The
   film uses forward and reverse H.264 timelines that both play normally;
   there is no per-frame seeking, canvas painting or permanent animation loop.
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
  const lingerEase = (t, k) => (k ? (t -= 0.5, clamp(0.5 + t * (1 - k) + k * 4 * t * t * t)) : t);
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);

  const stage = $('.stage');
  const stagewrap = $('.stagewrap');
  const track = $('.track');
  const rail = $('.rail');
  const progress = $('.progress__fill');
  const roomCount = $('.room__count');
  const roomScene = $('.room__scene');
  const roomOf = $('.room__of');
  const forwardVideo = $('.film--forward');
  const reverseVideo = $('.film--reverse');
  const fallback = $('.film--fallback');
  const forwardPlayer = new Film.Player(forwardVideo, cfg.video);
  const reversePlayer = new Film.Player(reverseVideo, {
    ...cfg.video,
    high: cfg.video.reverseHigh,
    lite: cfg.video.reverseLite,
  });

  if (roomOf) roomOf.textContent = '/ ' + String(SECTIONS.length).padStart(2, '0');

  const clipOrder = [];
  SECTIONS.forEach((s) => { if (!clipOrder.includes(s.clip)) clipOrder.push(s.clip); });
  const clips = new Map(clipOrder.map((name, i) => [name, i]));
  const frameCount = cfg.video.framesPerClip || cfg.frameCount || 56;
  const fps = cfg.video.fps || 24;
  const timelineLast = (clipOrder.length * frameCount - 1) / fps;
  const reverseTime = (time) => Math.max(0, timelineLast - time);

  function showDirection(backward) {
    forwardVideo.classList.toggle('is-active', !backward);
    reverseVideo.classList.toggle('is-active', backward);
  }

  let vh = innerHeight;
  let laidOutW = innerWidth;
  let total = 0;
  let viewY = 0;
  let activeIndex = -1;
  let cur = 0;
  let moving = false;
  let mediaFailed = false;

  const scenes = SECTIONS.map((s, i) => ({
    i, cfg: s, start: 0, end: 0,
    w: s.scroll || cfg.diveScroll,
    settle: s.settle || 1,
    linger: s.linger || 0,
  }));
  const copies = Array.from(document.querySelectorAll('.copy'));
  const fades = copies.map((copy) =>
    Array.from(copy.querySelectorAll('[data-fade]')).map((el) => ({
      el, r: el.dataset.fade.split(',').map(Number),
    }))
  );
  const stops = [];

  function sceneFrameAt(y) {
    let best = null;
    let bestOpacity = -1;
    const fade = (cfg.crossfade || 0.1) * vh;
    for (let i = 0; i < N; i++) {
      const sc = scenes[i];
      const local = clamp((y - sc.start) / (sc.end - sc.start));
      let outside = 0;
      if (y < sc.start) outside = sc.start - y;
      else if (y > sc.end) outside = y - sc.end;
      const opacity = smooth(1 - outside / fade);
      if (opacity > bestOpacity) {
        bestOpacity = opacity;
        const f0 = sc.cfg.from != null ? sc.cfg.from : 0;
        const f1 = sc.cfg.to != null ? sc.cfg.to : 1;
        const position = f0 + (f1 - f0) * clamp(lingerEase(local, sc.linger) / sc.settle);
        best = { scene: sc, position };
      }
    }
    return best;
  }

  function timelineTimeAt(y) {
    const found = sceneFrameAt(y);
    if (!found) return 0;
    const clip = clips.get(found.scene.cfg.clip) || 0;
    const frame = clip * frameCount + found.position * (frameCount - 1);
    return frame / fps;
  }

  function fallbackAt(y) {
    if (!stops.length || !cfg.video.posters || !cfg.video.posters.length) return;
    let nearest = 0;
    let distance = Infinity;
    stops.forEach((stop, i) => {
      const d = Math.abs(stop.y - y);
      if (d < distance) { distance = d; nearest = i; }
    });
    const src = cfg.video.posters[nearest];
    if (fallback.getAttribute('src') !== src) fallback.setAttribute('src', src);
  }

  function buildStops() {
    stops.length = 0;
    scenes.forEach((sc) => {
      const locals = sc.cfg.stops || [clamp(sc.cfg.copy ? sc.cfg.copy[1] : 0.5)];
      locals.forEach((local) => {
        const y = sc.start + (sc.end - sc.start) * clamp(local);
        stops.push({ y, sc, time: 0 });
      });
    });
    stops.sort((a, b) => a.y - b.y);
    stops.forEach((stop) => { stop.time = timelineTimeAt(stop.y); });
  }

  /* -- section rail ------------------------------------------------------- */
  SECTIONS.forEach((s, i) => {
    const button = document.createElement('button');
    button.className = 'rail__dot';
    button.type = 'button';
    button.setAttribute('aria-label', s.label);
    button.innerHTML = '<span class="rail__label">' + s.label + '</span>';
    button.addEventListener('click', () => {
      const at = stops.findIndex((stop) => stop.sc === scenes[i]);
      if (at >= 0 && !moving) goTo(at, Math.abs(at - cur) > 1);
    });
    rail.appendChild(button);
  });
  const dots = Array.from(rail.children);

  /* -- copy and chrome ---------------------------------------------------- */
  function read() {
    const y = viewY;
    const fade = (cfg.crossfade || 0.1) * vh;
    let sceneIndex = 0;
    for (let i = 0; i < N; i++) if (y >= scenes[i].start) sceneIndex = i;

    for (let i = 0; i < N; i++) {
      const sc = scenes[i];
      const local = clamp((y - sc.start) / (sc.end - sc.start));
      let outside = 0;
      if (y < sc.start) outside = sc.start - y;
      else if (y > sc.end) outside = y - sc.end;
      const sceneOpacity = smooth(1 - outside / fade);

      const copy = copies[i];
      const [i0, i1, o0, o1] = sc.cfg.copy || [0.2, 0.4, 0.75, 0.95];
      let opacity = smooth((local - i0) / (i1 - i0));
      if (o1 > o0) opacity = Math.min(opacity, smooth(1 - (local - o0) / (o1 - o0)));
      if (y < sc.start || y > sc.end) opacity = Math.min(opacity, sceneOpacity);
      opacity = Math.round(opacity * 1000) / 1000;

      if (opacity !== copy._op) { copy.style.opacity = opacity; copy._op = opacity; }
      const transform = (reduce || sc.cfg.anchored)
        ? 'none'
        : 'translate3d(0,' + ((1 - opacity) * 1.6).toFixed(2) + 'vh,0)';
      if (transform !== copy._tf) { copy.style.transform = transform; copy._tf = transform; }

      const live = opacity > 0.55;
      if (live !== copy._live) {
        copy.style.pointerEvents = live ? 'auto' : 'none';
        copy.classList.toggle('is-live', live);
        copy._live = live;
      }
      const visible = opacity > 0.002;
      if (visible !== copy._vis) {
        copy.style.visibility = visible ? 'visible' : 'hidden';
        copy._vis = visible;
      }

      for (const item of fades[i]) {
        const [a0, a1, b0, b1] = item.r;
        let own = smooth((local - a0) / (a1 - a0));
        if (b1 > b0) own = Math.min(own, smooth(1 - (local - b0) / (b1 - b0)));
        own = Math.round(own * 1000) / 1000;
        if (own !== item._op) { item.el.style.opacity = own; item._op = own; }
        const ownLive = own > 0.55;
        if (ownLive !== item._live) {
          item.el.style.pointerEvents = ownLive ? 'auto' : 'none';
          item._live = ownLive;
        }
      }
    }

    if (sceneIndex !== activeIndex) {
      activeIndex = sceneIndex;
      dots.forEach((dot, i) => dot.classList.toggle('is-active', i === sceneIndex));
      document.body.dataset.scene = SECTIONS[sceneIndex].id;
      if (roomCount) roomCount.textContent = String(sceneIndex + 1).padStart(2, '0');
      if (roomScene) roomScene.textContent = SECTIONS[sceneIndex].label;
    }
    if (progress) progress.style.transform = 'scaleY(' + clamp(total ? y / (total * vh) : 0) + ')';
    document.documentElement.classList.toggle('is-scrolled', cur > 0);
  }

  function settleAt(index) {
    cur = index;
    viewY = stops[index].y;
    fallbackAt(viewY);
    read();
    moving = false;
  }

  function syncMedia(time) {
    return Promise.all([
      forwardPlayer.seek(time),
      reversePlayer.seek(reverseTime(time)),
    ]);
  }

  async function goTo(index, instant) {
    index = Math.max(0, Math.min(stops.length - 1, Math.round(index)));
    if (!stops.length || moving || index === cur) return;

    const previous = cur;
    const backward = index < previous;
    const fromY = viewY;
    const toY = stops[index].y;
    const fromTime = timelineTimeAt(fromY);
    const toTime = stops[index].time;
    cur = index;
    moving = true;

    const bothReady = forwardPlayer.ready && reversePlayer.ready;
    const mustSeek = instant || reduce || mediaFailed || !bothReady;
    if (mustSeek) {
      if (bothReady && !mediaFailed) await syncMedia(toTime);
      showDirection(backward);
      settleAt(index);
      return;
    }

    try {
      const activePlayer = backward ? reversePlayer : forwardPlayer;
      const startMediaTime = backward ? reverseTime(fromTime) : fromTime;
      const endMediaTime = backward ? reverseTime(toTime) : toTime;
      await activePlayer.seek(startMediaTime);
      showDirection(backward);
      await activePlayer.playTo(endMediaTime, (now) => {
        const timelineNow = backward ? reverseTime(now) : now;
        const p = clamp((timelineNow - fromTime) / (toTime - fromTime));
        viewY = fromY + (toY - fromY) * p;
        read();
      });
      await syncMedia(toTime);
      settleAt(index);

      // If a device cannot present even this conservative video reliably, stop
      // animating rather than repeatedly making the visitor endure dropped
      // frames. Navigation still works using exact static frames.
      const quality = activePlayer.quality();
      if (quality && quality.total >= 48 && quality.dropped / quality.total > 0.12) {
        mediaFailed = true;
        stage.classList.add('film-static');
      }
    } catch (e) {
      // Only a real media failure earns the static fallback; an interrupted
      // transition just lands on the stop it was heading for.
      if (!e || !e.aborted) {
        mediaFailed = true;
        stage.classList.add('film-static');
      } else if (forwardPlayer.ready && reversePlayer.ready) {
        await syncMedia(stops[index].time).catch(() => {});
        showDirection(false);
      }
      settleAt(index);
    }
  }

  /* Leaving the page mid-transition pauses the media clock and stops rAF. End
     the flight deliberately rather than letting it hang until a timeout decides
     the device is at fault, and put both timelines back on the current stop on
     return so the next move starts from the right frame. */
  addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (moving) { forwardPlayer.cancel(); reversePlayer.cancel(); }
      return;
    }
    if (moving || mediaFailed || !forwardPlayer.ready || !reversePlayer.ready) return;
    syncMedia(stops[cur].time).catch(() => {});
  });

  addEventListener('keydown', (event) => {
    if (event.target && event.target.closest && event.target.closest('input,textarea,select')) return;
    if (moving) return;
    if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault(); goTo(cur + 1);
    } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault(); goTo(cur - 1);
    } else if (event.key === 'Home') {
      event.preventDefault(); goTo(0, true);
    } else if (event.key === 'End') {
      event.preventDefault(); goTo(stops.length - 1, true);
    }
  });

  // Touch is interpreted only after the finger lifts, so no expensive work runs
  // in the browser's input-critical path. Form controls keep normal behaviour.
  let touchStart = null;
  stage.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || event.target.closest('input,textarea,select,button,a')) return;
    const t = event.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  stage.addEventListener('touchend', (event) => {
    if (!touchStart || moving || !event.changedTouches.length) { touchStart = null; return; }
    const t = event.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dy) < 28 || Math.abs(dy) < Math.abs(dx) * 1.15) return;
    goTo(cur + (dy < 0 ? 1 : -1));
  }, { passive: true });
  stage.addEventListener('touchcancel', () => { touchStart = null; }, { passive: true });

  let wheelAmount = 0;
  let wheelEnd = 0;
  let wheelLocked = false;
  stage.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    clearTimeout(wheelEnd);
    wheelEnd = setTimeout(() => {
      wheelAmount = 0;
      wheelLocked = false;
    }, 320);
    if (moving || wheelLocked) return;
    wheelAmount += event.deltaY;
    if (Math.abs(wheelAmount) >= 36) {
      const direction = wheelAmount > 0 ? 1 : -1;
      wheelAmount = 0;
      wheelLocked = true;
      goTo(cur + direction);
    }
  }, { passive: false });

  /* -- viewport geometry -------------------------------------------------- */
  function mapVideoSpace() {
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (!sw || !sh) return;
    const scale = Math.max(sw / 1080, sh / 1920);
    const width = 1080 * scale;
    const height = 1920 * scale;
    stage.style.setProperty('--vx', ((sw - width) / 2) + 'px');
    stage.style.setProperty('--vy', ((sh - height) / 2) + 'px');
    stage.style.setProperty('--vw', width + 'px');
    stage.style.setProperty('--vh', height + 'px');
  }

  function viewportH() {
    return Math.round(window.visualViewport ? visualViewport.height : innerHeight);
  }

  function measure() {
    const height = viewportH();
    stagewrap.style.height = height + 'px';
    document.documentElement.style.setProperty('--vph', height + 'px');
    mapVideoSpace();
  }

  function layout() {
    vh = viewportH();
    laidOutW = innerWidth;
    measure();
    let offset = 0;
    scenes.forEach((scene) => {
      scene.start = offset * vh;
      offset += scene.w;
      scene.end = offset * vh;
    });
    total = offset;
    track.style.height = '0px';
    buildStops();
    viewY = stops.length ? stops[Math.min(cur, stops.length - 1)].y : 0;
    fallbackAt(viewY);
    read();
  }

  let measureFrame = 0;
  function queueMeasure() {
    if (measureFrame) return;
    measureFrame = requestAnimationFrame(() => { measureFrame = 0; measure(); });
  }
  addEventListener('resize', () => {
    if (innerWidth !== laidOutW) layout();
    else queueMeasure();
  });
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', queueMeasure);
    visualViewport.addEventListener('scroll', queueMeasure);
  }
  addEventListener('orientationchange', () => setTimeout(layout, 120));

  if (reduce) document.documentElement.classList.add('is-reduced');
  if (/[?&]grid\b/.test(location.search)) document.documentElement.classList.add('is-grid');
  layout();

  /* -- invitation gate ---------------------------------------------------- */
  const curtain = $('.curtain');
  const bar = $('.curtain__fill');
  const pct = $('.curtain__pct');
  const openBtn = $('.curtain__open');
  let opened = false;

  function showProgress(value) {
    const p = clamp(value);
    if (bar) bar.style.transform = 'scaleX(' + p.toFixed(3) + ')';
    if (pct) pct.textContent = Math.round(p * 100) + '%';
  }

  function readyGate() {
    curtain.classList.add('is-ready');
    if (pct) pct.textContent = '';
  }

  function open() {
    if (opened || !curtain.classList.contains('is-ready')) return;
    opened = true;
    curtain.classList.add('is-up');
    document.documentElement.classList.remove('is-locked');
    setTimeout(() => { if (curtain.parentNode) curtain.remove(); }, 1200);
    window.dispatchEvent(new CustomEvent('invitation:open'));
    fallbackAt(viewY);
    read();
  }

  document.documentElement.classList.add('is-locked');
  openBtn.addEventListener('click', open);

  if (reduce) {
    mediaFailed = true;
    stage.classList.add('film-static');
    showProgress(1);
    readyGate();
  } else {
    const loads = [0, 0];
    const report = (which, value) => {
      loads[which] = value;
      showProgress((loads[0] + loads[1]) / 2);
    };
    Promise.all([
      forwardPlayer.prepare((value) => report(0, value)),
      reversePlayer.prepare((value) => report(1, value)),
    ])
      .then(() => syncMedia(stops[0].time))
      .then(() => {
        showDirection(false);
        stage.classList.add('film-ready');
        readyGate();
      })
      .catch(() => {
        mediaFailed = true;
        stage.classList.add('film-static');
        showProgress(1);
        readyGate();
      });
  }

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  addEventListener('pagehide', () => {
    forwardPlayer.destroy();
    reversePlayer.destroy();
  }, { once: true });

  window.FILM = {
    scenes, stops, layout, read, isMobile, goTo,
    at: () => cur,
    y: () => viewY,
    moving: () => moving,
    media: () => ({
      mode: forwardPlayer.mode,
      failed: mediaFailed,
      forward: forwardPlayer.quality(),
      reverse: reversePlayer.quality(),
    }),
  };
})();

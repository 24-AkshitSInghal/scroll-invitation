/* ============================================================================
   interactions.js — the parts of the invitation the visitor touches
     · scratch-to-reveal medallion (scene 4)
     · live countdown + Add to Calendar (scene 5)
     · Open Map (scene 6)
     · RSVP form (scene 7)
   ========================================================================== */

(function () {
  'use strict';

  const cfg = window.INVITE;
  const $ = (s, c) => (c || document).querySelector(s);

  /* ------------------------------------------------------------------ zoom */
  // iOS has ignored user-scalable=no since iOS 10, so the viewport meta alone
  // does not hold. Cancelling Safari's own gesture events is what actually stops
  // a pinch, and blocking the second tap of a double-tap stops that zoom too.
  // Both are deliberate: the layout is measured against a 9:16 frame and every
  // overlay is pinned to painted artwork, so a zoom pulls them off their marks.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((g) => {
    document.addEventListener(g, (e) => e.preventDefault(), { passive: false });
  });
  let lastTap = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 320 && e.touches.length === 0) e.preventDefault();
    lastTap = now;
  }, { passive: false });

  /* ---------------------------------------------------------------- scratch */
  // A canvas of gold foil sits exactly over the medallion's blank centre. The
  // visitor rubs it away with destination-out arcs; once enough is cleared we
  // dissolve the remainder so nobody has to scrub every last pixel.
  (function scratchCard() {
    const wrap = $('.scratch');
    const canvas = $('.scratch__foil');
    if (!wrap || !canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const skip = document.querySelector('.scratch__skip');
    let sized = false, drawing = false, done = false, since = 0, last = null;

    function paintFoil() {
      const r = wrap.getBoundingClientRect();
      if (r.width < 4) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // The foil is struck from the page's own gold ramp rather than one-off
      // hex values, so it stays in step if the palette is ever retuned:
      // --gold-deep -> --gold -> --gold-soft -> --gold-bright, with --cream as
      // the sheen raking across the middle.
      const root = getComputedStyle(document.documentElement);
      const tok = (n, fb) => (root.getPropertyValue(n).trim() || fb);
      const DEEP   = tok('--gold-deep',   '#8a6830');
      const GOLD   = tok('--gold',        '#b8934c');
      const SOFT   = tok('--gold-soft',   '#d9bd85');
      const BRIGHT = tok('--gold-bright', '#e7cf9a');
      const CREAM  = tok('--cream',       '#fffaf2');

      const g = ctx.createLinearGradient(0, 0, r.width, r.height);
      g.addColorStop(0.00, DEEP);
      g.addColorStop(0.13, GOLD);
      g.addColorStop(0.28, SOFT);
      g.addColorStop(0.41, BRIGHT);
      g.addColorStop(0.48, CREAM);     // sheen
      g.addColorStop(0.56, BRIGHT);
      g.addColorStop(0.68, SOFT);
      g.addColorStop(0.80, GOLD);
      g.addColorStop(0.92, SOFT);
      g.addColorStop(1.00, DEEP);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, r.width, r.height);

      // A soft radial lift so the disc reads as domed rather than printed flat.
      const rgba = (hex, a) => {
        const h = hex.replace('#', '');
        const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
        return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
      };
      const rg = ctx.createRadialGradient(r.width * 0.4, r.height * 0.34, 0,
                                          r.width * 0.5, r.height * 0.5, r.width * 0.72);
      rg.addColorStop(0, rgba(CREAM, 0.34));
      rg.addColorStop(1, rgba(DEEP, 0.30));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, r.width, r.height);

      // A little grain so the foil doesn't read as flat vector fill.
      ctx.globalAlpha = 0.06;
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = i % 2 ? CREAM : DEEP;
        ctx.fillRect(Math.random() * r.width, Math.random() * r.height, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
      sized = true;
    }

    function pt(e) {
      const r = canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return { x: p.clientX - r.left, y: p.clientY - r.top };
    }

    function scratch(a, b) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = Math.max(28, canvas.width / 12);
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }

    function cleared() {
      const step = 12;
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let clear = 0, seen = 0;
      for (let i = 3; i < d.length; i += 4 * step) { seen++; if (d[i] < 24) clear++; }
      return seen ? clear / seen : 0;
    }

    function finish() {
      if (done) return;
      done = true;
      // Fling the petal sparks outward on their own angles before the class
      // that runs the animation lands.
      const burst = wrap.querySelector('.scratch__burst');
      if (burst) {
        const sparks = burst.children, n = sparks.length;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
          const d = 42 + Math.random() * 46;                 // % of the disc radius
          const st = sparks[i].style;
          st.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + '%');
          st.setProperty('--dy', (Math.sin(a) * d).toFixed(1) + '%');
          st.setProperty('--r', (140 + Math.random() * 260).toFixed(0) + 'deg');
          st.animationDelay = (Math.random() * 0.18).toFixed(2) + 's';
        }
      }
      wrap.classList.add('is-revealed');
      if (skip) skip.classList.add('is-done');
    }

    /* The foil covers most of the screen, so it cannot simply claim every
       gesture that starts on it — that is what left the page unable to scroll.
       A drag stays undecided until it has moved enough to show intent: mostly
       sideways is a scratch, mostly vertical is the visitor trying to scroll, and
       we let it go. `touch-action: pan-y` means the browser is already scrolling
       in that case, and sends us a pointercancel. */
    const INTENT = 8;            // px of travel before deciding
    let origin = null;

    function start(e) {
      if (done) return;
      if (!sized) paintFoil();
      origin = pt(e);
      last = origin;
      drawing = 'pending';
      // no preventDefault yet — the gesture might belong to the page
    }
    function move(e) {
      if (!drawing || done) return;
      const p = pt(e);

      if (drawing === 'pending') {
        const dx = Math.abs(p.x - origin.x), dy = Math.abs(p.y - origin.y);
        if (dx < INTENT && dy < INTENT) { last = p; return; }
        if (dy > dx) { drawing = false; return; }      // theirs, not ours
        drawing = true;
        wrap.classList.add('is-touched');
      }

      scratch(last, p);
      last = p;
      if (++since > 8) { since = 0; if (cleared() > 0.5) finish(); }
      e.preventDefault();
    }
    function end() {
      const wasDrawing = drawing === true;
      drawing = false; origin = null;
      if (wasDrawing && !done && cleared() > 0.42) finish();
    }

    canvas.addEventListener('pointerdown', start);
    addEventListener('pointermove', move, { passive: false });
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);

    // Keyboard / assistive path — nobody should be locked out by a rub gesture.
    if (skip) skip.addEventListener('click', finish);

    new ResizeObserver(() => { if (!done) { sized = false; paintFoil(); } }).observe(wrap);
    paintFoil();
    // The wrap only gets real dimensions once the stage lays out.
    addEventListener('load', () => { if (!done) { sized = false; paintFoil(); } });
  })();

  /* -------------------------------------------------------------- countdown */
  (function countdown() {
    const host = $('.countdown');
    if (!host) return;
    const target = new Date(cfg.event.startUTC.replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'
    ));
    const cells = [
      ['days', 'Days'], ['hours', 'Hours'], ['mins', 'Minutes'], ['secs', 'Seconds'],
    ].map(([k, label]) => {
      const c = document.createElement('div');
      c.className = 'countdown__cell';
      c.innerHTML = '<b data-k="' + k + '">--</b><span>' + label + '</span>';
      host.appendChild(c);
      return c.querySelector('b');
    });

    function tick() {
      let d = target - Date.now();
      if (d <= 0) { host.classList.add('is-past'); cells.forEach((c) => (c.textContent = '00')); return; }
      d = Math.floor(d / 1000);
      const v = [Math.floor(d / 86400), Math.floor(d / 3600) % 24, Math.floor(d / 60) % 60, d % 60];
      cells.forEach((c, i) => (c.textContent = String(v[i]).padStart(2, '0')));
    }
    tick();
    setInterval(tick, 1000);
  })();

  /* ------------------------------------------------------- add to calendar */
  (function calendar() {
    const btn = $('.js-cal');
    if (!btn) return;
    const e = cfg.event, v = cfg.venue;
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ShubhMilan//Invitation//EN',
      'BEGIN:VEVENT',
      'UID:shubhmilan-' + e.dateISO + '@invitation',
      'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
      'DTSTART:' + e.startUTC,
      'DTEND:' + e.endUTC,
      'SUMMARY:' + e.name + ' — ' + cfg.couple.shortGroom + ' & ' + cfg.couple.shortBride,
      'LOCATION:' + [v.name].concat(v.lines).join(', ').replace(/,/g, '\\,'),
      'DESCRIPTION:' + cfg.hashtag,
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');

    btn.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    btn.setAttribute('download', 'ShubhMilan-21-Sep-2026.ics');
  })();

  /* -------------------------------------------------------------- open map */
  (function map() {
    const btn = $('.js-map');
    if (!btn) return;
    btn.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(cfg.venue.mapQuery);
    btn.target = '_blank';
    btn.rel = 'noopener';
  })();

  /* ----------------------------------------------------------------- music */
  // The song plays from the moment it is allowed to and keeps playing until the
  // visitor mutes it. iOS and Chrome both refuse un-muted autoplay before any
  // interaction and there is no way around that — so we ask immediately, and if
  // refused we arm every plausible first gesture (including the scroll that
  // starts the film) and take the first one that lands. Only an explicit mute
  // stops it, and that choice is remembered.
  (function music() {
    const btn = $('.music');
    if (!btn || !cfg.music) return;

    const KEY = 'shubhmilan.muted';
    let mutedByUser = false;
    try { mutedByUser = localStorage.getItem(KEY) === '1'; } catch (e) {}

    const a = new Audio();
    a.loop = true;
    a.preload = 'metadata';
    a.volume = 0;
    a.src = a.canPlayType('audio/mp4') ? cfg.music.src : cfg.music.srcFallback;

    const TARGET = cfg.music.volume != null ? cfg.music.volume : 0.55;
    let fade = null;

    function rampTo(v, ms) {
      clearInterval(fade);
      const from = a.volume, steps = Math.max(1, Math.round(ms / 50));
      let i = 0;
      fade = setInterval(() => {
        i++;
        a.volume = Math.min(1, Math.max(0, from + (v - from) * (i / steps)));
        if (i >= steps) { clearInterval(fade); if (v === 0) a.pause(); }
      }, 50);
    }

    function paint(on) {
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', on ? 'Mute music' : 'Play music');
    }
    paint(false);

    function start() {
      if (mutedByUser) return Promise.resolve(false);
      return a.play()
        .then(() => { paint(true); rampTo(TARGET, 1400); return true; })
        .catch(() => { paint(false); return false; });
    }

    // Keep listening until something actually starts it. Browsers only lift the
    // block on a real gesture, and which gesture that is varies by browser, so
    // we listen for all of them rather than betting on one.
    const GESTURES = ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown', 'scroll', 'wheel'];
    function arm() {
      const go = () => {
        if (mutedByUser) { disarm(); return; }
        start().then((ok) => { if (ok) disarm(); });
      };
      function disarm() { GESTURES.forEach((g) => removeEventListener(g, go)); }
      GESTURES.forEach((g) => addEventListener(g, go, { passive: true }));
      return disarm;
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (a.paused) {
        mutedByUser = false;
        try { localStorage.setItem(KEY, '0'); } catch (err) {}
        start();
      } else {
        mutedByUser = true;
        try { localStorage.setItem(KEY, '1'); } catch (err) {}
        paint(false);
        rampTo(0, 450);
      }
    });

    // Opening the invitation is a real user gesture — the one moment iOS will
    // reliably allow audio — so take it. The load attempt and the gesture net
    // stay as well, for anyone who lands past the gate.
    addEventListener('invitation:open', () => { if (!mutedByUser) start(); });
    start().then((ok) => { if (!ok) arm(); });

    // Pause while the tab is away, resume on return — unless it was muted.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (!a.paused) { a.pause(); btn.dataset.auto = '1'; } }
      else if (btn.dataset.auto) { delete btn.dataset.auto; if (!mutedByUser) start(); }
    });
  })();

  /* ------------------------------------------------------------------ rsvp */
  (function rsvpForm() {
    const form = $('.rsvp__form');
    if (!form) return;
    const done = $('.rsvp__done');
    const doneName = $('.rsvp__done-name');
    const btn = form.querySelector('button[type=submit]');
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      if (!data.name || !data.name.trim()) {
        form.querySelector('[name=name]').focus();
        return;
      }
      data.submittedAt = new Date().toISOString();

      btn.disabled = true;
      btn.textContent = 'Sending…';

      const finish = (ok) => {
        // Never lose a response to a network hiccup — keep a local copy either way.
        try {
          const all = JSON.parse(localStorage.getItem('shubhmilan.rsvp') || '[]');
          all.push(Object.assign({ delivered: ok }, data));
          localStorage.setItem('shubhmilan.rsvp', JSON.stringify(all));
        } catch (e) {}
        doneName.textContent = data.name.trim().split(/\s+/)[0];
        form.hidden = true;
        done.hidden = false;
      };

      if (cfg.rsvp.endpoint) {
        fetch(cfg.rsvp.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(data),
        }).then((r) => finish(r.ok)).catch(() => finish(false));
      } else {
        setTimeout(() => finish(false), 450);
      }
    });

    // Optional WhatsApp handoff, shown only when a number is configured.
    if (cfg.rsvp.whatsapp) {
      const wa = $('.js-wa');
      if (wa) {
        wa.href = 'https://wa.me/' + cfg.rsvp.whatsapp +
          '?text=' + encodeURIComponent('Hello! Regarding the engagement of ' +
            cfg.couple.shortGroom + ' & ' + cfg.couple.shortBride + ' on ' + cfg.event.dateLabel + ' — ');
        wa.target = '_blank';
        wa.rel = 'noopener';
        wa.hidden = false;
      }
    }
  })();
})();

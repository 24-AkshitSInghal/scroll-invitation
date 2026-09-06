/* ============================================================================
   interactions.js — the parts of the invitation the visitor touches
     · reveal-the-date medallion (scene 5)
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

  /* ----------------------------------------------------------------- date */
  /* A button in the middle of the medallion, not a scratch surface. The canvas
     covered ~74% of the screen and had to claim touch gestures to detect a rub,
     which meant a swipe that began on the medallion could not scroll the page —
     a delightful idea that quietly cost the thing the page exists to do. */
  (function revealDate() {
    const wrap = $('.reveal');
    if (!wrap) return;
    const btn = wrap.querySelector('.reveal__btn');
    let done = false;

    function open() {
      if (done) return;
      done = true;
      // fling the petal sparks outward on their own angles first
      const burst = wrap.querySelector('.reveal__burst');
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
    }

    if (btn) btn.addEventListener('click', open);
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

    /* The film's own ambience — the clips' audio, joined into one bed and
       looped underneath the song.

       It is a separate continuous track rather than the video's soundtrack
       because the video only plays in one- to three-second bursts between
       stops, and its reverse timeline plays backwards. Unmuting the element
       itself would give stuttering ambience forwards and reversed birdsong
       going back. A quiet bed under the music holds the room together instead,
       and answers to the same mute button. */
    const amb = cfg.ambience ? new Audio() : null;
    const AMB_TARGET = cfg.ambience && cfg.ambience.volume != null ? cfg.ambience.volume : 0.3;
    let ambFade = null;
    if (amb) {
      amb.loop = true;
      amb.preload = 'metadata';
      amb.volume = 0;
      amb.src = amb.canPlayType('audio/mp4') ? cfg.ambience.src : cfg.ambience.srcFallback;
    }

    function ambRampTo(v, ms) {
      if (!amb) return;
      clearInterval(ambFade);
      const from = amb.volume, steps = Math.max(1, Math.round(ms / 50));
      let i = 0;
      ambFade = setInterval(() => {
        i++;
        amb.volume = Math.min(1, Math.max(0, from + (v - from) * (i / steps)));
        if (i >= steps) { clearInterval(ambFade); if (v === 0) amb.pause(); }
      }, 50);
    }

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
      if (amb) amb.play().then(() => ambRampTo(AMB_TARGET, 2200)).catch(() => {});
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
        ambRampTo(0, 450);
      }
    });

    // Opening the invitation is a real user gesture — the one moment iOS will
    // reliably allow audio — so take it. The load attempt and the gesture net
    // stay as well, for anyone who lands past the gate.
    addEventListener('invitation:open', () => { if (!mutedByUser) start(); });
    start().then((ok) => { if (!ok) arm(); });

    // Pause while the tab is away, resume on return — unless it was muted.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (amb && !amb.paused) amb.pause();
        if (!a.paused) { a.pause(); btn.dataset.auto = '1'; }
      }
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
    const errorMessage = form.querySelector('.rsvp__error');
    const submitLabel = btn.textContent;
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
      if (errorMessage) errorMessage.hidden = true;

      const finish = (ok) => {
        // Never lose a response to a network hiccup — keep a local copy either way.
        try {
          const all = JSON.parse(localStorage.getItem('shubhmilan.rsvp') || '[]');
          all.push(Object.assign({ delivered: ok }, data));
          localStorage.setItem('shubhmilan.rsvp', JSON.stringify(all));
        } catch (e) {}

        if (!ok) {
          btn.disabled = false;
          btn.textContent = submitLabel;
          if (errorMessage) errorMessage.hidden = false;
          return;
        }

        doneName.textContent = data.name.trim().split(/\s+/)[0];
        form.hidden = true;
        done.hidden = false;

        /* Carry them onward once the thank-you has been read. Sending is the one
           moment the visitor has finished with a slide rather than merely
           arrived at it, so leaving them parked on a spent form is a dead end —
           but move too soon and the acknowledgement never lands. */
        setTimeout(() => {
          const film = window.FILM;
          if (!film || typeof film.goTo !== 'function') return;
          if (film.moving && film.moving()) return;
          const next = film.at() + 1;
          if (next < film.stops.length) film.goTo(next);
        }, 2200);
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

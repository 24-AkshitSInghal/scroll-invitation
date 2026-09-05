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

  /* ---------------------------------------------------------------- scratch */
  // A canvas of gold foil sits exactly over the medallion's blank centre. The
  // visitor rubs it away with destination-out arcs; once enough is cleared we
  // dissolve the remainder so nobody has to scrub every last pixel.
  (function scratchCard() {
    const wrap = $('.scratch');
    const canvas = $('.scratch__foil');
    if (!wrap || !canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let sized = false, drawing = false, done = false, since = 0, last = null;

    function paintFoil() {
      const r = wrap.getBoundingClientRect();
      if (r.width < 4) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const g = ctx.createLinearGradient(0, 0, r.width, r.height);
      g.addColorStop(0.00, '#e7cf9a');
      g.addColorStop(0.22, '#f6e7c3');
      g.addColorStop(0.45, '#cfae6d');
      g.addColorStop(0.68, '#f3e2ba');
      g.addColorStop(1.00, '#c9a55f');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, r.width, r.height);

      // A little grain so the foil doesn't read as flat vector fill.
      ctx.globalAlpha = 0.06;
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = i % 2 ? '#fff' : '#8a6b2a';
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
      wrap.classList.add('is-revealed');
      // Confetti of petals on reveal — small, one-shot, purely decorative.
      const burst = $('.scratch__burst');
      if (burst) burst.classList.add('is-on');
    }

    function start(e) {
      if (done) return;
      if (!sized) paintFoil();
      drawing = true; last = pt(e);
      wrap.classList.add('is-touched');
      e.preventDefault();
    }
    function move(e) {
      if (!drawing || done) return;
      const p = pt(e);
      scratch(last, p);
      last = p;
      if (++since > 8) { since = 0; if (cleared() > 0.5) finish(); }
      e.preventDefault();
    }
    function end() {
      if (!drawing) return;
      drawing = false;
      if (!done && cleared() > 0.42) finish();
    }

    canvas.addEventListener('pointerdown', start);
    addEventListener('pointermove', move, { passive: false });
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);

    // Keyboard / assistive path — nobody should be locked out by a rub gesture.
    const skip = $('.scratch__skip');
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

  /* ------------------------------------------------------------------ rsvp */
  (function rsvpForm() {
    const form = $('.rsvp__form');
    if (!form) return;
    const done = $('.rsvp__done');
    const doneName = $('.rsvp__done-name');
    const btn = form.querySelector('button[type=submit]');
    const guestsRow = $('.js-guests-row');

    // "Regretfully no" shouldn't ask how many seats to hold.
    form.addEventListener('change', (e) => {
      if (e.target.name === 'attending') {
        guestsRow.hidden = e.target.value === 'no';
      }
    });

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

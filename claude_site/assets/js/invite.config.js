/* ============================================================================
   ShubhMilan — invitation content + film configuration
   ----------------------------------------------------------------------------
   Everything the client can edit lives here. The engine (scroll-film.js) reads
   this and never hard-codes copy.

   Each section maps 1:1 to one rendered clip. The clips were generated as a
   single chained flight (clip N starts on clip N-1's actual last frame), so
   consecutive scenes are frame-identical at the seam — the engine only needs a
   hairline dissolve to hide the decoder handoff, never a real transition.

   Per-section knobs
     scroll : viewport-heights of scroll this scene occupies (more = slower)
     settle : 0..1 — the clip reaches its FINAL frame at this point in the band
              and holds there for the rest of it. Used for the scenes the
              visitor has to interact with (scratch card, RSVP) so the artwork
              is locked still under their finger.
     copy   : [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd] in local 0..1
   ========================================================================== */

window.INVITE = {

  /* -- who, what, where ---------------------------------------------------- */
  couple: {
    groom: 'Dr. Shubhanu Tayal',
    bride: 'Dr. Shubhangi Bansal',
    shortGroom: 'Dr. Shubhanu',
    shortBride: 'Dr. Shubhangi',
  },
  hashtag: '#ShubhMilan',

  event: {
    name: 'Engagement & Roka Ceremony',
    dateISO: '2026-09-21',
    dateLabel: '21 September 2026',
    timeLabel: '5:00 PM onwards',
    startUTC: '20260921T113000Z',      // 5:00 PM IST
    endUTC:   '20260921T163000Z',      // 10:00 PM IST
  },

  venue: {
    name: 'The Mansion Banquet',
    lines: [
      '38/3, R.A., Near F Headquarter Road',
      "NH58, Ansal's Sushant City",
      'Meerut, Uttar Pradesh',
    ],
    mapQuery: "The Mansion Banquet, 38/3 R.A, Near F Headquarter Road, NH58, Ansal's Sushant City, Meerut, Uttar Pradesh",
  },

  /* RSVP — drop a POST endpoint in here when you have one (Formspree, Google
     Apps Script, your own API…). Until then the form validates, confirms and
     keeps the response in localStorage so nothing is lost on the client side. */
  rsvp: {
    endpoint: null,
    deadlineLabel: 'Kindly respond by 10 September 2026',
    whatsapp: null,                    // e.g. '919876543210' — adds a WhatsApp fallback
  },

  /* -- the film ------------------------------------------------------------ */
  diveScroll: 1.45,        // default viewport-heights per scene
  crossfade: 0.10,         // seam dissolve width, in viewport-heights

  sections: [
    {
      id: 'open', label: 'Welcome', kind: 'open',
      clip: 'assets/video/c1.mp4', clipMobile: 'assets/video/c1-m.mp4',
      poster: 'assets/poster/c1.jpg',
      scroll: 1.9, settle: 0.88, copy: [-0.05, -0.01, 1, 1],
      place: 'lower',
    },
    {
      id: 'couple', label: 'The Couple', kind: 'couple',
      clip: 'assets/video/c2.mp4', clipMobile: 'assets/video/c2-m.mp4',
      poster: 'assets/poster/c2.jpg',
      scroll: 1.6, settle: 0.82, copy: [0.34, 0.52, 0.90, 1],
      place: 'center',
    },
    {
      id: 'family', label: 'Our Families', kind: 'family',
      clip: 'assets/video/c3.mp4', clipMobile: 'assets/video/c3-m.mp4',
      poster: 'assets/poster/c3.jpg',
      scroll: 1.6, settle: 0.80, copy: [0.36, 0.54, 0.90, 1],
      place: 'center',
    },
    {
      id: 'savethedate', label: 'Save the Date', kind: 'scratch',
      clip: 'assets/video/c4.mp4', clipMobile: 'assets/video/c4-m.mp4',
      poster: 'assets/poster/c4.jpg',
      scroll: 2.5, settle: 0.42, copy: [0.42, 0.54, 1, 1],
      place: 'fill',
    },
    {
      id: 'ceremony', label: 'The Ceremony', kind: 'ceremony',
      clip: 'assets/video/c5.mp4', clipMobile: 'assets/video/c5-m.mp4',
      poster: 'assets/poster/c5.jpg',
      scroll: 1.9, settle: 0.74, copy: [0.34, 0.52, 0.94, 1],
      place: 'center',
    },
    {
      id: 'venue', label: 'The Venue', kind: 'venue',
      clip: 'assets/video/c6.mp4', clipMobile: 'assets/video/c6-m.mp4',
      poster: 'assets/poster/c6.jpg',
      scroll: 2.0, settle: 0.68, copy: [0.40, 0.56, 0.96, 1],
      place: 'lower',
    },
    {
      id: 'rsvp', label: 'RSVP', kind: 'rsvp',
      clip: 'assets/video/c7.mp4', clipMobile: 'assets/video/c7-m.mp4',
      poster: 'assets/poster/c7.jpg',
      scroll: 2.8, settle: 0.38, copy: [0.38, 0.50, 1, 1],
      place: 'fill',
    },
    {
      id: 'blessing', label: 'Blessings', kind: 'finale',
      clip: 'assets/video/c8.mp4', clipMobile: 'assets/video/c8-m.mp4',
      poster: 'assets/poster/c8.jpg',
      scroll: 2.0, settle: 0.72, copy: [0.44, 0.62, 1, 1],
      place: 'center',
    },
  ],
};

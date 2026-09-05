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
              and HOLDS there for the rest of it. Only for scenes that are meant
              to come to rest: the logo hold, the scratch card, the RSVP panel
              and the finale. A hold mid-flight reads as the camera stalling.
     linger : 0..0.6 — instead of stopping, slow the camera through the middle of
              the scene (where the copy peaks) and let it run at full speed into
              the seam. f(0)=0 and f(1)=1 are preserved, so the seam frames are
              untouched and the flight stays continuous across the join.
     copy   : [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd] in local 0..1
     from/to: the SLICE of the clip this scene owns, 0..1. Two scenes use it —
              the photograph carries clip 2 from 72%, the closing card carries
              clip 8 from 70% — so the film keeps running underneath them instead
              of freezing on a held frame, which is what read as the scroll
              pausing. Consecutive slices of one clip are seamless by definition.
     anchored: true where the overlay sits on painted artwork (the medallion, the
              RSVP silk panel, the portrait frame). Suppresses the entrance rise
              so the overlay is never offset from the thing it is pinned to — not
              even while fading in, which is already inside the window where it
              accepts a tap.
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

  /* -- hosts ----------------------------------------------------------------- */
  hosts: {
    line: 'With love & blessings',
    eyebrow: 'Heartily welcome by',
    family: 'Tayal Family',
    phones: ['9557723663', '7900970001'],
  },

  /* -- music ---------------------------------------------------------------- */
  /* Already trimmed to start at 0:10 of the original and faded at both ends so
     `loop` doesn't click on the wrap. Browsers block un-muted autoplay, so the
     player starts on the visitor's first interaction if the initial attempt is
     refused. */
  music: {
    src: 'assets/audio/kudmayi.m4a',
    srcFallback: 'assets/audio/kudmayi.mp3',
    title: 'Kudmayi',
    volume: 0.55,
  },

  /* -- the film ------------------------------------------------------------ */
  /* Frames per clip. The film is a WebP frame sequence, not video: scroll picks
     an array index, so there is no seeking and no video decoder involved. See
     film.js for why. `from`/`to` give a scene a SLICE of its clip: the couple
     play clip 2 up to 72% and the photograph carries it from there, so the film
     keeps running underneath rather than freezing on a held still. Clip 8 is
     split the same way, which is what lands the closing card exactly as the
     film runs out. */
  frameCount: 56,
  diveScroll: 1.45,        // default viewport-heights per scene
  crossfade: 0.16,         // seam dissolve width, in viewport-heights

  sections: [
    {
      id: 'open', label: 'Welcome', kind: 'open',
      frames: 'assets/frames/c1',
      scroll: 2.0, settle: 0.70, copy: [-0.05, -0.01, 1, 1],
      place: 'lower',
    },
    {
      id: 'couple', label: 'The Couple', kind: 'couple',
      frames: 'assets/frames/c2',
      scroll: 2.1, settle: 1, linger: 0.35, to: 0.72, copy: [0.40, 0.58, 0.90, 1],
      place: 'center',
    },
    {
      /* The second half of clip 2, not a still: the photograph gets its own
         screen while the camera keeps drifting through the last quarter of the
         wreath shot. A frozen frame here was the "scroll pauses" everyone felt. */
      id: 'portrait', label: 'The Two of Us', kind: 'portrait',
      frames: 'assets/frames/c2',
      scroll: 2.3, settle: 1, from: 0.72, copy: [0.14, 0.34, 0.90, 1],
      place: 'fill',
    },
    {
      id: 'family', label: 'Our Families', kind: 'family',
      frames: 'assets/frames/c3',
      scroll: 2.1, settle: 1, linger: 0.35, copy: [0.42, 0.60, 0.92, 1],
      place: 'center',
    },
    {
      id: 'savethedate', label: 'Save the Date', kind: 'scratch',
      frames: 'assets/frames/c4',
      scroll: 2.6, settle: 0.42, copy: [0.38, 0.50, 1, 1], anchored: true,   // locked to the medallion
      place: 'fill',
    },
    {
      id: 'ceremony', label: 'The Ceremony', kind: 'ceremony',
      frames: 'assets/frames/c5',
      scroll: 2.4, settle: 1, linger: 0.35, copy: [0.38, 0.56, 0.94, 1],
      place: 'center',
    },
    {
      id: 'venue', label: 'The Venue', kind: 'venue',
      frames: 'assets/frames/c6',
      scroll: 2.5, settle: 1, linger: 0.35, copy: [0.42, 0.60, 0.96, 1],
      place: 'lower',
    },
    {
      id: 'rsvp', label: 'RSVP', kind: 'rsvp',
      frames: 'assets/frames/c7',
      scroll: 2.9, settle: 0.34, copy: [0.34, 0.46, 0.94, 1], anchored: true,   // locked to the silk panel
      place: 'fill',
    },
    {
      id: 'blessing', label: 'Blessings', kind: 'finale',
      frames: 'assets/frames/c8',
      scroll: 2.9, settle: 1, to: 0.70, copy: [0.44, 0.60, 0.90, 1],
      place: 'center',
    },
    {
      /* The last 30% of clip 8. The wreath finishes drawing itself across this
         scene, so the closing card arrives exactly as the film reaches its final
         frame and the whole flight comes to rest together. */
      id: 'hosts', label: 'With Love', kind: 'hosts',
      frames: 'assets/frames/c8',
      scroll: 2.4, settle: 1, from: 0.70, copy: [0.30, 0.50, 1, 1],
      place: 'center',
    },
  ],
};

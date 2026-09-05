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
  diveScroll: 1.45,        // default viewport-heights per scene
  crossfade: 0.16,         // seam dissolve width, in viewport-heights

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
      scroll: 1.7, settle: 1, linger: 0.35, copy: [0.42, 0.60, 0.92, 1],
      place: 'center',
    },
    {
      /* Clipless, like the closing card: clip 2 has come to rest on its floral
         wreath, so this scene holds that frame and the portrait settles into the
         wreath's opening. Clip 3 was chained from this same frame, so the flight
         picks straight back up afterwards. */
      id: 'portrait', label: 'The Two of Us', kind: 'portrait',
      clip: null, poster: 'assets/poster/c2b.jpg',
      scroll: 1.7, settle: 1, copy: [0.16, 0.38, 0.88, 0.99],
      place: 'fill',
    },
    {
      id: 'family', label: 'Our Families', kind: 'family',
      clip: 'assets/video/c3.mp4', clipMobile: 'assets/video/c3-m.mp4',
      poster: 'assets/poster/c3.jpg',
      scroll: 1.7, settle: 1, linger: 0.35, copy: [0.44, 0.62, 0.92, 1],
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
      scroll: 2.0, settle: 1, linger: 0.35, copy: [0.40, 0.58, 0.94, 1],
      place: 'center',
    },
    {
      id: 'venue', label: 'The Venue', kind: 'venue',
      clip: 'assets/video/c6.mp4', clipMobile: 'assets/video/c6-m.mp4',
      poster: 'assets/poster/c6.jpg',
      scroll: 2.1, settle: 1, linger: 0.35, copy: [0.46, 0.64, 0.96, 1],
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
      scroll: 2.0, settle: 0.72, copy: [0.40, 0.56, 0.86, 0.98],
      place: 'center',
    },
    {
      /* No clip of its own: the camera has already come to rest on clip 8's last
         frame, so this scene holds that exact frame as a still and the closing
         card settles onto it. Same picture across the seam, so nothing moves. */
      id: 'hosts', label: 'With Love', kind: 'hosts',
      clip: null, poster: 'assets/poster/c9.jpg',
      scroll: 1.7, settle: 1, copy: [0.16, 0.38, 1, 1],
      place: 'center',
    },
  ],
};

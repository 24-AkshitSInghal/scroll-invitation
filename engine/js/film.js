/* ============================================================================
   film.js — native-video timeline
   ----------------------------------------------------------------------------
   The browser's media pipeline owns decoding and presentation. On phones that
   normally means hardware H.264 decode and compositor presentation, instead of
   allocating, decoding and repainting WebP bitmaps from JavaScript.

   One small MP4 is fetched completely behind the opening curtain. Once the
   invitation opens, a transition cannot pause for the network. JavaScript runs
   only while the video is moving and only updates the copy layer; it never
   repaints the film.
   ========================================================================== */

window.Film = (function () {
  'use strict';

  const once = (target, ok, bad, timeout) => new Promise((resolve, reject) => {
    let timer = 0;
    const clean = () => {
      target.removeEventListener(ok, pass);
      if (bad) target.removeEventListener(bad, fail);
      if (timer) clearTimeout(timer);
    };
    const pass = () => { clean(); resolve(); };
    const fail = () => { clean(); reject(new Error('media ' + (bad || 'error'))); };
    target.addEventListener(ok, pass, { once: true });
    if (bad) target.addEventListener(bad, fail, { once: true });
    if (timeout) timer = setTimeout(() => { clean(); reject(new Error('media timeout')); }, timeout);
  });

  async function prefersLite(config) {
    const forced = new URLSearchParams(location.search).get('q');
    if (forced === 'lite') return true;
    if (forced === 'hi') return false;

    const net = navigator.connection || {};
    if (net.saveData || /2g|3g/.test(net.effectiveType || '')) return true;
    if ((navigator.deviceMemory || 8) <= 4) return true;
    if ((navigator.hardwareConcurrency || 8) <= 4) return true;

    // MediaCapabilities is advisory and is not present on every Safari version.
    // Missing data means "try the compatible 720p source", not "unsupported".
    if (navigator.mediaCapabilities && navigator.mediaCapabilities.decodingInfo) {
      try {
        const result = await navigator.mediaCapabilities.decodingInfo({
          type: 'file',
          video: {
            contentType: 'video/mp4; codecs="avc1.4D401F"',
            width: 720, height: 1280,
            bitrate: 3600000,
            framerate: config.fps || 24,
          },
        });
        if (!result.supported || !result.smooth || !result.powerEfficient) return true;
      } catch (e) {}
    }
    return false;
  }

  function Player(video, config) {
    this.video = video;
    this.config = config;
    this.fps = config.fps || 24;
    this.objectURL = '';
    this.token = 0;
    this.mode = 'high';
    this.ready = false;
  }

  Player.prototype.prepare = async function (onProgress) {
    if (!this.video.canPlayType('video/mp4; codecs="avc1.4D401F"')) {
      throw new Error('H.264 video is not supported');
    }
    const lite = await prefersLite(this.config);
    this.mode = lite ? 'lite' : 'high';
    const url = lite ? this.config.lite : this.config.high;
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error('video download ' + response.status);

    const expected = Number(response.headers.get('content-length')) || 0;
    let blob;
    if (response.body && response.body.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        chunks.push(part.value);
        received += part.value.byteLength;
        if (onProgress && expected) onProgress(Math.min(0.98, received / expected));
      }
      blob = new Blob(chunks, { type: 'video/mp4' });
    } else {
      blob = await response.blob();
    }

    this.objectURL = URL.createObjectURL(blob);
    const video = this.video;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.src = this.objectURL;
    video.load();
    if (video.readyState < 1) await once(video, 'loadedmetadata', 'error', 12000);
    if (video.readyState < 2) await once(video, 'loadeddata', 'error', 12000);
    this.ready = true;
    if (onProgress) onProgress(1);
    return this.mode;
  };

  Player.prototype.cancel = function () {
    this.token++;
    this.video.pause();
  };

  Player.prototype.seek = async function (time) {
    this.cancel();
    const video = this.video;
    const safe = Math.max(0, Math.min(time, Math.max(0, (video.duration || time) - 0.001)));
    if (Math.abs(video.currentTime - safe) < 1 / (this.fps * 2)) return;
    const done = once(video, 'seeked', 'error', 5000).catch(() => {});
    video.currentTime = safe;
    await done;
  };

  Player.prototype.playTo = function (time, onFrame) {
    const video = this.video;
    const token = ++this.token;
    const end = Math.max(0, Math.min(time, Math.max(0, (video.duration || time) - 0.001)));
    const slop = 1 / (this.fps * 2);

    if (end <= video.currentTime + slop) {
      return this.seek(end).then(() => { if (onFrame) onFrame(end, true); });
    }

    return new Promise((resolve, reject) => {
      let raf = 0;
      let vfc = 0;
      let settled = false;

      const clean = () => {
        if (raf) cancelAnimationFrame(raf);
        if (vfc && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(vfc);
        video.removeEventListener('error', fail);
        video.removeEventListener('ended', tick);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        clean();
        video.pause();
        if (Math.abs(video.currentTime - end) > slop) video.currentTime = end;
        if (onFrame) onFrame(end, true);
        resolve();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        clean();
        video.pause();
        reject(new Error('video playback failed'));
      };
      let tick = () => {
        if (token !== this.token) { finish(); return; }
        const now = video.currentTime;
        if (onFrame) onFrame(now, false);
        if (now >= end - slop || video.ended) finish();
        else schedule();
      };
      const schedule = () => {
        if (settled) return;
        if (video.requestVideoFrameCallback) vfc = video.requestVideoFrameCallback(tick);
        else raf = requestAnimationFrame(tick);
      };

      video.addEventListener('error', fail, { once: true });
      video.addEventListener('ended', tick, { once: true });
      video.playbackRate = 1;
      const started = video.play();
      if (started && started.catch) started.catch(fail);
      schedule();
    });
  };

  Player.prototype.quality = function () {
    if (!this.video.getVideoPlaybackQuality) return null;
    const q = this.video.getVideoPlaybackQuality();
    return { total: q.totalVideoFrames || 0, dropped: q.droppedVideoFrames || 0 };
  };

  Player.prototype.destroy = function () {
    this.cancel();
    if (this.objectURL) URL.revokeObjectURL(this.objectURL);
  };

  return { Player };
})();

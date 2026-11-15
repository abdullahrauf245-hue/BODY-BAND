/*
 * Camera check, shown before every SmartSpectra session.
 *
 *  - Consent: says what the camera session does, what it costs and what leaves the PC,
 *    and nothing starts until the person presses START.
 *  - A free rehearsal: the browser opens the webcam itself (no SDK, so no SDK minutes),
 *    shows the picture with a head-and-chest outline, and measures the frame rate and
 *    light the SDK would get. The SDK refuses to measure below 25 frames a second, and
 *    webcams in dim light drop to about 15.
 *  - The browser lets go of the camera before the SDK opens it.
 *
 *   CamCheck.open() -> Promise<boolean>   true = start measuring, false = cancelled
 */
(function () {
  const MIN_FPS = 25;
  // Exposure (in 100-microsecond units, as Chrome reports it) at which a camera can no longer
  // hold 30 frames a second: 90% of one frame, 0.9 x 333.
  const STRAINED_EXPOSURE = 300;
  const DARK = 60;           // average brightness (0..255) below which the picture is dark
  const RELEASE_MS = 400;    // give the camera driver time to let go before the SDK opens it
  const $ = (id) => document.getElementById(id);

  function open() {
    const dlg = $('camCheck'), video = $('ccVideo');
    let stream = null, closed = false, timer = 0, frames = 0, seconds = 0;
    const probe = document.createElement('canvas');
    probe.width = 32; probe.height = 24;
    const pctx = probe.getContext('2d', { willReadFrequently: true });

    const say = (text, cls) => { $('ccMsg').textContent = text; $('ccMsg').className = `cc-msg ${cls || ''}`; };
    const ready = (ok) => {
      $('ccStartText').textContent = ok ? 'START MEASURING' : 'START ANYWAY';
      $('ccLed').className = ok ? 'led' : 'led off';
    };

    // Count frames the camera actually delivers. MediaStreamTrackProcessor reads them straight
    // off the track, so the count doesn't drop when the browser draws slowly; the older
    // per-drawn-frame callback is only a fallback and can undercount.
    async function countFrames(track) {
      if (typeof MediaStreamTrackProcessor === 'function') {
        const copy = track.clone();
        const reader = new MediaStreamTrackProcessor({ track: copy }).readable.getReader();
        try {
          while (!closed) {
            const { value, done } = await reader.read();
            if (done) break;
            frames++;
            value.close();
          }
        } catch (e) { /* track stopped */ }
        copy.stop();
        return;
      }
      const tick = () => { frames++; if (!closed) video.requestVideoFrameCallback(tick); };
      video.requestVideoFrameCallback(tick);
    }

    function measure() {
      seconds++;
      const fps = frames;
      frames = 0;
      let light = null;
      if (video.readyState >= 2) {
        pctx.drawImage(video, 0, 0, probe.width, probe.height);
        const d = pctx.getImageData(0, 0, probe.width, probe.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        light = sum / (d.length / 4);
      }
      // The picture can look bright while the camera is struggling: in dim light it keeps its
      // shutter open longer to compensate, and once that is about as long as one frame it
      // cannot deliver 30 a second any more. Cameras that report their exposure tell us.
      const exposure = stream && stream.getVideoTracks()[0].getSettings().exposureTime; // 100 µs units
      const strained = typeof exposure === 'number' && exposure >= STRAINED_EXPOSURE;
      if (seconds < 2) return; // the first second includes the camera starting up

      $('ccFps').textContent = `${fps} FPS`;
      $('ccFps').className = fps >= MIN_FPS ? 'ok' : 'bad';
      const lightState = strained ? 'LOW' : light === null ? null : light < DARK ? 'DARK' : 'OK';
      $('ccLight').textContent = lightState || '--';
      $('ccLight').className = lightState === null ? '' : lightState === 'OK' ? 'ok' : 'bad';
      if (fps < MIN_FPS) {
        say(strained
          ? `ONLY ${fps} FRAMES A SECOND — THE CAMERA IS STRAINING IN THIS LIGHT. ADD LIGHT FACING YOU`
          : `ONLY ${fps} FRAMES A SECOND — ADD LIGHT FACING YOU`, 'bad');
        ready(false);
      } else if (strained) {
        say('FRAME RATE OK FOR NOW, BUT THE CAMERA IS AT ITS LIMIT — MORE LIGHT KEEPS IT STEADY', 'bad');
        ready(true);
      } else if (light !== null && light < DARK) {
        say('FRAME RATE OK, BUT DARK — MORE LIGHT HELPS', 'bad');
        ready(true);
      } else {
        say('READY — HEAD AND CHEST IN THE OUTLINE, THEN START', 'ok');
        ready(true);
      }
    }

    function release() {
      closed = true;
      clearInterval(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
      video.srcObject = null;
    }

    $('ccFps').textContent = '--'; $('ccFps').className = '';
    $('ccLight').textContent = '--'; $('ccLight').className = '';
    ready(true);
    say('ASKING FOR THE CAMERA…');

    const result = new Promise((resolve) => {
      const finish = (ok) => {
        if (closed) return;
        release();
        dlg.close();
        if (ok) setTimeout(() => resolve(true), RELEASE_MS);
        else resolve(false);
      };
      $('ccStart').onclick = () => finish(true);
      $('ccCancel').onclick = () => finish(false);
      dlg.oncancel = (e) => { e.preventDefault(); finish(false); }; // Esc key
    });
    dlg.showModal();
    $('ccCancel').focus();

    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        });
        if (closed) { s.getTracks().forEach((t) => t.stop()); return; } // cancelled while asking
        stream = s;
        video.srcObject = s;
        await video.play();
        if (closed) return;
        countFrames(s.getVideoTracks()[0]);
        timer = setInterval(measure, 1000);
        say('MEASURING THE CAMERA…');
      } catch (e) {
        if (closed) return;
        say(e && e.name === 'NotAllowedError'
          ? 'NO PREVIEW: CAMERA PERMISSION DENIED. YOU CAN STILL START.'
          : 'NO PREVIEW HERE. YOU CAN STILL START.');
      }
    })();

    return result;
  }

  window.CamCheck = { open };
})();

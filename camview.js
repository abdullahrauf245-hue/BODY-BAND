/*
 * Live camera view for the camera panel. The SmartSpectra SDK owns the webcam (inside
 * server.js), so the browser cannot open it too; instead the page asks the server for
 * the newest picture about 12 times a second and paints it on a canvas.
 *
 *   CamView.start(canvas, frame)  begin; `frame` gets the class "live" once a picture shows
 *   CamView.stop()                end and clear the picture
 */
(function () {
  const INTERVAL = 80;          // ms between pictures while the page is visible
  const HIDDEN_INTERVAL = 1000; // nobody is looking: just keep the connection warm

  let running = false, timer = 0, canvas = null, frame = null, ctx = null;

  async function pull() {
    if (!running) return;
    try {
      const res = await fetch('/preview', { cache: 'no-store' });
      if (running && res.status === 200) {
        const w = Number(res.headers.get('X-Frame-Width'));
        const h = Number(res.headers.get('X-Frame-Height'));
        const data = new Uint8ClampedArray(await res.arrayBuffer());
        if (running && w > 0 && h > 0 && data.length === w * h * 4) {
          if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
          ctx.putImageData(new ImageData(data, w, h), 0, 0);
          if (canvas.hidden) { canvas.hidden = false; frame.classList.add('live'); }
        }
      }
    } catch (e) {
      // server unreachable: the session ends by itself, nothing to do here
    }
    if (running) timer = setTimeout(pull, document.hidden ? HIDDEN_INTERVAL : INTERVAL);
  }

  window.CamView = {
    start(canvasEl, frameEl) {
      if (running) return;
      canvas = canvasEl; frame = frameEl; ctx = canvas.getContext('2d');
      running = true;
      pull();
    },
    stop() {
      if (!running) return;
      running = false;
      clearTimeout(timer);
      canvas.hidden = true;
      frame.classList.remove('live');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
})();

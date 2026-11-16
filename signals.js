/*
 * Signal sources. Every source emits the same events so the rest of the app
 * never cares where the numbers come from:
 *
 *   { type: 'frame', pulse, breathRate, breath }   // ~60x per second
 *       pulse      heart rate in bpm
 *       breathRate breaths per minute
 *       breath     0..1, where we are in the breath (0 = fully out, 1 = fully in)
 *   { type: 'beat' }                                // once per heartbeat
 *
 * When the SmartSpectra SDK is wired up, add a PresageSource with the same
 * shape (start / stop / on) and nothing else needs to change.
 */
(function () {
  class SignalSource {
    constructor() { this.listeners = new Set(); this.running = false; }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(evt) { for (const fn of this.listeners) fn(evt); }
    start() {
      this.running = true;
      this.last = performance.now();
      this.beatAcc = 0;
      // A steady timer, not requestAnimationFrame: the music must keep time even when
      // the browser is drawing slowly or the window is in the background.
      this.timer = setInterval(() => {
        const now = performance.now();
        const dt = Math.min((now - this.last) / 1000, 1);
        this.last = now;
        this.update(dt, now / 1000);
        this.beatAcc += dt * this.pulse / 60;
        if (this.beatAcc >= 1) { this.beatAcc %= 1; this.emit({ type: 'beat' }); }
        this.emit({ type: 'frame', pulse: this.pulse, breathRate: this.breathRate, breath: this.breath });
      }, 1000 / 60);
    }
    stop() { this.running = false; clearInterval(this.timer); }
  }

  /** A believable fake body: slow drifting pulse, smooth breathing. */
  class SimulatedSource extends SignalSource {
    constructor() {
      super();
      this.label = 'Simulated body';
      this.pulse = 72; this.breathRate = 13; this.breath = 0; this.phase = 0;
    }
    update(dt, t) {
      this.pulse = 70 + 9 * Math.sin(t / 23) + 3 * Math.sin(t / 6.3);
      this.breathRate = 12 + 3 * Math.sin(t / 37);
      this.phase += dt * this.breathRate / 60;
      this.breath = 0.5 - 0.5 * Math.cos(2 * Math.PI * this.phase);
    }
  }

  /**
   * Manual: hold Space (or press the screen) to inhale, release to exhale.
   * Also a nice accessibility mode: anyone can "play" with one input.
   */
  class ManualSource extends SignalSource {
    /** @param {EventTarget} [pressTarget] element that counts as "press to inhale" (default: whole window) */
    constructor(pressTarget) {
      super();
      this.label = 'Manual (hold Space)';
      this.pressTarget = pressTarget || window;
      this.pulse = 68; this.breathRate = 0; this.breath = 0;
      this.holding = false; this.cycleStarts = [];
      this.down = (e) => {
        if (e.type === 'keydown' && e.code !== 'Space') return;
        if (e.type === 'keydown') e.preventDefault(); // Space must not click a focused button
        if (e.repeat) return;
        if (e.type === 'pointerdown' && e.target.closest && e.target.closest('button')) return;
        if (!this.holding) this.cycleStarts.push(performance.now());
        this.holding = true;
      };
      this.up = (e) => {
        if (e.type === 'keyup' && e.code !== 'Space') return;
        this.holding = false;
      };
    }
    start() {
      window.addEventListener('keydown', this.down);
      window.addEventListener('keyup', this.up);
      this.pressTarget.addEventListener('pointerdown', this.down);
      window.addEventListener('pointerup', this.up);
      super.start();
    }
    stop() {
      window.removeEventListener('keydown', this.down);
      window.removeEventListener('keyup', this.up);
      this.pressTarget.removeEventListener('pointerdown', this.down);
      window.removeEventListener('pointerup', this.up);
      super.stop();
    }
    update(dt) {
      const speed = this.holding ? 0.45 : 0.3; // per second
      this.breath += (this.holding ? 1 : -1) * speed * dt;
      this.breath = Math.max(0, Math.min(1, this.breath));
      // breaths per minute from the last few inhales
      const now = performance.now();
      this.cycleStarts = this.cycleStarts.filter((s) => now - s < 60000);
      if (this.cycleStarts.length >= 2) {
        const span = (now - this.cycleStarts[0]) / 60000;
        this.breathRate = (this.cycleStarts.length - 1) / Math.max(span, 0.05);
      }
      // calmer breathing nudges the heart down a little
      const target = this.holding ? 74 : 64;
      this.pulse += (target - this.pulse) * dt * 0.15;
    }
  }

  /**
   * Real vitals from the SmartSpectra SDK, streamed by server.js (npm start).
   * Extra events: { type: 'status', text } camera hints, { type: 'time', left, fps,
   * width, height } seconds remaining and what the camera is delivering,
   * { type: 'ended', reason } when the session is over.
   */
  class PresageSource extends SignalSource {
    constructor() {
      super();
      this.label = 'SmartSpectra camera';
      this.pulse = 0; this.breathRate = 0; this.breath = 0;
      this.target = 0;
      this.scaler = new Vitals.BreathScaler();     // raw chest trace -> 0..1, outlier-proof
      this.pulseFilter = new Vitals.PulseFilter(); // raw pulse rates -> a steady tempo
    }
    start() {
      const es = (this.es = new EventSource('/vitals'));
      es.addEventListener('vitals', (e) => {
        const d = JSON.parse(e.data);
        this.pulseFilter.accept(d.pulse);
        if (d.breathRate >= 3 && d.breathRate <= 60) this.breathRate = d.breathRate; // breaths a minute a person can take
        if (d.trace && d.trace.length) {
          const level = this.scaler.push(d.trace);
          if (level !== null) this.target = level;
        }
      });
      es.addEventListener('status', (e) => this.emit({ type: 'status', text: JSON.parse(e.data).text }));
      es.addEventListener('tick', (e) => this.emit({ type: 'time', ...JSON.parse(e.data) }));
      es.addEventListener('ended', (e) => {
        es.close();
        this.emit({ type: 'ended', reason: JSON.parse(e.data).reason });
      });
      // Never let the browser auto-reconnect: that would silently start a new session.
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) return;
        es.close();
        this.emit({ type: 'ended', reason: 'Lost connection to the Body Band server' });
      };
      super.start();
    }
    stop() {
      if (this.es) this.es.close();
      super.stop();
    }
    update(dt) {
      this.pulse = this.pulseFilter.step(dt);
      this.breath += (this.target - this.breath) * Math.min(1, dt * 6);
    }
  }

  window.Signals = { SimulatedSource, ManualSource, PresageSource };
})();

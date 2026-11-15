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
      const tick = (now) => {
        if (!this.running) return;
        const dt = Math.min((now - this.last) / 1000, 0.1);
        this.last = now;
        this.update(dt, now / 1000);
        this.beatAcc += dt * this.pulse / 60;
        if (this.beatAcc >= 1) { this.beatAcc -= 1; this.emit({ type: 'beat' }); }
        this.emit({ type: 'frame', pulse: this.pulse, breathRate: this.breathRate, breath: this.breath });
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }
    stop() { this.running = false; cancelAnimationFrame(this.raf); }
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
    constructor() {
      super();
      this.label = 'Manual (hold Space)';
      this.pulse = 68; this.breathRate = 0; this.breath = 0;
      this.holding = false; this.cycleStarts = [];
      this.down = (e) => {
        if (e.type === 'keydown' && (e.code !== 'Space' || e.repeat)) return;
        if (e.type === 'keydown') e.preventDefault();
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
      window.addEventListener('pointerdown', this.down);
      window.addEventListener('pointerup', this.up);
      super.start();
    }
    stop() {
      window.removeEventListener('keydown', this.down);
      window.removeEventListener('keyup', this.up);
      window.removeEventListener('pointerdown', this.down);
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

  window.Signals = { SimulatedSource, ManualSource };
})();

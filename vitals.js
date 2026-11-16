/*
 * Vitals: the signal-processing logic, kept free of the page, the audio and the SDK so it
 * can be tested on its own (test/vitals.test.js). Loaded by the page as window.Vitals and by
 * Node tests through require().
 *
 *   BreathScaler   raw chest trace  -> 0..1 "how full is the breath", ignoring outliers
 *   PulseFilter    raw pulse rates  -> a steady tempo, ignoring impossible values and spikes
 *   PhaseDetector  0..1 breath      -> INHALING / EXHALING / HOLD, and a breath count
 *   guideAt        breathing guide  -> what to do now and how full the lungs should be
 *   SyncMeter      guide vs breath  -> a 0..100 score of how closely you follow the guide
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Vitals = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /**
   * Scales the raw chest trace to 0..1 using the last `size` samples.
   * The range is taken between the 4th and 96th percentile, not the minimum and maximum:
   * one cough or shift in the chair would otherwise squash every breath for the next
   * 20 seconds. Values outside the range clip to 0 or 1.
   */
  class BreathScaler {
    constructor(size = 600) {
      this.size = size;
      this.buf = [];
      this.lo = 0; this.hi = 0;
      this.sinceFit = Infinity;
    }
    /** @param {number[]} samples newest last. @returns {number|null} 0..1, or null until the range is known */
    push(samples) {
      let latest = null;
      for (const v of samples) {
        if (!Number.isFinite(v)) continue; // a broken sample must not poison the range
        this.buf.push(v);
        latest = v;
        this.sinceFit++;
      }
      if (latest === null) return null;
      if (this.buf.length > this.size) this.buf.splice(0, this.buf.length - this.size);
      if (this.sinceFit >= BreathScaler.REFIT_EVERY) this.fit();
      if (this.hi - this.lo < 1e-6) return null;
      return clamp01((latest - this.lo) / (this.hi - this.lo));
    }
    fit() {
      this.sinceFit = 0;
      const sorted = Float64Array.from(this.buf).sort();
      const n = sorted.length;
      if (n < 20) { this.lo = sorted[0]; this.hi = sorted[n - 1]; return; } // too few to trim
      this.lo = sorted[Math.floor(n * 0.04)];
      this.hi = sorted[Math.ceil(n * 0.96) - 1];
    }
  }
  BreathScaler.REFIT_EVERY = 5; // samples between range updates

  /**
   * Turns the pulse rates the SDK reports into the tempo the music plays at.
   * Values no resting or exercising heart produces are ignored, a single odd reading is
   * outvoted by its neighbours (median of the last five), and the tempo glides to a new
   * value over about a second, so the rhythm never lurches.
   */
  class PulseFilter {
    constructor() { this.recent = []; this.target = 0; this.value = 0; }
    /** @returns {boolean} whether the reading was plausible and used */
    accept(bpm) {
      if (!(bpm >= PulseFilter.MIN && bpm <= PulseFilter.MAX)) return false;
      this.recent.push(bpm);
      if (this.recent.length > 5) this.recent.shift();
      const sorted = this.recent.slice().sort((a, b) => a - b);
      this.target = sorted[Math.floor(sorted.length / 2)];
      if (!this.value) this.value = this.target; // first reading: no glide from zero
      return true;
    }
    /** Advance by dt seconds. @returns {number} tempo in beats a minute, 0 until a reading arrives */
    step(dt) {
      if (this.target) this.value += (this.target - this.value) * (1 - Math.exp(-dt / 1));
      return this.value;
    }
  }
  PulseFilter.MIN = 35;
  PulseFilter.MAX = 200;

  /**
   * Follows a 0..1 breath signal and says which way it is going.
   * Direction comes from a smoothed speed and must hold for 0.2 s before it counts.
   * A new breath is counted when an inhale starts after the breath has fallen at least
   * MIN_SWING from its last peak, so a wiggle halfway through an inhale is not a breath.
   */
  class PhaseDetector {
    constructor() { this.reset(0); }
    reset(now) {
      this.breath = 0; this.vel = 0; this.last = now;
      this.phase = 'HOLD'; this.cand = 'HOLD'; this.candT = now; this.phaseStart = now;
      this.cycles = 0; this.counted = false; this.peak = 0; this.trough = 0;
    }
    /** @param {number} breath 0..1  @param {number} now seconds  @returns {'INHALING'|'EXHALING'|'HOLD'} */
    update(breath, now) {
      const dt = Math.max(now - this.last, 0.001);
      this.last = now;
      this.vel += ((breath - this.breath) / dt - this.vel) * (1 - Math.exp(-dt / 0.1));
      this.breath = breath;

      if (breath > this.peak) { this.peak = breath; this.trough = breath; }
      else if (breath < this.trough) this.trough = breath;

      const cand = this.vel > 0.04 ? 'INHALING' : this.vel < -0.04 ? 'EXHALING' : 'HOLD';
      if (cand !== this.cand) { this.cand = cand; this.candT = now; }
      else if (cand !== this.phase && now - this.candT > 0.2) {
        this.phase = cand; this.phaseStart = now;
        if (cand === 'INHALING' && (!this.counted || this.peak - this.trough >= PhaseDetector.MIN_SWING)) {
          this.cycles++; this.counted = true;
          this.peak = breath; this.trough = breath;
        }
      }
      return this.phase;
    }
  }
  PhaseDetector.MIN_SWING = 0.2;

  /**
   * Where a breathing guide is at time t.
   * @param {Array<[string, number]>} steps [label, seconds] with labels INHALE, HOLD, EXHALE
   * @returns {{label: string, level: number, left: number}} what to do, how full the lungs
   *          should be (0..1), and seconds until the next step
   */
  function guideAt(steps, t) {
    const total = steps.reduce((a, s) => a + s[1], 0);
    let x = t % total, level = 0;
    for (const [label, secs] of steps) {
      if (x < secs) {
        const p = x / secs;
        if (label === 'INHALE') level = p;
        else if (label === 'EXHALE') level = 1 - p;
        return { label, level, left: secs - x };
      }
      x -= secs;
      if (label === 'INHALE') level = 1;
      else if (label === 'EXHALE') level = 0;
    }
    return { label: steps[0][0], level: 0, left: 0 };
  }

  /**
   * How closely the breath follows a guide, as 0..100.
   * It is the average gap between the two over roughly the last 8 seconds: no gap is 100,
   * an average gap of half the scale or more is 0. Nothing is reported for the first
   * WARMUP seconds, when there is too little to average.
   */
  class SyncMeter {
    constructor() { this.reset(); }
    reset() { this.err = 0; this.age = 0; }
    /** @returns {number|null} score, or null while warming up */
    update(target, actual, dt) {
      const gap = Math.abs(target - actual);
      this.err = this.age === 0 ? gap : this.err + (gap - this.err) * (1 - Math.exp(-dt / 8));
      this.age += dt;
      return this.score;
    }
    get score() {
      if (this.age < SyncMeter.WARMUP) return null;
      return Math.round(100 * Math.max(0, 1 - this.err / 0.5));
    }
  }
  SyncMeter.WARMUP = 4;

  return { BreathScaler, PulseFilter, PhaseDetector, SyncMeter, guideAt };
});

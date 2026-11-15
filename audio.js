/*
 * BodyBand audio engine (Web Audio, no libraries).
 *   breath (0..1) -> opens a warm pad (filter + volume)
 *   each heartbeat -> soft kick + a note from a pentatonic scale
 *   pulse level    -> how high / bright the notes are
 */
(function () {
  const SCALE = [0, 3, 5, 7, 10]; // minor pentatonic, always sounds nice
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  class BodyBand {
    async start() {
      const c = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
      if (c.state === 'suspended') await c.resume();

      this.master = c.createGain();
      this.master.gain.value = 0;
      this.master.gain.linearRampToValueAtTime(0.8, c.currentTime + 2);
      this.master.connect(c.destination);

      // simple generated reverb
      this.verb = c.createConvolver();
      this.verb.buffer = this.impulse(3.5);
      const verbOut = c.createGain();
      verbOut.gain.value = 0.55;
      this.verb.connect(verbOut).connect(this.master);

      // breathing pad
      this.root = 110; // A2
      this.padFilter = c.createBiquadFilter();
      this.padFilter.type = 'lowpass';
      this.padFilter.frequency.value = 300;
      this.padFilter.Q.value = 3;
      this.padGain = c.createGain();
      this.padGain.gain.value = 0.08;
      this.padFilter.connect(this.padGain);
      this.padGain.connect(this.master);
      this.padGain.connect(this.verb);
      this.padOscs = [0, 7, 12, 15].map((st, i) => {
        const o = c.createOscillator();
        o.type = i % 2 ? 'sawtooth' : 'triangle';
        o.frequency.value = this.root * 2 ** (st / 12);
        o.detune.value = (i - 1.5) * 7;
        o.connect(this.padFilter);
        o.start();
        return o;
      });

      this.noteIdx = 5;
      this.muted = false;
      this.breathAt = -1; this.breathVal = -1; // when and what setBreath last scheduled
    }

    impulse(seconds) {
      const c = this.ctx, len = Math.floor(c.sampleRate * seconds);
      const buf = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
      }
      return buf;
    }

    setBreath(v) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      // The filter glides by itself (0.12 s), so 20 updates a second sound the same as 60
      // and queue a third of the automation events. Unchanged values queue nothing.
      if (t - this.breathAt < 0.05 || v === this.breathVal) return;
      this.breathAt = t; this.breathVal = v;
      this.cutoff = 220 + v * 2400; // Hz, shown on the BREATH PAD knob
      this.padFilter.frequency.setTargetAtTime(this.cutoff, t, 0.12);
      this.padGain.gain.setTargetAtTime(0.06 + v * 0.11, t, 0.12);
    }

    beat(pulse) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;

      // soft heartbeat kick
      const k = c.createOscillator(), kg = c.createGain();
      k.frequency.setValueAtTime(95, t);
      k.frequency.exponentialRampToValueAtTime(42, t + 0.16);
      kg.gain.setValueAtTime(0.0001, t);
      kg.gain.exponentialRampToValueAtTime(0.55, t + 0.006);
      kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      k.connect(kg).connect(this.master);
      k.start(t); k.stop(t + 0.4);

      // pluck: random walk over two octaves of the scale, higher pulse = brighter
      this.noteIdx += Math.floor(Math.random() * 5) - 2;
      this.noteIdx = Math.max(0, Math.min(9, this.noteIdx));
      const lift = pulse > 85 ? 12 : pulse < 62 ? -12 : 0;
      const semis = SCALE[this.noteIdx % 5] + 12 * Math.floor(this.noteIdx / 5) + 24 + lift;
      const f = this.root * 2 ** (semis / 12);
      const midi = 45 + semis; // root A2 is MIDI note 45
      this.lastNote = { name: NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1), hz: f, level: this.noteIdx / 9 };

      const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
      o.type = 'triangle';
      o.frequency.value = f;
      lp.type = 'lowpass';
      lp.frequency.value = 1200 + Math.max(0, pulse - 55) * 40;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(lp).connect(g);
      g.connect(this.master);
      g.connect(this.verb);
      o.start(t); o.stop(t + 1.5);
    }

    setMuted(m) {
      if (!this.ctx) return;
      this.muted = m;
      this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
    }

    async stop() {
      if (!this.ctx) return;
      const c = this.ctx;
      this.master.gain.setTargetAtTime(0, c.currentTime, 0.2);
      await new Promise((r) => setTimeout(r, 700));
      await c.close();
      this.ctx = null;
    }
  }

  window.BodyBand = BodyBand;
})();

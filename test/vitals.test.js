'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BreathScaler, PulseFilter, PhaseDetector, SyncMeter, guideAt } = require('../vitals');

// A breath as the camera sees it: an arbitrary offset and size, 30 samples a second.
const rawBreath = (t, perMinute = 12) => 3.2 + 0.4 * Math.sin(2 * Math.PI * t * perMinute / 60);

/** Feed `seconds` of a 0..1 breath function into a detector at 60 updates a second. */
function runDetector(fn, seconds) {
  const d = new PhaseDetector();
  d.reset(0);
  for (let i = 1; i <= seconds * 60; i++) d.update(fn(i / 60), i / 60);
  return d;
}
const unitBreath = (perMinute) => (t) => 0.5 - 0.5 * Math.cos(2 * Math.PI * t * perMinute / 60);

// ---------- BreathScaler ----------

test('BreathScaler maps a steady breath onto the full 0..1 scale', () => {
  const s = new BreathScaler();
  const out = [];
  for (let i = 0; i < 30 * 30; i++) { const v = s.push([rawBreath(i / 30)]); if (i > 300) out.push(v); }
  assert.ok(Math.min(...out) <= 0.02, `lowest ${Math.min(...out)}`);
  assert.ok(Math.max(...out) >= 0.98, `highest ${Math.max(...out)}`);
  assert.ok(out.every((v) => v >= 0 && v <= 1));
});

test('BreathScaler: one big spike does not squash the breaths that follow', () => {
  const s = new BreathScaler();
  for (let i = 0; i < 300; i++) s.push([rawBreath(i / 30)]);
  s.push([60]); // a cough or a shift in the chair: 140 times the size of a breath
  const after = [];
  for (let i = 301; i < 600; i++) after.push(s.push([rawBreath(i / 30)]));
  const span = Math.max(...after) - Math.min(...after);
  assert.ok(span > 0.9, `breaths after the spike span only ${span.toFixed(2)} of the scale`);
});

test('BreathScaler ignores broken samples and says nothing until it has a range', () => {
  const s = new BreathScaler();
  assert.equal(s.push([]), null);
  assert.equal(s.push([NaN, Infinity]), null);
  assert.equal(s.push([5, 5, 5, 5, 5, 5]), null, 'a flat trace has no range');
  for (let i = 0; i < 60; i++) s.push([rawBreath(i / 30), NaN]);
  const v = s.push([rawBreath(2)]);
  assert.ok(v >= 0 && v <= 1);
});

test('BreathScaler keeps only its window, however many samples arrive at once', () => {
  const s = new BreathScaler(100);
  s.push(Array.from({ length: 5000 }, (_, i) => rawBreath(i / 30)));
  assert.equal(s.buf.length, 100);
});

// ---------- PulseFilter ----------

test('PulseFilter refuses values no heart produces', () => {
  const p = new PulseFilter();
  for (const bad of [0, 12, 34.9, 201, 400, -70, NaN, null, undefined]) assert.equal(p.accept(bad), false, String(bad));
  assert.equal(p.step(1), 0, 'no tempo until a real reading arrives');
  assert.equal(p.accept(72), true);
  assert.equal(p.step(0.016), 72, 'the first reading is used at once');
});

test('PulseFilter: a single odd reading is outvoted', () => {
  const p = new PulseFilter();
  for (const v of [70, 71, 70, 150, 70]) p.accept(v);
  assert.equal(p.target, 70);
});

test('PulseFilter glides to a new tempo instead of jumping', () => {
  const p = new PulseFilter();
  for (let i = 0; i < 5; i++) p.accept(60);
  for (let i = 0; i < 5; i++) p.accept(90);
  const soon = p.step(0.5);
  assert.ok(soon > 60 && soon < 90, `after half a second: ${soon}`);
  for (let i = 0; i < 600; i++) p.step(1 / 60);
  assert.ok(Math.abs(p.step(0) - 90) < 0.1);
});

// ---------- PhaseDetector ----------

test('PhaseDetector counts the breaths in a minute', () => {
  for (const rate of [6, 12, 16, 24]) {
    const d = runDetector(unitBreath(rate), 60);
    assert.ok(Math.abs(d.cycles - rate) <= 1, `${rate} a minute counted as ${d.cycles}`);
  }
});

test('PhaseDetector: a wobble on top of the breath is not counted as extra breaths', () => {
  const wobbly = (t) => Math.min(1, Math.max(0, unitBreath(12)(t) + 0.04 * Math.sin(2 * Math.PI * 1.7 * t)));
  const d = runDetector(wobbly, 60);
  assert.ok(Math.abs(d.cycles - 12) <= 1, `12 a minute with a wobble counted as ${d.cycles}`);
});

test('PhaseDetector names the direction: in, out, and holding still', () => {
  const d = new PhaseDetector();
  d.reset(0);
  let t = 0;
  const run = (from, to, secs) => { for (let i = 1; i <= secs * 60; i++) { t += 1 / 60; d.update(from + (to - from) * i / (secs * 60), t); } };
  run(0, 1, 3); assert.equal(d.phase, 'INHALING');
  run(1, 1, 2); assert.equal(d.phase, 'HOLD');
  run(1, 0, 3); assert.equal(d.phase, 'EXHALING');
});

// ---------- guideAt ----------

test('guideAt follows box breathing through all four steps and wraps around', () => {
  const box = [['INHALE', 4], ['HOLD', 4], ['EXHALE', 4], ['HOLD', 4]];
  assert.deepEqual(guideAt(box, 2), { label: 'INHALE', level: 0.5, left: 2 });
  assert.deepEqual(guideAt(box, 6), { label: 'HOLD', level: 1, left: 2 });
  assert.deepEqual(guideAt(box, 9), { label: 'EXHALE', level: 0.75, left: 3 });
  assert.deepEqual(guideAt(box, 14), { label: 'HOLD', level: 0, left: 2 });
  assert.deepEqual(guideAt(box, 16 + 2), guideAt(box, 2));
});

test('guideAt handles uneven steps (4-7-8)', () => {
  const relax = [['INHALE', 4], ['HOLD', 7], ['EXHALE', 8]];
  assert.equal(guideAt(relax, 5).label, 'HOLD');
  const g = guideAt(relax, 15); // 4 seconds into an 8 second exhale
  assert.equal(g.label, 'EXHALE');
  assert.equal(g.level, 0.5);
  assert.equal(g.left, 4);
});

// ---------- SyncMeter ----------

test('SyncMeter: nothing at first, 100 when the breath matches the guide', () => {
  const m = new SyncMeter();
  assert.equal(m.update(0.5, 0.5, 1), null, 'still warming up');
  let score = null;
  for (let i = 0; i < 600; i++) score = m.update(0.3, 0.3, 1 / 60);
  assert.equal(score, 100);
});

test('SyncMeter: breathing opposite to the guide scores low, and reset starts over', () => {
  const m = new SyncMeter();
  let score = null;
  for (let i = 1; i <= 30 * 60; i++) { const b = unitBreath(6)(i / 60); score = m.update(b, 1 - b, 1 / 60); }
  assert.ok(score < 25, `opposite breathing scored ${score}`);
  m.reset();
  assert.equal(m.score, null);
});

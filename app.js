(function () {
  const $ = (id) => document.getElementById(id);
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let source = null, band = null, unsub = null;
  const state = { pulse: 0, breathRate: 0, breath: 0, prevBreath: 0, ripples: [], beatGlow: 0, live: false };

  // ---------- canvas ----------
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', resize);
  resize();

  // drifting dust in the background
  const dust = Array.from({ length: 90 }, () => ({
    x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.3, s: Math.random() * 0.02 + 0.004,
  }));

  function draw() {
    const w = innerWidth, h = innerHeight, cx = w / 2, cy = h * 0.45;
    const base = Math.min(w, h) * 0.14;
    const b = state.live ? state.breath : 0.5 + 0.5 * Math.sin(performance.now() / 2200) * 0.3;

    ctx.fillStyle = 'rgba(7,7,13,0.35)';
    ctx.fillRect(0, 0, w, h);

    // dust rises when inhaling, sinks when exhaling
    const drift = state.breath - state.prevBreath;
    ctx.fillStyle = 'rgba(236,235,245,0.35)';
    for (const d of dust) {
      d.y -= d.s * 0.016 + drift * 0.4 * d.s * 30;
      if (d.y < 0) d.y += 1; if (d.y > 1) d.y -= 1;
      ctx.beginPath();
      ctx.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // heartbeat ripples
    for (const r of state.ripples) {
      r.age += 0.016;
      const rad = base * (1 + b * 0.9) + r.age * base * 2.2;
      const alpha = Math.max(0, 0.5 - r.age * 0.4);
      ctx.strokeStyle = `rgba(255,107,139,${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    state.ripples = state.ripples.filter((r) => r.age < 1.3);

    // breathing orb
    const rad = base * (1 + b * 0.9) * (1 + state.beatGlow * 0.04);
    const g = ctx.createRadialGradient(cx, cy, rad * 0.1, cx, cy, rad * 1.6);
    g.addColorStop(0, `rgba(255,255,255,${0.55 + state.beatGlow * 0.3})`);
    g.addColorStop(0.35, `rgba(107,227,255,${0.35 + b * 0.35})`);
    g.addColorStop(0.7, `rgba(255,107,139,${0.12 + state.beatGlow * 0.25})`);
    g.addColorStop(1, 'rgba(7,7,13,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rad * 1.6, 0, Math.PI * 2);
    ctx.fill();

    state.beatGlow *= 0.9;
    state.prevBreath = state.breath;
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  // ---------- HUD ----------
  let hudTick = 0;
  function updateHud() {
    if (++hudTick % 10) return; // ~6x per second is plenty
    $('bpm').textContent = state.pulse ? Math.round(state.pulse) : '--';
    $('rpm').textContent = state.breathRate ? state.breathRate.toFixed(1) : '--';
    const rising = state.breath - state.prevBreath > 0.0005;
    const falling = state.breath - state.prevBreath < -0.0005;
    $('cue').textContent = rising ? 'Breathe in' : falling ? 'Breathe out' : 'Hold';
  }

  // ---------- lifecycle ----------
  async function begin() {
    const pick = document.querySelector('input[name="source"]:checked').value;
    source = pick === 'manual' ? new Signals.ManualSource()
      : pick === 'presage' ? new Signals.PresageSource()
      : new Signals.SimulatedSource();
    $('notice').textContent = '';
    band = new BodyBand();
    await band.start();

    unsub = source.on((e) => {
      if (e.type === 'frame') {
        state.pulse = e.pulse; state.breathRate = e.breathRate; state.breath = e.breath;
        band.setBreath(e.breath);
        updateHud();
      } else if (e.type === 'beat') {
        state.beatGlow = 1;
        if (!reduceMotion) state.ripples.push({ age: 0 });
        band.beat(state.pulse);
      } else if (e.type === 'status') {
        $('hint').textContent = e.text;
        $('hint').hidden = !e.text;
      } else if (e.type === 'time') {
        const m = Math.floor(e.left / 60), s = String(e.left % 60).padStart(2, '0');
        $('sourceTag').textContent = `${source.label} · ${m}:${s} left`;
      } else if (e.type === 'ended') {
        end(e.reason);
      }
    });
    source.start();
    state.live = true;

    $('sourceTag').textContent = source.label;
    $('intro').hidden = true;
    $('hud').hidden = false;
  }

  async function end(reason) {
    if (!source) return;
    $('notice').textContent = typeof reason === 'string' ? reason : '';
    $('hint').hidden = true;
    state.live = false;
    if (unsub) unsub();
    source.stop();
    const b = band;
    source = band = unsub = null;
    if (b) await b.stop();
    Object.assign(state, { pulse: 0, breathRate: 0, ripples: [] });
    $('mute').textContent = 'Mute';
    $('mute').setAttribute('aria-pressed', 'false');
    $('hud').hidden = true;
    $('intro').hidden = false;
  }

  // The camera mode needs server.js (npm start); it can't work from a double-clicked file.
  if (location.protocol.startsWith('http')) {
    $('presageOption').classList.remove('disabled');
    $('presageOption').querySelector('input').disabled = false;
    $('presageNote').textContent = '(real pulse + breathing · uses free minutes · auto-stops after 2 min)';
  }

  $('begin').addEventListener('click', begin);
  $('stop').addEventListener('click', (e) => { e.stopPropagation(); end(); });
  $('mute').addEventListener('click', (e) => {
    e.stopPropagation();
    const m = !band.muted;
    band.setMuted(m);
    $('mute').textContent = m ? 'Unmute' : 'Mute';
    $('mute').setAttribute('aria-pressed', String(m));
  });
  // HUD buttons shouldn't count as "inhale" presses in manual mode
  $('hud').addEventListener('pointerdown', (e) => e.stopPropagation());
  $('hud').addEventListener('pointerup', (e) => e.stopPropagation());
})();

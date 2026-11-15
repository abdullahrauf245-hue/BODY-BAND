/* BODYBAND console: wires a signal source to the music engine and the on-screen instruments.
 *
 * Two loops, on purpose:
 *   - signal events (a steady timer inside the source) update the numbers and the music;
 *   - render() runs only when the browser is about to paint, and draws the latest numbers.
 * So the music keeps time even if drawing is slow or the window is in the background,
 * and nothing is drawn that nobody can see.
 */
(function () {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ARC_LEN = 2 * Math.PI * 195; // length of the breath arc on the dial
  const CAMERA_LIMIT = 120;          // seconds, matches server.js
  const WAVE_POINTS = 120;           // samples in the breath trace on the plate
  const WAVE_PERIOD = 1 / 30;        // seconds between trace samples
  const TEXT_PERIOD = 0.095;         // seconds between text refreshes (about 10 a second)
  const WAVE_X = Array.from({ length: WAVE_POINTS }, (_, i) => (i * 160 / (WAVE_POINTS - 1)).toFixed(1));

  const SOURCES = {
    sim: { chip: 'SENSOR: SIMULATED', label: 'SOURCE: SIMULATED BODY' },
    manual: { chip: 'SENSOR: MANUAL', label: 'SOURCE: MANUAL — HOLD SPACE OR PRESS THE STAGE TO INHALE' },
    presage: { chip: 'SENSOR: CAMERA', label: 'SOURCE: SMARTSPECTRA CAMERA' },
  };

  // Breathing guides: [label, seconds] steps. The needle shows the guide; the arc shows you.
  const PACERS = {
    free: null,
    relax: [['INHALE', 4], ['HOLD', 7], ['EXHALE', 8]],
    box: [['INHALE', 4], ['HOLD', 4], ['EXHALE', 4], ['HOLD', 4]],
    coherence: [['INHALE', 5.5], ['EXHALE', 5.5]],
  };

  let source = null, band = null, unsub = null, rafId = 0, starting = false;
  let selected = 'sim', pacer = 'free';
  const st = {};

  function resetState() {
    Object.assign(st, {
      breath: 0, pulse: 0, breathRate: 0, vel: 0, lastT: 0,
      phase: 'HOLD', cand: 'HOLD', candT: 0, phaseStart: 0, cycles: 0,
      beatGlow: 0, lastBeat: 0, intervals: [], hist: [], histDirty: false, waveAcc: 0,
      startT: 0, lastDraw: 0, nextText: 0, left: null,
    });
  }
  resetState();

  // ---------- page access ----------
  const els = {};
  const $ = (id) => els[id] || (els[id] = document.getElementById(id));

  // Readouts are refreshed many times a second, but most of the time the value is the
  // same as last time. Every repeated write goes through show(), which leaves the page
  // alone unless the value actually changed.
  const shown = {};
  function show(key, value, write) {
    if (shown[key] === value) return;
    shown[key] = value;
    write(value);
  }
  const setText = (id, text) => show(id, text, (v) => { $(id).textContent = v; });

  const drawArc = (v) => $('arc').setAttribute('stroke-dashoffset', v);
  const drawNeedle = (v) => { $('needle').style.transform = `rotate(${v}deg)`; };
  const drawPlate = (v) => { $('plate').style.transform = `scale(${v})`; };
  const drawWave = (v) => $('wave').setAttribute('points', v);
  const drawKnob = (v) => $('padKnob').style.setProperty('--turn', `${v}deg`);
  const drawNoteBar = (v) => { $('noteBar').style.width = `${v}%`; };

  // ---------- one-time build ----------
  const ticks = $('ticks');
  for (let a = 10; a < 360; a += 10) {
    if (a % 90 === 0) continue;
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', 250); l.setAttribute('x2', 250); l.setAttribute('y1', 20); l.setAttribute('y2', 25);
    l.setAttribute('transform', `rotate(${a} 250 250)`);
    ticks.appendChild(l);
  }
  const segs = Array.from({ length: 16 }, () => $('depthBar').appendChild(document.createElement('i')));
  const drawSegs = (lit) => segs.forEach((s, i) => { s.className = i < lit - 1 ? 'on' : i === lit - 1 ? 'tip' : ''; });
  $('arc').setAttribute('stroke-dasharray', ARC_LEN);

  const cameraAvailable = location.protocol.startsWith('http');
  if (cameraAvailable) {
    $('camSourceBtn').disabled = false;
    $('camSourceBtn').title = 'Real pulse and breathing from the camera (uses free minutes)';
    $('useCamBtn').disabled = false;
  } else {
    setText('camHint', 'RUN "NPM START" TO ENABLE');
  }

  // ---------- helpers ----------
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  /** Where the breathing guide is at time t: what to do, and how full the lungs should be (0..1). */
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

  function setPressed(selector, attr, value) {
    document.querySelectorAll(selector).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  }

  function selectSource(name) {
    if (source) return; // locked while a session runs
    selected = name;
    setPressed('[data-source]', 'source', name);
    setText('subSource', SOURCES[name].label);
  }

  function setMuted(m) {
    if (band) band.setMuted(m);
    $('muteBtn').setAttribute('aria-pressed', String(m));
    $('muteSlash').setAttribute('visibility', m ? 'visible' : 'hidden');
    setText('outBtn', m ? 'MUTED' : 'ENGAGED');
    $('outBtn').classList.toggle('off', m);
  }

  // ---------- signal side: numbers and music (steady timer, about 60 a second) ----------
  function onSignal(e) {
    const now = performance.now() / 1000;
    const dt = Math.max(now - st.lastT, 0.001);
    st.lastT = now;

    // which way is the breath going? (smoothed over ~0.1 s; a change must hold 0.2 s to count)
    st.vel += ((e.breath - st.breath) / dt - st.vel) * (1 - Math.exp(-dt / 0.1));
    const cand = st.vel > 0.04 ? 'INHALING' : st.vel < -0.04 ? 'EXHALING' : 'HOLD';
    if (cand !== st.cand) { st.cand = cand; st.candT = now; }
    else if (cand !== st.phase && now - st.candT > 0.2) {
      st.phase = cand; st.phaseStart = now;
      if (cand === 'INHALING') st.cycles++;
    }

    st.breath = e.breath; st.pulse = e.pulse; st.breathRate = e.breathRate;
    band.setBreath(e.breath);

    // sample the breath trace at a fixed rate, whatever the tick or drawing rate
    st.waveAcc += dt;
    if (st.waveAcc >= WAVE_PERIOD) {
      st.waveAcc %= WAVE_PERIOD;
      st.hist.push(e.breath);
      if (st.hist.length > WAVE_POINTS) st.hist.shift();
      st.histDirty = true;
    }
  }

  function onBeat() {
    const now = performance.now();
    if (st.lastBeat) {
      st.intervals.push(Math.round(now - st.lastBeat));
      if (st.intervals.length > 3) st.intervals.shift();
      $('ibi').innerHTML = `${st.intervals.join(' | ')} <b>ms</b>`;
    }
    st.lastBeat = now;
    st.beatGlow = 1;
    $('beatLed').classList.add('on');
    setTimeout(() => $('beatLed').classList.remove('on'), 90);
    band.beat(st.pulse);
  }

  // ---------- drawing side: only when the browser paints ----------
  function restDial() {
    show('arc', ARC_LEN.toFixed(1), drawArc);
    show('needle', '0.0', drawNeedle);
    show('plate', '1.0000', drawPlate);
    show('lit', 0, drawSegs);
  }

  function drawDial(guide) {
    const b = st.breath;
    show('arc', (ARC_LEN * (1 - b)).toFixed(1), drawArc);
    show('needle', ((guide ? guide.level : b) * 360).toFixed(1), drawNeedle);
    const pulse = reduceMotion ? 0 : st.beatGlow * 0.015;
    show('plate', (0.96 + b * 0.07 + pulse).toFixed(4), drawPlate);
    show('lit', Math.round(b * 16), drawSegs);

    if (st.histDirty) {
      st.histDirty = false;
      let pts = '';
      for (let i = 0; i < st.hist.length; i++) pts += `${WAVE_X[i]},${Math.round((26 - st.hist[i] * 22) * 10) / 10} `;
      show('wave', pts, drawWave);
    }
  }

  function drawText(now, guide) {
    setText('bpm', st.pulse ? String(Math.round(st.pulse)) : '--');
    setText('rpm', st.breathRate ? st.breathRate.toFixed(1) : '--');
    setText('cycleSec', st.breathRate ? `${(60 / st.breathRate).toFixed(1)} s / CYCLE` : '-- s / CYCLE');
    setText('cycleCount', `CYCLES: ${st.cycles}`);
    setText('depthPct', `${Math.round(st.breath * 100)}%`);
    setText('phaseTag', st.phase);
    setText('plateLeft', `CYCLE: ${String(st.cycles).padStart(2, '0')}`);

    if (guide) {
      setText('phase', guide.label);
      setText('guideTag', `YOU: ${st.phase}`);
      setText('phaseLabel', 'NEXT STEP IN');
      setText('phaseTime', `${guide.left.toFixed(1)}s`);
    } else {
      setText('phase', st.phase);
      setText('guideTag', 'FREE');
      setText('phaseLabel', 'PHASE TIME');
      setText('phaseTime', `${(now - st.phaseStart).toFixed(1)}s`);
    }

    setText('cutoffVal', `${Math.round(band.cutoff || 220)} Hz`);
    show('knob', (-135 + st.breath * 270).toFixed(0), drawKnob);
    if (band.lastNote) {
      setText('noteName', band.lastNote.name);
      setText('noteHz', `${band.lastNote.hz.toFixed(1)} Hz`);
      show('noteBar', Math.round(band.lastNote.level * 100), drawNoteBar);
    }
    setText('elapsed', mmss(now - st.startT));
    if (st.left !== null) setText('camLeft', mmss(st.left));
  }

  function render() {
    if (!source) return; // session over: let the loop end
    const now = performance.now() / 1000;
    st.beatGlow *= Math.exp(-Math.min(now - st.lastDraw, 0.25) / 0.16);
    st.lastDraw = now;

    const steps = PACERS[pacer];
    const guide = steps ? guideAt(steps, now - st.startT) : null;
    drawDial(guide);
    if (now >= st.nextText) { st.nextText = now + TEXT_PERIOD; drawText(now, guide); }
    rafId = requestAnimationFrame(render);
  }

  // ---------- session ----------
  function showLive(live) {
    const cam = live && selected === 'presage';
    setText('ctaText', live ? 'STOP SESSION' : 'START SESSION');
    $('ctaLed').className = live ? 'led red' : 'led off';
    $('playIcon').innerHTML = live ? '<rect x="5" y="5" width="14" height="14"/>' : '<path d="M7 4l13 8-13 8z"/>';
    $('playBtn').setAttribute('aria-label', live ? 'Stop session' : 'Start session');
    setText('sensorChip', live ? SOURCES[selected].chip : 'SENSOR: IDLE');
    setText('engine', live ? 'AUDIO ENGINE ONLINE' : 'AUDIO ENGINE IDLE');
    setText('limit', cam ? mmss(CAMERA_LIMIT) : '--:--');
    setText('camText', cam ? 'CAM FEED: ACTIVE' : 'CAM FEED: OFF');
    $('camLed').className = cam ? 'led' : 'led off';
    $('camStateLed').className = cam ? 'led' : 'led off';
    setText('camStateText', cam ? 'ONLINE' : 'STANDBY');
    $('camState').classList.toggle('live', cam);
    if (cameraAvailable) setText('camHint', cam ? 'STARTING…' : 'CAMERA OFF');
    document.querySelectorAll('[data-source]').forEach((b) => {
      b.disabled = live || (b.dataset.source === 'presage' && !cameraAvailable);
    });
    $('useCamBtn').disabled = live || !cameraAvailable;
  }

  async function begin() {
    if (source || starting) return;
    starting = true; // a second click while the audio engine is starting must not stop a half-built session
    try {
      // Camera sessions use SDK minutes: ask first, and let the person check light and framing for free.
      if (selected === 'presage' && !(await CamCheck.open())) return;
      resetState();
      if (document.activeElement) document.activeElement.blur();
      source = selected === 'manual' ? new Signals.ManualSource($('stage'))
        : selected === 'presage' ? new Signals.PresageSource()
        : new Signals.SimulatedSource();
      setText('subNotice', 'RUNNING');
      band = new BodyBand();
      await band.start();
      setMuted($('muteBtn').getAttribute('aria-pressed') === 'true');
      setText('sampleRate', `${(band.ctx.sampleRate / 1000).toFixed(1)} kHz`);

      st.startT = st.lastT = st.phaseStart = st.lastDraw = performance.now() / 1000;
      showLive(true);

      unsub = source.on((e) => {
        if (e.type === 'frame') onSignal(e);
        else if (e.type === 'beat') onBeat();
        else if (e.type === 'status') {
          setText('camHint', e.text || 'READING VITALS');
          setText('subNotice', e.text || 'RUNNING');
        } else if (e.type === 'time') {
          st.left = e.left;
          if (e.width) {
            setText('camFeed', `${e.width}×${e.height} · ${e.fps} FPS`);
            $('camFeed').classList.toggle('bad', e.fps < 25); // the SDK won't measure below 25
          }
        } else if (e.type === 'ended') end(e.reason);
      });
      source.start();
      if (selected === 'presage') CamView.start($('camView'), $('viewfinder'));
      rafId = requestAnimationFrame(render);
    } finally {
      starting = false;
    }
  }

  async function end(reason) {
    if (!source) return;
    if (unsub) unsub();
    source.stop();
    CamView.stop();
    cancelAnimationFrame(rafId);
    const b = band;
    source = band = unsub = null;
    showLive(false);
    setText('subNotice', typeof reason === 'string' ? reason : 'STOPPED');
    setText('phase', 'STANDBY');
    setText('phaseTag', 'STANDBY');
    setText('guideTag', pacer === 'free' ? 'FREE' : 'GUIDE SET');
    setText('camLeft', '--:--');
    setText('camFeed', '--');
    $('camFeed').classList.remove('bad');
    setText('phaseLabel', 'PHASE TIME');
    setText('phaseTime', '-.-s');
    restDial();
    if (b) await b.stop();
  }

  const toggle = () => { if (!starting) (source ? end() : begin()); };

  // ---------- controls ----------
  restDial();
  showLive(false);
  $('cta').addEventListener('click', toggle);
  $('playBtn').addEventListener('click', toggle);
  $('muteBtn').addEventListener('click', () => setMuted($('muteBtn').getAttribute('aria-pressed') !== 'true'));
  $('outBtn').addEventListener('click', () => setMuted($('muteBtn').getAttribute('aria-pressed') !== 'true'));
  $('useCamBtn').addEventListener('click', () => selectSource('presage'));
  document.querySelectorAll('[data-source]').forEach((b) => b.addEventListener('click', () => selectSource(b.dataset.source)));
  document.querySelectorAll('[data-pacer]').forEach((b) => b.addEventListener('click', () => {
    pacer = b.dataset.pacer;
    setPressed('[data-pacer]', 'pacer', pacer);
    if (!source) setText('guideTag', pacer === 'free' ? 'FREE' : 'GUIDE SET');
  }));
})();

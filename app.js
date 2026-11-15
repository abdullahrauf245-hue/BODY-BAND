/* BODYBAND console: wires a signal source to the music engine and the on-screen instruments. */
(function () {
  const $ = (id) => document.getElementById(id);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ARC_LEN = 2 * Math.PI * 195; // length of the breath arc on the dial
  const CAMERA_LIMIT = 120;          // seconds, matches server.js

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

  let source = null, band = null, unsub = null;
  let selected = 'sim', pacer = 'free';
  const st = {};

  function resetState() {
    Object.assign(st, {
      breath: 0, pulse: 0, breathRate: 0, vel: 0, lastT: 0,
      phase: 'HOLD', cand: 'HOLD', candT: 0, phaseStart: 0, cycles: 0,
      beatGlow: 0, lastBeat: 0, intervals: [], hist: [], frame: 0, startT: 0, left: null,
    });
  }
  resetState();

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
  $('arc').setAttribute('stroke-dasharray', ARC_LEN);

  const cameraAvailable = location.protocol.startsWith('http');
  if (cameraAvailable) {
    $('camSourceBtn').disabled = false;
    $('camSourceBtn').title = 'Real pulse and breathing from the camera (uses free minutes)';
    $('useCamBtn').disabled = false;
  } else {
    $('camHint').textContent = 'RUN "NPM START" TO ENABLE';
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
    $('subSource').textContent = SOURCES[name].label;
  }

  function setMuted(m) {
    if (band) band.setMuted(m);
    $('muteBtn').setAttribute('aria-pressed', String(m));
    $('muteSlash').setAttribute('visibility', m ? 'visible' : 'hidden');
    $('outBtn').textContent = m ? 'MUTED' : 'ENGAGED';
    $('outBtn').classList.toggle('off', m);
  }

  // ---------- drawing ----------
  function drawDial(guide) {
    const b = st.breath;
    $('arc').setAttribute('stroke-dashoffset', ARC_LEN * (1 - b));
    $('needle').style.transform = `rotate(${(guide ? guide.level : b) * 360}deg)`;
    const pulse = reduceMotion ? 0 : st.beatGlow * 0.015;
    $('plate').style.transform = `scale(${0.96 + b * 0.07 + pulse})`;

    const lit = Math.round(b * 16);
    segs.forEach((s, i) => { s.className = i < lit - 1 ? 'on' : i === lit - 1 ? 'tip' : ''; });

    if (st.frame % 2 === 0) {
      st.hist.push(b);
      if (st.hist.length > 120) st.hist.shift();
      $('wave').setAttribute('points', st.hist.map((v, i) => `${(i * 160 / 119).toFixed(1)},${(26 - v * 22).toFixed(1)}`).join(' '));
    }
  }

  function drawText(now, guide) {
    $('bpm').textContent = st.pulse ? Math.round(st.pulse) : '--';
    $('rpm').textContent = st.breathRate ? st.breathRate.toFixed(1) : '--';
    $('cycleSec').textContent = st.breathRate ? `${(60 / st.breathRate).toFixed(1)} s / CYCLE` : '-- s / CYCLE';
    $('cycleCount').textContent = `CYCLES: ${st.cycles}`;
    $('depthPct').textContent = `${Math.round(st.breath * 100)}%`;
    $('phaseTag').textContent = st.phase;
    $('plateLeft').textContent = `CYCLE: ${String(st.cycles).padStart(2, '0')}`;

    if (guide) {
      $('phase').textContent = guide.label;
      $('guideTag').textContent = `YOU: ${st.phase}`;
      $('phaseLabel').textContent = 'NEXT STEP IN';
      $('phaseTime').textContent = `${guide.left.toFixed(1)}s`;
    } else {
      $('phase').textContent = st.phase;
      $('guideTag').textContent = 'FREE';
      $('phaseLabel').textContent = 'PHASE TIME';
      $('phaseTime').textContent = `${(now - st.phaseStart).toFixed(1)}s`;
    }

    if (band) {
      $('cutoffVal').textContent = `${Math.round(band.cutoff || 220)} Hz`;
      $('padKnob').style.setProperty('--turn', `${-135 + st.breath * 270}deg`);
      if (band.lastNote) {
        $('noteName').textContent = band.lastNote.name;
        $('noteHz').textContent = `${band.lastNote.hz.toFixed(1)} Hz`;
        $('noteBar').style.width = `${Math.round(band.lastNote.level * 100)}%`;
      }
    }
    $('elapsed').textContent = mmss(now - st.startT);
    if (st.left !== null) $('camLeft').textContent = mmss(st.left);
  }

  function onFrame(e) {
    const now = performance.now() / 1000;
    const dt = Math.max(now - st.lastT, 0.001);
    st.lastT = now;

    // which way is the breath going? (smoothed, and a change must hold for 0.2s to count)
    st.vel += ((e.breath - st.breath) / dt - st.vel) * 0.15;
    const cand = st.vel > 0.04 ? 'INHALING' : st.vel < -0.04 ? 'EXHALING' : 'HOLD';
    if (cand !== st.cand) { st.cand = cand; st.candT = now; }
    else if (cand !== st.phase && now - st.candT > 0.2) {
      st.phase = cand; st.phaseStart = now;
      if (cand === 'INHALING') st.cycles++;
    }

    st.breath = e.breath; st.pulse = e.pulse; st.breathRate = e.breathRate;
    st.beatGlow *= 0.9;
    st.frame++;
    band.setBreath(e.breath);

    const steps = PACERS[pacer];
    const guide = steps ? guideAt(steps, now - st.startT) : null;
    drawDial(guide);
    if (st.frame % 6 === 0) drawText(now, guide);
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

  // ---------- session ----------
  function showLive(live) {
    const cam = live && selected === 'presage';
    $('ctaText').textContent = live ? 'STOP SESSION' : 'START SESSION';
    $('ctaLed').className = live ? 'led red' : 'led off';
    $('playIcon').innerHTML = live ? '<rect x="5" y="5" width="14" height="14"/>' : '<path d="M7 4l13 8-13 8z"/>';
    $('playBtn').setAttribute('aria-label', live ? 'Stop session' : 'Start session');
    $('sensorChip').textContent = live ? SOURCES[selected].chip : 'SENSOR: IDLE';
    $('engine').textContent = live ? 'AUDIO ENGINE ONLINE' : 'AUDIO ENGINE IDLE';
    $('limit').textContent = cam ? mmss(CAMERA_LIMIT) : '--:--';
    $('camText').textContent = cam ? 'CAM FEED: ACTIVE' : 'CAM FEED: OFF';
    $('camLed').className = cam ? 'led' : 'led off';
    $('camStateLed').className = cam ? 'led' : 'led off';
    $('camStateText').textContent = cam ? 'ONLINE' : 'STANDBY';
    $('camState').classList.toggle('live', cam);
    if (cameraAvailable) $('camHint').textContent = cam ? 'STARTING…' : 'CAMERA OFF';
    document.querySelectorAll('[data-source]').forEach((b) => {
      b.disabled = live || (b.dataset.source === 'presage' && !cameraAvailable);
    });
    $('useCamBtn').disabled = live || !cameraAvailable;
  }

  async function begin() {
    if (source) return;
    resetState();
    if (document.activeElement) document.activeElement.blur();
    source = selected === 'manual' ? new Signals.ManualSource($('stage'))
      : selected === 'presage' ? new Signals.PresageSource()
      : new Signals.SimulatedSource();
    $('subNotice').textContent = 'RUNNING';
    band = new BodyBand();
    await band.start();
    setMuted($('muteBtn').getAttribute('aria-pressed') === 'true');
    $('sampleRate').textContent = `${(band.ctx.sampleRate / 1000).toFixed(1)} kHz`;

    st.startT = st.lastT = st.phaseStart = performance.now() / 1000;
    showLive(true);

    unsub = source.on((e) => {
      if (e.type === 'frame') onFrame(e);
      else if (e.type === 'beat') onBeat();
      else if (e.type === 'status') {
        $('camHint').textContent = e.text || 'READING VITALS';
        $('subNotice').textContent = e.text || 'RUNNING';
      } else if (e.type === 'time') st.left = e.left;
      else if (e.type === 'ended') end(e.reason);
    });
    source.start();
  }

  async function end(reason) {
    if (!source) return;
    if (unsub) unsub();
    source.stop();
    const b = band;
    source = band = unsub = null;
    showLive(false);
    $('subNotice').textContent = typeof reason === 'string' ? reason : 'STOPPED';
    $('phase').textContent = 'STANDBY';
    $('phaseTag').textContent = 'STANDBY';
    $('guideTag').textContent = pacer === 'free' ? 'FREE' : 'GUIDE SET';
    $('camLeft').textContent = '--:--';
    $('phaseLabel').textContent = 'PHASE TIME';
    $('phaseTime').textContent = '-.-s';
    $('arc').setAttribute('stroke-dashoffset', ARC_LEN);
    $('needle').style.transform = 'rotate(0deg)';
    $('plate').style.transform = '';
    segs.forEach((s) => { s.className = ''; });
    if (b) await b.stop();
  }

  const toggle = () => (source ? end() : begin());

  // ---------- controls ----------
  $('arc').setAttribute('stroke-dashoffset', ARC_LEN);
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
    if (!source) $('guideTag').textContent = pacer === 'free' ? 'FREE' : 'GUIDE SET';
  }));
})();

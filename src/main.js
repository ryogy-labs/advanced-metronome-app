import './style.css';

(() => {
  // ──── State ────
  let bpm = 120;
  let beatsPerMeasure = 4;
  // Time signature picker state
  let tsNum = 4;          // numerator  : 2-7
  let tsDen = 4;          // denominator: 4 or 8
  let masterVol = 1.0;
  let volBeat1 = 1.0, volQuarter = 0.8, volEighth = 0.5, volSixteenth = 0.0;
  let running = false;
  let isEditingBpm = false;
  let bpmBeforeEdit = 120;

  // Tap tempo
  let tapTimes = [];
  const TAP_RESET_MS = 2500;

  // AudioContext & scheduling (always runs at 16th note resolution)
  let audioCtx = null;
  let nextNoteTime = 0;
  let lookahead = 25.0;     // ms
  let scheduleAhead = 0.1;  // sec
  let timerID = null;
  let subBeatCount = 0;     // 16th note position within measure

  // Ball animation
  let scheduledBeatTimes = []; // { time: audioCtxTime, beatIdx }
  let squashEnabled = true;
  let animMode = 'vertical'; // 'vertical' | 'horizontal'

  // ──── DOM ────
  const bpmDisplay      = document.getElementById('bpmDisplay');
  const bpmSlider       = document.getElementById('bpmSlider');
  const beatRow         = document.getElementById('beatRow');
  const beatRowSetlist  = document.getElementById('beatRowSetlist');
  const beatRowLibrary  = document.getElementById('beatRowLibrary');
  const beatRowEls      = [beatRow, beatRowSetlist, beatRowLibrary].filter(Boolean);
  const playBtn         = document.getElementById('playBtn');
  const tapBtn          = document.getElementById('tapBtn');
  // Time sig picker elements
  const tsNumValEl      = document.getElementById('tsNumVal');
  const tsDenValEl      = document.getElementById('tsDenVal');
  // Swipe panel
  const swipePagesEl    = document.getElementById('swipePages');
  const pageDotEls      = document.querySelectorAll('.page-dot');

  const volMasterEl     = document.getElementById('volMaster');
  const volMasterNum    = document.getElementById('volMasterNum');
  const volBeat1El      = document.getElementById('volBeat1');
  const volQuarterEl    = document.getElementById('volQuarter');
  const volEighthEl     = document.getElementById('volEighth');
  const volSixteenthEl  = document.getElementById('volSixteenth');
  const volBeat1Num     = document.getElementById('volBeat1Num');
  const volQuarterNum   = document.getElementById('volQuarterNum');
  const volEighthNum    = document.getElementById('volEighthNum');
  const volSixteenthNum = document.getElementById('volSixteenthNum');

  // ──── Beat dots ────
  function buildBeatDots() {
    beatRowEls.forEach(rowEl => {
      rowEl.innerHTML = '';
      for (let i = 0; i < beatsPerMeasure; i++) {
        const d = document.createElement('div');
        d.className = 'beat-dot';
        d.textContent = i + 1;
        rowEl.appendChild(d);
      }
    });
  }
  buildBeatDots();

  function flashBeat(beatIdx, scheduledTime) {
    // Skip visual updates in background, or if the beat is stale (> 0.5s off)
    if (document.hidden) return;
    if (audioCtx && typeof scheduledTime === 'number' &&
        Math.abs(audioCtx.currentTime - scheduledTime) > 0.5) return;
    beatRowEls.forEach(rowEl => {
      const dots = rowEl.querySelectorAll('.beat-dot');
      dots.forEach((d, i) => {
        d.classList.remove('active-1', 'active-n');
        if (i === beatIdx) {
          d.classList.add(beatIdx === 0 ? 'active-1' : 'active-n');
          setTimeout(() => d.classList.remove('active-1', 'active-n'), 100);
        }
      });
    });
  }

  // ──── Audio synthesis ────
  function getCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playClick(time, vol, freq, dur) {
    if (vol <= 0) return;
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(vol * 0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.start(time);
    osc.stop(time + dur + 0.01);
  }

  // ──── Scheduler (always 16th note resolution) ────
  function scheduleNote(time, subBeat) {
    const mod4    = subBeat % 4;
    const beatIdx = Math.floor(subBeat / 4);

    if (mod4 === 0) {
      // Track beat time for ball animation (keep last 8)
      scheduledBeatTimes.push({ time, beatIdx });
      if (scheduledBeatTimes.length > 8) scheduledBeatTimes.shift();

      // Quarter note position — also triggers visual flash
      const delay = (time - getCtx().currentTime) * 1000;
      setTimeout(() => flashBeat(beatIdx, time), Math.max(0, delay));
      if (beatIdx === 0) {
        playClick(time, volBeat1   * masterVol, 1200, 0.030);
      } else {
        playClick(time, volQuarter * masterVol,  900, 0.025);
      }
    } else if (mod4 === 2) {
      // Eighth note position
      playClick(time, volEighth    * masterVol, 700, 0.022);
    } else {
      // Sixteenth note position
      playClick(time, volSixteenth * masterVol, 550, 0.018);
    }
  }

  function scheduler() {
    const ctx = getCtx();
    const sixteenthInterval = 60 / bpm / 4;
    while (nextNoteTime < ctx.currentTime + scheduleAhead) {
      scheduleNote(nextNoteTime, subBeatCount);
      subBeatCount = (subBeatCount + 1) % (beatsPerMeasure * 4);
      nextNoteTime += sixteenthInterval;
    }
    timerID = setTimeout(scheduler, lookahead);
  }

  function startMetronome() {
    if (running) return;
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    running = true;
    subBeatCount = 0;
    nextNoteTime = ctx.currentTime + 0.05;
    scheduledBeatTimes = [];
    scheduler();
    bgAudioStart();
    playBtn.textContent = '■ STOP';
    playBtn.classList.add('running');
    updateNowPlayingState();
  }

  function stopMetronome() {
    if (!running) return;
    running = false;
    clearTimeout(timerID);
    bgAudioStop();
    scheduledBeatTimes = [];
    playBtn.textContent = '▶ START';
    playBtn.classList.remove('running');
    beatRowEls.forEach(rowEl => {
      rowEl.querySelectorAll('.beat-dot').forEach(d => d.classList.remove('active-1', 'active-n'));
    });
    updateNowPlayingState();
  }

  // ──── BPM helpers ────
  function setBPM(val) {
    bpm = Math.min(300, Math.max(20, Math.round(val)));
    bpmDisplay.textContent = bpm;
    bpmSlider.value = bpm;
    updateSliderFill(bpmSlider, 20, 300);
    if (running) refreshBgLoopTrack();
  }

  function updateSliderFill(slider, min, max) {
    const pct = ((slider.value - min) / (max - min)) * 100;
    slider.style.setProperty('--pct', pct + '%');
  }

  function updateVolSlider(slider, numEl) {
    updateSliderFill(slider, 0, 100);
    numEl.value = slider.value;
  }

  function parseVolumeInput(inputEl, fallback) {
    const raw = String(inputEl.value || '').trim();
    const typed = Number(raw);
    if (!Number.isFinite(typed)) return fallback;
    return Math.min(100, Math.max(0, Math.round(typed)));
  }

  function bindVolumeNumberInput(sliderEl, numEl, onApply) {
    const commit = () => {
      const next = parseVolumeInput(numEl, Number(sliderEl.value));
      sliderEl.value = String(next);
      updateVolSlider(sliderEl, numEl);
      onApply(next / 100);
      if (running) refreshBgLoopTrack();
    };
    numEl.addEventListener('change', commit);
    numEl.addEventListener('blur', commit);
    numEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        numEl.blur();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        updateVolSlider(sliderEl, numEl);
        numEl.blur();
      }
    });
  }

  // ──── Event listeners ────
  bpmSlider.addEventListener('input', () => setBPM(Number(bpmSlider.value)));

  function startBpmEdit() {
    if (isEditingBpm) return;
    isEditingBpm = true;
    bpmBeforeEdit = bpm;
    bpmDisplay.contentEditable = 'true';
    bpmDisplay.classList.add('bpm-editing');
    bpmDisplay.focus();
    const range = document.createRange();
    range.selectNodeContents(bpmDisplay);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function commitBpmEdit() {
    if (!isEditingBpm) return;
    const typed = Number(String(bpmDisplay.textContent || '').trim());
    if (Number.isFinite(typed)) setBPM(typed);
    else setBPM(bpmBeforeEdit);
    isEditingBpm = false;
    bpmDisplay.contentEditable = 'false';
    bpmDisplay.classList.remove('bpm-editing');
  }

  function cancelBpmEdit() {
    if (!isEditingBpm) return;
    setBPM(bpmBeforeEdit);
    isEditingBpm = false;
    bpmDisplay.contentEditable = 'false';
    bpmDisplay.classList.remove('bpm-editing');
  }

  bpmDisplay.addEventListener('click', startBpmEdit);
  bpmDisplay.addEventListener('blur', commitBpmEdit);
  bpmDisplay.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitBpmEdit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelBpmEdit();
    }
  });

  document.getElementById('bpmMinus10').addEventListener('click', () => setBPM(bpm - 10));
  document.getElementById('bpmMinus1').addEventListener('click',  () => setBPM(bpm - 1));
  document.getElementById('bpmPlus1').addEventListener('click',   () => setBPM(bpm + 1));
  document.getElementById('bpmPlus10').addEventListener('click',  () => setBPM(bpm + 10));

  // ──── Time Signature Picker ────
  const TS_NUMS = [2, 3, 4, 5, 6, 7];
  const TS_DENS = [4, 8];

  function applyTimeSig() {
    beatsPerMeasure = tsNum;
    tsNumValEl.textContent = tsNum;
    tsDenValEl.textContent = tsDen;
    buildBeatDots();
    if (running) refreshBgLoopTrack();
    if (running) { stopMetronome(); startMetronome(); }
  }

  document.getElementById('tsNumUp').addEventListener('click', () => {
    const idx = TS_NUMS.indexOf(tsNum);
    if (idx < TS_NUMS.length - 1) { tsNum = TS_NUMS[idx + 1]; applyTimeSig(); }
  });
  document.getElementById('tsNumDn').addEventListener('click', () => {
    const idx = TS_NUMS.indexOf(tsNum);
    if (idx > 0) { tsNum = TS_NUMS[idx - 1]; applyTimeSig(); }
  });
  document.getElementById('tsDenUp').addEventListener('click', () => {
    const idx = TS_DENS.indexOf(tsDen);
    if (idx < TS_DENS.length - 1) { tsDen = TS_DENS[idx + 1]; applyTimeSig(); }
  });
  document.getElementById('tsDenDn').addEventListener('click', () => {
    const idx = TS_DENS.indexOf(tsDen);
    if (idx > 0) { tsDen = TS_DENS[idx - 1]; applyTimeSig(); }
  });

  volMasterEl.addEventListener('input', () => {
    masterVol = volMasterEl.value / 100;
    updateVolSlider(volMasterEl, volMasterNum);
    if (running) refreshBgLoopTrack();
  });

  volBeat1El.addEventListener('input', () => {
    volBeat1 = volBeat1El.value / 100;
    updateVolSlider(volBeat1El, volBeat1Num);
    if (running) refreshBgLoopTrack();
  });
  volQuarterEl.addEventListener('input', () => {
    volQuarter = volQuarterEl.value / 100;
    updateVolSlider(volQuarterEl, volQuarterNum);
    if (running) refreshBgLoopTrack();
  });
  volEighthEl.addEventListener('input', () => {
    volEighth = volEighthEl.value / 100;
    updateVolSlider(volEighthEl, volEighthNum);
    if (running) refreshBgLoopTrack();
  });
  volSixteenthEl.addEventListener('input', () => {
    volSixteenth = volSixteenthEl.value / 100;
    updateVolSlider(volSixteenthEl, volSixteenthNum);
    if (running) refreshBgLoopTrack();
  });

  bindVolumeNumberInput(volMasterEl, volMasterNum, v => { masterVol = v; });
  bindVolumeNumberInput(volBeat1El, volBeat1Num, v => { volBeat1 = v; });
  bindVolumeNumberInput(volQuarterEl, volQuarterNum, v => { volQuarter = v; });
  bindVolumeNumberInput(volEighthEl, volEighthNum, v => { volEighth = v; });
  bindVolumeNumberInput(volSixteenthEl, volSixteenthNum, v => { volSixteenth = v; });

  playBtn.addEventListener('click', () => {
    running ? stopMetronome() : startMetronome();
  });

  tapBtn.addEventListener('click', tapTempo);

  function tapTempo() {
    const now = performance.now();
    tapTimes = tapTimes.filter(t => now - t < TAP_RESET_MS);
    tapTimes.push(now);
    if (tapTimes.length >= 2) {
      let total = 0;
      for (let i = 1; i < tapTimes.length; i++) total += tapTimes[i] - tapTimes[i - 1];
      setBPM(60000 / (total / (tapTimes.length - 1)));
    }
  }

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.isContentEditable) return;
    if (e.code === 'Space') { e.preventDefault(); running ? stopMetronome() : startMetronome(); }
    if (e.code === 'KeyT')  { tapTempo(); }
  });

  // ──── Init sliders ────
  updateSliderFill(bpmSlider, 20, 300);
  updateVolSlider(volMasterEl,    volMasterNum);
  updateVolSlider(volBeat1El,     volBeat1Num);
  updateVolSlider(volQuarterEl,   volQuarterNum);
  updateVolSlider(volEighthEl,    volEighthNum);
  updateVolSlider(volSixteenthEl, volSixteenthNum);

  // ── Mode toggle (移動方向: 縦 / 横) ──
  const modeVertical   = document.getElementById('modeVertical');
  const modeHorizontal = document.getElementById('modeHorizontal');

  function setMode(mode) {
    animMode = mode;
    modeVertical.classList.toggle('active',   mode === 'vertical');
    modeHorizontal.classList.toggle('active', mode === 'horizontal');
  }
  modeVertical.addEventListener('click',   () => setMode('vertical'));
  modeHorizontal.addEventListener('click', () => setMode('horizontal'));

  // ── Squash toggle ──
  const squashOnBtn  = document.getElementById('squashOnBtn');
  const squashOffBtn = document.getElementById('squashOffBtn');

  function setSquash(v) {
    squashEnabled = v;
    squashOnBtn.classList.toggle('active',   v);
    squashOffBtn.classList.toggle('active', !v);
  }
  squashOnBtn.addEventListener('click',  () => setSquash(true));
  squashOffBtn.addEventListener('click', () => setSquash(false));

  // ──── Ball Animation ────
  let ballCanvasViews = [];
  const BALL_TOP_MARGIN = 15; // px: desired gap from title bottom to apex top
  const BALL_RANGE_SCALE = 0.8; // shrink vertical travel by 20%
  const BALL_R     = 30;  // px: ball radius

  function refreshBallCanvases() {
    ballCanvasViews = Array.from(document.querySelectorAll('.ball-canvas'))
      .map(canvas => ({ canvas, ctx: canvas.getContext('2d') }))
      .filter(v => !!v.ctx);
  }

  function resizeBallCanvases() {
    ballCanvasViews.forEach(({ canvas }) => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (w > 0 && h > 0) {
        canvas.width  = w;
        canvas.height = h;
      }
    });
  }

  function syncVolumeSectionHeight() {
    const tsCards = Array.from(document.querySelectorAll('.ts-picker-wrap'));
    const targetH = tsCards.reduce((max, el) =>
      Math.max(max, Math.round(el.getBoundingClientRect().height)), 0);
    if (!targetH) return;
    document.querySelectorAll('.vol-section').forEach(el => {
      el.style.height = `${targetH}px`;
      const rows = Array.from(el.querySelectorAll('.vol-row'));
      if (rows.length === 0) return;
      const rowsTotal = rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
      const cs = getComputedStyle(el);
      const borderTop = parseFloat(cs.borderTopWidth) || 0;
      const borderBottom = parseFloat(cs.borderBottomWidth) || 0;
      const innerHeight = targetH - borderTop - borderBottom;
      const slot = Math.max(0, (innerHeight - rowsTotal) / (rows.length + 1));
      el.style.setProperty('--vol-vspace', `${slot}px`);
    });
  }

  function drawBallFrame(ctx, w, h, phase, beatIdx, topMargin) {
    ctx.clearRect(0, 0, w, h);

    const groundYBase = h - 10;
    const isBeat1 = beatIdx === 0;
    const margin = BALL_R + 4;
    const cx = animMode === 'horizontal'
      ? margin + ((beatIdx + phase) / beatsPerMeasure) * (w - 2 * margin)
      : w / 2;

    // Asymmetric free-fall height fraction (0 at ground, 1 at apex)
    // Rising (0→alpha): easeOutQuad — fast launch, decelerates to zero at apex
    // Falling (alpha→1): easeInCubic — starts near-zero at apex, accelerates to ground
    const alpha = 0.35;
    let heightFrac;
    if (phase <= alpha) {
      const t = phase / alpha;
      heightFrac = t * (2 - t);           // easeOutQuad: 0→1
    } else {
      const t = (phase - alpha) / (1 - alpha);
      heightFrac = 1 - t * t * t;         // easeInCubic: 1→0
    }

    // isGrounding: true only in the first half of each beat (just after landing).
    // Prevents false impact detection at phase≈1 end-of-beat where heightFrac
    // also approaches 0 but lastBeat still points to the previous beat.
    const isGrounding = phase < 0.5;

    // Squash when close to ground (only while running, enabled, and in landing half)
    const squash = (running && squashEnabled && isGrounding) ? Math.max(0, 1 - heightFrac * 8) : 0;
    const rx = BALL_R * (1 + 0.5 * squash);
    const ry = BALL_R * (1 - 0.3 * squash);

    // Fit jump height to canvas so apex sits near the top instead of leaving large blank space.
    const fullRange = Math.max(60, groundYBase - (BALL_R * 2) - topMargin);
    const ballMaxH = Math.max(60, fullRange * BALL_RANGE_SCALE);
    const groundY = ballMaxH + (BALL_R * 2) + topMargin;
    // Ball center: bottom of ellipse touches groundY when heightFrac=0
    const ballY = groundY - ry - heightFrac * ballMaxH;

    // Shadow (grows darker/larger as ball approaches ground)
    const shadowAlpha = 0.08 + 0.22 * (1 - heightFrac);
    const shadowRx    = BALL_R * (0.5 + 0.9 * (1 - heightFrac));
    ctx.save();
    ctx.fillStyle = `rgba(124, 92, 252, ${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(cx, groundY, shadowRx, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Ground line
    ctx.save();
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();
    ctx.restore();

    // Ball: flash pink only on Beat 1 impact; other beats stay purple
    const isImpact  = phase < 0.15 && running;
    const ballColor = (isImpact && isBeat1) ? '#fc5c7d' : '#7c5cfc';
    ctx.save();
    ctx.shadowColor = ballColor;
    ctx.shadowBlur  = (isImpact && isBeat1) ? 24 : 14;
    ctx.fillStyle   = ballColor;
    ctx.beginPath();
    ctx.ellipse(cx, ballY, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Call once immediately, then again after first paint when flex layout is complete
  refreshBallCanvases();
  resizeBallCanvases();
  syncVolumeSectionHeight();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    resizeBallCanvases();
    syncVolumeSectionHeight();
  }));
  window.addEventListener('resize', () => {
    resizeBallCanvases();
    syncVolumeSectionHeight();
  });

  function drawBall() {
    // Beat phase: 0 = ground contact, 0.5 = apex, 1 = next ground contact
    // Computed from the most recent scheduled beat that has already passed,
    // so it stays in sync even when BPM changes mid-play.
    let phase   = 0;
    let beatIdx = 0;
    if (running && audioCtx) {
      const now = audioCtx.currentTime;
      let lastBeat = null;
      for (let i = scheduledBeatTimes.length - 1; i >= 0; i--) {
        if (scheduledBeatTimes[i].time <= now) {
          lastBeat = scheduledBeatTimes[i];
          break;
        }
      }
      if (lastBeat) {
        const beatDur = 60 / bpm;
        phase   = Math.min((now - lastBeat.time) / beatDur, 1);
        beatIdx = lastBeat.beatIdx;
      }
    }

    ballCanvasViews.forEach(({ canvas, ctx }) => {
      if (canvas.width === 0 || canvas.height === 0) return;
      let topMargin = BALL_TOP_MARGIN;
      const pageEl = canvas.closest('.swipe-page');
      const titleEl = pageEl ? pageEl.querySelector('.swipe-page-title') : null;
      if (titleEl) {
        const titleRect = titleEl.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        // Make apex top sit 10px below the title bottom regardless of page/canvas spacing.
        topMargin = Math.max(0, (titleRect.bottom + BALL_TOP_MARGIN) - canvasRect.top);
      }
      drawBallFrame(ctx, canvas.width, canvas.height, phase, beatIdx, topMargin);
    });

    requestAnimationFrame(drawBall);
  }

  drawBall();

  // ──── iOS Background Playback ────
  // Foreground: WebAudio scheduler only.
  // Background: HTMLAudio click loop (Safari keeps this alive more reliably).
  let _bgLoopEl = null;
  let _bgLoopUrl = null;
  let _bgLoopSig = '';
  const BG_LOOP_MEASURES = 32;

  function buildClickLoopWavUrl() {
    const sig = [
      bpm, beatsPerMeasure,
      masterVol, volBeat1, volQuarter, volEighth, volSixteenth,
    ].join('|');
    if (_bgLoopUrl && _bgLoopSig === sig) return _bgLoopUrl;
    if (_bgLoopUrl) URL.revokeObjectURL(_bgLoopUrl);

    const rate = 22050;
    const beatDur = 60 / bpm;
    const beatSamples = Math.max(1, Math.round(rate * beatDur));
    const subSamples = Math.max(1, Math.floor(beatSamples / 4));
    const totalSamples = Math.max(1, beatSamples * beatsPerMeasure * BG_LOOP_MEASURES);
    const len = totalSamples;
    const ab = new ArrayBuffer(44 + len * 2);
    const dv = new DataView(ab);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };

    ws(0, 'RIFF'); dv.setUint32(4, 36 + len * 2, true);
    ws(8, 'WAVE'); ws(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    ws(36, 'data'); dv.setUint32(40, len * 2, true);

    const pcm = new Float32Array(len);
    const clickLen = Math.max(24, Math.floor(rate * 0.028));

    function addClick(samplePos, gain, freqHz) {
      if (gain <= 0) return;
      const amp = Math.min(0.9, gain * masterVol * 0.63);
      for (let i = 0; i < clickLen; i++) {
        const idx = samplePos + i;
        if (idx >= len) break;
        const t = i / rate;
        const env = Math.exp(-i / (clickLen * 0.22));
        pcm[idx] += Math.sin(2 * Math.PI * freqHz * t) * env * amp;
      }
    }

    for (let measure = 0; measure < BG_LOOP_MEASURES; measure++) {
      const measureBase = measure * beatSamples * beatsPerMeasure;
      for (let beat = 0; beat < beatsPerMeasure; beat++) {
        const base = measureBase + beat * beatSamples;
        addClick(base, beat === 0 ? volBeat1 : volQuarter, beat === 0 ? 1200 : 900);
        addClick(base + subSamples * 2, volEighth, 700);
        addClick(base + subSamples, volSixteenth, 550);
        addClick(base + subSamples * 3, volSixteenth, 550);
      }
    }

    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      dv.setInt16(44 + i * 2, s * 32767, true);
    }

    _bgLoopSig = sig;
    _bgLoopUrl = URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
    return _bgLoopUrl;
  }

  function initBgLoopEl() {
    if (_bgLoopEl) return;
    _bgLoopEl = new Audio();
    _bgLoopEl.loop = true;
    _bgLoopEl.preload = 'auto';
    _bgLoopEl.playsInline = true;
    _bgLoopEl.setAttribute('playsinline', '');
    _bgLoopEl.setAttribute('webkit-playsinline', '');
    _bgLoopEl.addEventListener('pause', () => {
      if (!running || !document.hidden) return;
      _bgLoopEl.play().catch(() => {});
    });
  }

  function refreshBgLoopTrack() {
    initBgLoopEl();
    const nextSrc = buildClickLoopWavUrl();
    if (_bgLoopEl.src !== nextSrc) {
      const wasPlaying = !_bgLoopEl.paused;
      _bgLoopEl.src = nextSrc;
      _bgLoopEl.load();
      if (wasPlaying) _bgLoopEl.play().catch(() => {});
    }
  }

  function bgAudioStart() {
    refreshBgLoopTrack();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    if (document.hidden) _bgLoopEl.play().catch(() => {});
  }

  function bgAudioStop() {
    if (_bgLoopEl) {
      _bgLoopEl.pause();
      _bgLoopEl.currentTime = 0;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!running || !audioCtx) return;
    if (document.hidden) {
      clearTimeout(timerID);
      timerID = null;
      bgAudioStart();
    } else {
      bgAudioStop();
      audioCtx.resume().catch(() => {});
      if (!timerID) {
        nextNoteTime = audioCtx.currentTime + 0.05;
        scheduler();
      }
    }
  });

  // ──── Setlists ────
  let setlists      = JSON.parse(localStorage.getItem('metro-setlists') || '[]');
  let currentSlId   = null;   // setlist shown in detail view
  let activeSongId  = null;   // song currently applied to metronome
  let activeSlId    = null;   // setlist that owns the active song
  let editingSlId   = null;   // setlist being edited (index form)
  let editingSongId = null;   // song being edited (detail form)
  let songLibrary   = JSON.parse(localStorage.getItem('metro-song-lib') || '[]');
  let activeLibSongId = null; // song currently selected from library tab
  let libSortMode   = 'manual'; // 'manual' | 'name' | 'bpm'
  let editingLibId  = null;

  function saveSetlists() {
    localStorage.setItem('metro-setlists', JSON.stringify(setlists));
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  // ── DOM refs ──
  const slIndexEl     = document.getElementById('slIndex');
  const slDetailEl    = document.getElementById('slDetail');
  const slDetailTitle = document.getElementById('slDetailTitle');
  const slIndexList   = document.getElementById('slIndexList');
  const slForm        = document.getElementById('slForm');
  const slNameInput   = document.getElementById('slName');
  const songList      = document.getElementById('songList');
  const presetForm    = document.getElementById('presetForm');
  const pfName        = document.getElementById('pfName');
  const pfBpm         = document.getElementById('pfBpm');
  const pfModeManual  = document.getElementById('pfModeManual');
  const pfModeLib     = document.getElementById('pfModeLib');
  const pfManual      = document.getElementById('pfManual');
  const pfLibPicker   = document.getElementById('pfLibPicker');
  const pfLibList     = document.getElementById('pfLibList');
  const libSongList   = document.getElementById('libSongList');
  const libForm       = document.getElementById('libForm');
  const libNameInput  = document.getElementById('libName');
  const libBpmInput   = document.getElementById('libBpm');
  const libSortManualBtn = document.getElementById('libSortManual');
  const libSortNameBtn   = document.getElementById('libSortName');
  const libSortBpmBtn    = document.getElementById('libSortBpm');

  // ── Sub-view navigation ──
  function showSlIndex() {
    slIndexEl.classList.add('active');
    slDetailEl.classList.remove('active');
    closeSlForm();
    closeSongForm();
    renderSetlists();
  }

  function showSlDetail(slId) {
    const sl = setlists.find(s => s.id === slId);
    if (!sl) return;
    currentSlId = slId;
    slDetailTitle.textContent = sl.name;
    slIndexEl.classList.remove('active');
    slDetailEl.classList.add('active');
    closeSongForm();
    renderSongs();
  }

  // ── Setlist index ──
  function renderSetlists() {
    if (setlists.length === 0) {
      slIndexList.innerHTML = '<div class="setlist-empty">セットリストを追加してください</div>';
      return;
    }
    slIndexList.innerHTML = setlists.map((sl, idx) => `
      <div class="sl-row" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <button class="sl-row-btn" data-id="${sl.id}">
          <span class="sl-row-title">${escHtml(sl.name)}</span>
          <span class="sl-row-count">${sl.songs.length}曲</span>
        </button>
        <button class="preset-icon-btn" data-id="${sl.id}" data-action="edit-sl" title="編集">✏</button>
        <button class="preset-icon-btn del" data-id="${sl.id}" data-action="del-sl" title="削除">✕</button>
      </div>
    `).join('');

    slIndexList.querySelectorAll('.sl-row-btn').forEach(btn =>
      btn.addEventListener('click', () => showSlDetail(btn.dataset.id)));
    slIndexList.querySelectorAll('[data-action="edit-sl"]').forEach(btn =>
      btn.addEventListener('click', () => openEditSlForm(btn.dataset.id)));
    slIndexList.querySelectorAll('[data-action="del-sl"]').forEach(btn =>
      btn.addEventListener('click', () => deleteSetlist(btn.dataset.id)));
  }

  function openAddSlForm() {
    editingSlId = null;
    slNameInput.value = '';
    slForm.style.display = 'block';
    slNameInput.focus();
  }

  function openEditSlForm(id) {
    const sl = setlists.find(s => s.id === id);
    if (!sl) return;
    editingSlId = id;
    slNameInput.value = sl.name;
    slForm.style.display = 'block';
    slNameInput.focus();
  }

  function closeSlForm() {
    editingSlId = null;
    if (slForm) slForm.style.display = 'none';
  }

  function saveSlForm() {
    const name = slNameInput.value.trim();
    if (!name) { slNameInput.focus(); return; }
    if (editingSlId) {
      const sl = setlists.find(s => s.id === editingSlId);
      if (sl) {
        sl.name = name;
        if (currentSlId === editingSlId) slDetailTitle.textContent = name;
      }
    } else {
      setlists.push({ id: Date.now().toString(), name, songs: [] });
    }
    saveSetlists();
    closeSlForm();
    renderSetlists();
  }

  function deleteSetlist(id) {
    if (!confirm('このセットリストを削除しますか？')) return;
    setlists = setlists.filter(s => s.id !== id);
    if (activeSlId === id) { activeSongId = null; activeSlId = null; updateNowPlaying(); }
    saveSetlists();
    renderSetlists();
  }

  // ── Song list ──
  function currentSetlist() { return setlists.find(s => s.id === currentSlId); }

  function renderSongs() {
    const sl = currentSetlist();
    if (!sl) return;
    if (sl.songs.length === 0) {
      songList.innerHTML = '<div class="setlist-empty">曲を追加してください</div>';
      return;
    }
    songList.innerHTML = sl.songs.map((p, idx) => `
      <div class="preset-row${activeSongId === p.id ? ' active' : ''}" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <button class="preset-apply" data-id="${p.id}">
          <span class="preset-num">${idx + 1}</span>
          <span class="preset-name">${escHtml(p.name) || '(無題)'}</span>
          <span class="preset-bpm">${escHtml(p.bpm)} BPM</span>
        </button>
        <button class="preset-icon-btn" data-id="${p.id}" data-action="edit" title="編集">✏</button>
        <button class="preset-icon-btn del" data-id="${p.id}" data-action="del" title="削除">✕</button>
      </div>
    `).join('');

    songList.querySelectorAll('.preset-apply').forEach(btn =>
      btn.addEventListener('click', () => applySong(btn.dataset.id)));
    songList.querySelectorAll('[data-action="edit"]').forEach(btn =>
      btn.addEventListener('click', () => openEditSongForm(btn.dataset.id)));
    songList.querySelectorAll('[data-action="del"]').forEach(btn =>
      btn.addEventListener('click', () => deleteSong(btn.dataset.id)));
  }

  function applySong(id) {
    const sl = currentSetlist();
    if (!sl) return;
    const p = sl.songs.find(s => s.id === id);
    if (!p) return;
    if (activeSongId === id) {
      // Same song tapped again: toggle play/stop
      if (running) stopMetronome(); else startMetronome();
    } else {
      // New song: switch BPM and auto-start
      activeLibSongId = null;
      activeSongId = id;
      activeSlId   = currentSlId;
      setBPM(p.bpm);
      renderSongs();
      updateNowPlaying();
      startMetronome();
    }
  }

  function applyLibrarySong(id) {
    const s = songLibrary.find(song => song.id === id);
    if (!s) return;
    if (activeLibSongId === id) {
      // Same song tapped again: toggle play/stop
      if (running) stopMetronome(); else startMetronome();
      return;
    }
    // New library song: switch BPM and auto-start
    activeLibSongId = id;
    activeSongId = null;
    activeSlId = null;
    setBPM(s.bpm);
    renderLibrary();
    updateNowPlaying();
    startMetronome();
  }

  function openAddSongForm() {
    editingSongId = null;
    setFormMode('manual');
    pfName.value = '';
    pfBpm.value  = bpm;
    presetForm.style.display = 'block';
    pfName.focus();
  }

  function openEditSongForm(id) {
    const sl = currentSetlist();
    if (!sl) return;
    const p = sl.songs.find(s => s.id === id);
    if (!p) return;
    editingSongId = id;
    setFormMode('manual');
    pfName.value = p.name;
    pfBpm.value  = p.bpm;
    presetForm.style.display = 'block';
    pfName.focus();
  }

  function closeSongForm() {
    editingSongId = null;
    if (presetForm) presetForm.style.display = 'none';
  }

  function saveSongForm() {
    const sl = currentSetlist();
    if (!sl) return;
    const name   = pfName.value.trim();
    const bpmVal = Math.min(300, Math.max(20, parseInt(pfBpm.value) || bpm));
    if (!name) { pfName.focus(); return; }
    if (editingSongId) {
      const idx = sl.songs.findIndex(s => s.id === editingSongId);
      if (idx !== -1) {
        sl.songs[idx] = { ...sl.songs[idx], name, bpm: bpmVal };
        if (activeSongId === editingSongId) setBPM(bpmVal);
      }
    } else {
      sl.songs.push({ id: Date.now().toString(), name, bpm: bpmVal });
    }
    saveSetlists();
    closeSongForm();
    renderSongs();
  }

  function deleteSong(id) {
    const sl = currentSetlist();
    if (!sl) return;
    if (!confirm('この曲を削除しますか？')) return;
    sl.songs = sl.songs.filter(s => s.id !== id);
    if (activeSongId === id) { activeSongId = null; updateNowPlaying(); }
    saveSetlists();
    renderSongs();
  }

  function updateNowPlayingState() {
    const el = document.getElementById('nowPlaying');
    if (!el || el.style.display === 'none') return;
    el.classList.toggle('paused', !running);
    const icon = el.querySelector('.np-icon');
    if (icon) icon.textContent = running ? '▶' : '■';
  }

  function updateNowPlaying() {
    const el = document.getElementById('nowPlaying');
    if (!el) return;
    if (activeSongId && activeSlId) {
      const sl = setlists.find(s => s.id === activeSlId);
      const p  = sl ? sl.songs.find(s => s.id === activeSongId) : null;
      if (p) {
        document.getElementById('nowPlayingName').textContent = p.name || '(無題)';
        document.getElementById('nowPlayingBpm').textContent  = p.bpm + ' BPM';
        el.style.display = 'flex';
        updateNowPlayingState();
        return;
      }
    }
    el.style.display = 'none';
  }

  // ── Now Playing: click to toggle metronome ──
  document.getElementById('nowPlaying').addEventListener('click', () => {
    if (!activeSongId) return;
    if (running) stopMetronome(); else startMetronome();
  });

  // ── Setlist event listeners ──
  document.getElementById('btnAddSetlist').addEventListener('click', openAddSlForm);
  document.getElementById('slSave').addEventListener('click', saveSlForm);
  document.getElementById('slCancel').addEventListener('click', closeSlForm);
  slNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveSlForm(); });

  document.getElementById('btnBack').addEventListener('click', showSlIndex);
  document.getElementById('btnAddSong').addEventListener('click', openAddSongForm);
  document.getElementById('pfSave').addEventListener('click', saveSongForm);
  document.getElementById('pfCancel').addEventListener('click', closeSongForm);
  pfName.addEventListener('keydown', e => { if (e.key === 'Enter') saveSongForm(); });
  pfBpm.addEventListener('keydown',  e => { if (e.key === 'Enter') saveSongForm(); });

  // ── Generic DnD factory ──
  function setupDnD(listEl, rowSel, handleSel, onReorder) {
    let src      = null;
    let gapIdx   = -1;
    let insertAt = null;
    let ghost    = null;

    function shift(i) {
      const { srcIdx, srcHeight } = src;
      if (i === srcIdx) return 0;
      if (gapIdx > srcIdx + 1 && i > srcIdx && i < gapIdx) return -srcHeight;
      if (gapIdx <= srcIdx  && i >= gapIdx && i < srcIdx)  return  srcHeight;
      return 0;
    }

    function start(clientX, clientY, handle) {
      const row = handle.closest('[data-idx]');
      if (!row) return;
      const srcIdx = parseInt(row.dataset.idx);
      const rect   = row.getBoundingClientRect();

      row.classList.add('dnd-source');

      const g = row.cloneNode(true);
      g.classList.add('dnd-ghost');
      g.classList.remove('dnd-source');
      Object.assign(g.style, {
        position: 'fixed', width: rect.width + 'px',
        left: rect.left + 'px', top: rect.top + 'px',
        margin: '0', zIndex: '1000',
      });
      document.body.appendChild(g);

      const rows     = Array.from(listEl.querySelectorAll(rowSel));
      const rowRects = rows.map(r => r.getBoundingClientRect());
      src = {
        srcIdx, srcEl: row,
        offsetX: clientX - rect.left, offsetY: clientY - rect.top,
        rowTops:    rowRects.map(r => r.top),
        rowBottoms: rowRects.map(r => r.bottom),
        srcHeight:  rect.height,
      };
      ghost    = g;
      gapIdx   = srcIdx;
      insertAt = srcIdx;

      listEl.classList.add('dnd-active');
      document.addEventListener('touchmove', onTouchMove, { passive: false });
    }

    function move(clientX, clientY) {
      if (!src) return;

      Object.assign(ghost.style, {
        left: (clientX - src.offsetX) + 'px',
        top:  (clientY - src.offsetY) + 'px',
      });

      const { rowTops, rowBottoms, srcIdx } = src;
      const n = rowTops.length;
      const midYs = rowTops.map((t, i) => (t + rowBottoms[i]) / 2);

      let newGapIdx;
      if      (clientY < midYs[0])      newGapIdx = 0;
      else if (clientY >= midYs[n - 1]) newGapIdx = n;
      else {
        newGapIdx = n;
        for (let i = 0; i < n - 1; i++) {
          if (clientY >= midYs[i] && clientY < midYs[i + 1]) { newGapIdx = i + 1; break; }
        }
      }

      if (newGapIdx !== gapIdx) {
        gapIdx = newGapIdx;
        Array.from(listEl.querySelectorAll(rowSel)).forEach((row, i) => {
          if (i === srcIdx) return;
          const ty = shift(i);
          row.style.transform = ty !== 0 ? `translateY(${ty}px)` : '';
        });
      }

      insertAt = gapIdx >= n
        ? n - 1
        : gapIdx <= srcIdx ? gapIdx : gapIdx - 1;
    }

    function end() {
      if (!src) return;

      const { srcIdx, srcEl } = src;
      const finalInsertAt = insertAt;

      listEl.classList.remove('dnd-active');
      Array.from(listEl.querySelectorAll(rowSel)).forEach(r => { r.style.transform = ''; });

      ghost.remove();
      srcEl.classList.remove('dnd-source');
      ghost    = null;
      src      = null;
      insertAt = null;
      gapIdx   = -1;
      document.removeEventListener('touchmove', onTouchMove);

      if (finalInsertAt !== null && finalInsertAt !== srcIdx) {
        onReorder(srcIdx, finalInsertAt);
      }
    }

    function onTouchMove(e) {
      e.preventDefault();
      move(e.touches[0].clientX, e.touches[0].clientY);
    }

    listEl.addEventListener('mousedown', e => {
      const handle = e.target.closest(handleSel);
      if (!handle) return;
      e.preventDefault();
      start(e.clientX, e.clientY, handle);
    });
    document.addEventListener('mousemove', e => { if (src) move(e.clientX, e.clientY); });
    document.addEventListener('mouseup',   () => { if (src) end(); });

    listEl.addEventListener('touchstart', e => {
      const handle = e.target.closest(handleSel);
      if (!handle) return;
      start(e.touches[0].clientX, e.touches[0].clientY, handle);
    }, { passive: true });
    document.addEventListener('touchend', () => { if (src) end(); });
  }

  // ── Song DnD ──
  setupDnD(songList, '.preset-row', '.drag-handle', (srcIdx, at) => {
    const sl = currentSetlist();
    if (!sl) return;
    const [item] = sl.songs.splice(srcIdx, 1);
    sl.songs.splice(at, 0, item);
    saveSetlists();
    renderSongs();
  });

  // ── Setlist DnD ──
  setupDnD(slIndexList, '.sl-row', '.drag-handle', (srcIdx, at) => {
    const [item] = setlists.splice(srcIdx, 1);
    setlists.splice(at, 0, item);
    saveSetlists();
    renderSetlists();
  });

  // ── Library Song DnD ──
  setupDnD(libSongList, '.preset-row', '.drag-handle', (srcIdx, at) => {
    if (libSortMode !== 'manual') return;
    const [item] = songLibrary.splice(srcIdx, 1);
    songLibrary.splice(at, 0, item);
    saveSongLib();
    renderLibrary();
  });

  // ── Form mode toggle ──
  function setFormMode(mode) {
    const isManual = mode === 'manual';
    pfManual.style.display    = isManual ? '' : 'none';
    pfLibPicker.style.display = isManual ? 'none' : '';
    pfModeManual.classList.toggle('active',  isManual);
    pfModeLib.classList.toggle('active',    !isManual);
    if (!isManual) renderLibPicker();
  }
  pfModeManual.addEventListener('click', () => setFormMode('manual'));
  pfModeLib.addEventListener('click',    () => setFormMode('library'));
  document.getElementById('pfLibPickerCancel').addEventListener('click', closeSongForm);

  function renderLibPicker() {
    if (songLibrary.length === 0) {
      pfLibList.innerHTML = '<div class="setlist-empty">ライブラリに曲がありません</div>';
      return;
    }
    pfLibList.innerHTML = getLibrarySongsForDisplay().map(s => `
      <div class="preset-row">
        <button class="preset-apply" data-id="${s.id}">
          <span class="preset-name">${escHtml(s.name)}</span>
          <span class="preset-bpm">${escHtml(s.bpm)} BPM</span>
        </button>
      </div>
    `).join('');
    pfLibList.querySelectorAll('.preset-apply').forEach(btn =>
      btn.addEventListener('click', () => pickFromLibrary(btn.dataset.id)));
  }

  function pickFromLibrary(libId) {
    const libSong = songLibrary.find(s => s.id === libId);
    if (!libSong) return;
    const sl = currentSetlist();
    if (!sl) return;
    if (editingSongId) {
      const idx = sl.songs.findIndex(s => s.id === editingSongId);
      if (idx !== -1) {
        sl.songs[idx] = { ...sl.songs[idx], name: libSong.name, bpm: libSong.bpm };
        if (activeSongId === editingSongId) setBPM(libSong.bpm);
      }
    } else {
      sl.songs.push({ id: Date.now().toString(), name: libSong.name, bpm: libSong.bpm });
    }
    saveSetlists();
    closeSongForm();
    renderSongs();
  }

  // ── Song Library CRUD ──
  function saveSongLib() { localStorage.setItem('metro-song-lib', JSON.stringify(songLibrary)); }

  function getLibrarySongsForDisplay() {
    if (libSortMode === 'name') {
      return [...songLibrary].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (libSortMode === 'bpm') {
      return [...songLibrary].sort((a, b) => a.bpm - b.bpm || a.name.localeCompare(b.name));
    }
    return songLibrary;
  }

  function setLibrarySortMode(mode) {
    libSortMode = mode;
    libSortManualBtn.classList.toggle('active', mode === 'manual');
    libSortNameBtn.classList.toggle('active', mode === 'name');
    libSortBpmBtn.classList.toggle('active', mode === 'bpm');
    renderLibrary();
    if (pfModeLib.classList.contains('active')) renderLibPicker();
  }

  function renderLibrary() {
    if (songLibrary.length === 0) {
      libSongList.innerHTML = '<div class="setlist-empty">曲を追加してください</div>';
      return;
    }
    const showDragHandle = libSortMode === 'manual';
    libSongList.innerHTML = getLibrarySongsForDisplay().map((s, idx) => `
      <div class="preset-row${activeLibSongId === s.id ? ' active' : ''}" data-idx="${idx}">
        ${showDragHandle ? '<span class="drag-handle">⠿</span>' : ''}
        <button class="preset-apply" data-id="${s.id}">
          <span class="preset-name">${escHtml(s.name)}</span>
          <span class="preset-bpm">${escHtml(s.bpm)} BPM</span>
        </button>
        <button class="preset-icon-btn" data-id="${s.id}" data-action="edit-lib" title="編集">✏</button>
        <button class="preset-icon-btn del" data-id="${s.id}" data-action="del-lib" title="削除">✕</button>
      </div>
    `).join('');
    libSongList.querySelectorAll('.preset-apply').forEach(btn =>
      btn.addEventListener('click', () => applyLibrarySong(btn.dataset.id)));
    libSongList.querySelectorAll('[data-action="edit-lib"]').forEach(btn =>
      btn.addEventListener('click', () => openEditLibForm(btn.dataset.id)));
    libSongList.querySelectorAll('[data-action="del-lib"]').forEach(btn =>
      btn.addEventListener('click', () => deleteLibSong(btn.dataset.id)));
  }

  function openAddLibForm() {
    editingLibId = null; libNameInput.value = ''; libBpmInput.value = bpm;
    libForm.style.display = 'block'; libNameInput.focus();
  }
  function openEditLibForm(id) {
    const s = songLibrary.find(s => s.id === id);
    if (!s) return;
    editingLibId = id; libNameInput.value = s.name; libBpmInput.value = s.bpm;
    libForm.style.display = 'block'; libNameInput.focus();
  }
  function closeLibForm() { editingLibId = null; libForm.style.display = 'none'; }
  function saveLibForm() {
    const name = libNameInput.value.trim();
    const bpmVal = Math.min(300, Math.max(20, parseInt(libBpmInput.value) || bpm));
    if (!name) { libNameInput.focus(); return; }
    if (editingLibId) {
      const s = songLibrary.find(s => s.id === editingLibId);
      if (s) { s.name = name; s.bpm = bpmVal; }
    } else {
      songLibrary.push({ id: Date.now().toString(), name, bpm: bpmVal });
    }
    saveSongLib(); closeLibForm(); renderLibrary();
  }
  function deleteLibSong(id) {
    if (!confirm('この曲をライブラリから削除しますか？')) return;
    if (activeLibSongId === id) activeLibSongId = null;
    songLibrary = songLibrary.filter(s => s.id !== id);
    saveSongLib(); renderLibrary();
  }

  document.getElementById('btnAddLibSong').addEventListener('click', openAddLibForm);
  libSortManualBtn.addEventListener('click', () => setLibrarySortMode('manual'));
  libSortNameBtn.addEventListener('click',   () => setLibrarySortMode('name'));
  libSortBpmBtn.addEventListener('click',    () => setLibrarySortMode('bpm'));
  document.getElementById('libSave').addEventListener('click', saveLibForm);
  document.getElementById('libCancel').addEventListener('click', closeLibForm);
  libNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveLibForm(); });
  libBpmInput.addEventListener('keydown',  e => { if (e.key === 'Enter') saveLibForm(); });

  // ── Init ──
  showSlIndex();
  updateNowPlaying();
  renderLibrary();

  // ──── Swipe Panel (5-slot clone carousel) ────
  // Slot layout: [clone-P2][P0][P1][P2][clone-P0]
  // physicalIdx: 0=clone-P2, 1=P0, 2=P1, 3=P2, 4=clone-P0
  const TOTAL_PAGES = 3;
  const SLOT_STEP   = 20; // % per slot (100% / 5 slots)
  let currentPage   = 0;
  let physicalIdx   = 1;  // start at slot 1 (real page 0)

  // Inject clone sentinels into the DOM
  (() => {
    const pages = Array.from(swipePagesEl.querySelectorAll('.swipe-page'));
    // slot 0: clone of page 2 (shows when dragging right past page 0)
    swipePagesEl.insertBefore(pages[2].cloneNode(true), pages[0]);
    // slot 4: clone of page 0 (shows when dragging left past page 2)
    swipePagesEl.appendChild(pages[0].cloneNode(true));
  })();
  refreshBallCanvases();
  resizeBallCanvases();
  syncVolumeSectionHeight();

  // Set initial position instantly (no animation)
  swipePagesEl.style.transition = 'none';
  swipePagesEl.style.transform  = `translateX(-${physicalIdx * SLOT_STEP}%)`;
  // Re-enable transition after layout settles
  requestAnimationFrame(() => requestAnimationFrame(() => {
    swipePagesEl.style.transition = '';
  }));

  // After a wrap transition lands on a clone slot, silently jump to the real slot.
  // IMPORTANT: force a synchronous reflow (offsetWidth read) between setting
  // transition:none+transform and re-enabling the transition, so the browser
  // commits the instant jump before any future animated transition can start.
  swipePagesEl.addEventListener('transitionend', () => {
    if (physicalIdx === 4) {
      // clone-P0 → real P0 (slot 1)
      physicalIdx = 1;
      swipePagesEl.style.transition = 'none';
      swipePagesEl.style.transform  = `translateX(-${physicalIdx * SLOT_STEP}%)`;
      void swipePagesEl.offsetWidth; // flush styles / force reflow
      swipePagesEl.style.transition = '';
    } else if (physicalIdx === 0) {
      // clone-P2 → real P2 (slot 3)
      physicalIdx = 3;
      swipePagesEl.style.transition = 'none';
      swipePagesEl.style.transform  = `translateX(-${physicalIdx * SLOT_STEP}%)`;
      void swipePagesEl.offsetWidth; // flush styles / force reflow
      swipePagesEl.style.transition = '';
    }
  });

  function updateDots() {
    pageDotEls.forEach((dot, i) => dot.classList.toggle('active', i === currentPage));
  }

  // Direct navigation to a logical page (dot clicks)
  function goToPage(targetLogical) {
    currentPage = ((targetLogical % TOTAL_PAGES) + TOTAL_PAGES) % TOTAL_PAGES;
    physicalIdx = currentPage + 1; // 0→1, 1→2, 2→3
    swipePagesEl.style.transition = '';
    swipePagesEl.style.transform  = `translateX(-${physicalIdx * SLOT_STEP}%)`;
    updateDots();
    if (currentPage === 0) resizeBallCanvases();
  }

  // Navigate one step forward (swipe-left = next page, wraps naturally via clone-P0)
  function goForward() {
    currentPage = (currentPage + 1) % TOTAL_PAGES;
    physicalIdx = physicalIdx + 1; // may reach 4 (clone-P0); transitionend jumps back
    swipePagesEl.style.transition = '';
    swipePagesEl.style.transform  = `translateX(-${physicalIdx * SLOT_STEP}%)`;
    updateDots();
    if (currentPage === 0) resizeBallCanvases();
  }

  // Navigate one step backward (swipe-right = prev page, wraps naturally via clone-P2)
  function goBackward() {
    currentPage = (currentPage + TOTAL_PAGES - 1) % TOTAL_PAGES;
    physicalIdx = physicalIdx - 1; // may reach 0 (clone-P2); transitionend jumps back
    swipePagesEl.style.transition = '';
    swipePagesEl.style.transform  = `translateX(-${physicalIdx * SLOT_STEP}%)`;
    updateDots();
    if (currentPage === 0) resizeBallCanvases();
  }

  // Dot tap-to-switch
  pageDotEls.forEach(dot =>
    dot.addEventListener('click', () => goToPage(parseInt(dot.dataset.page))));

  // Touch swipe gesture
  let swipeStartX    = null;
  let swipeStartY    = null;
  let swipeActive    = false;
  let swipeStartPhys = 0;  // physicalIdx at drag start

  swipePagesEl.addEventListener('touchstart', e => {
    const tgt = e.target;
    // Don't intercept touches that start on interactive elements
    if (tgt.tagName === 'INPUT' || tgt.tagName === 'BUTTON' || tgt.tagName === 'SELECT') return;
    swipeStartX    = e.touches[0].clientX;
    swipeStartY    = e.touches[0].clientY;
    swipeActive    = false;
    swipeStartPhys = physicalIdx;
  }, { passive: true });

  swipePagesEl.addEventListener('touchmove', e => {
    if (swipeStartX === null) return;
    const dx = e.touches[0].clientX - swipeStartX;
    const dy = e.touches[0].clientY - swipeStartY;

    if (!swipeActive) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        swipeActive = true;
        swipePagesEl.style.transition = 'none';
      } else {
        swipeStartX = null; // vertical scroll — don't hijack
        return;
      }
    }

    e.preventDefault();
    const containerW = swipePagesEl.parentElement.offsetWidth;
    const dragPct    = (dx / containerW) * SLOT_STEP;
    const basePct    = swipeStartPhys * SLOT_STEP;
    swipePagesEl.style.transform = `translateX(${-(basePct - dragPct)}%)`;
  }, { passive: false });

  swipePagesEl.addEventListener('touchend', e => {
    if (!swipeActive) { swipeStartX = null; return; }
    swipePagesEl.style.transition = '';
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const THRESHOLD = 50;
    if      (dx < -THRESHOLD) goForward();
    else if (dx >  THRESHOLD) goBackward();
    else {
      // Snap back to where drag started
      physicalIdx = swipeStartPhys;
      swipePagesEl.style.transform = `translateX(-${physicalIdx * SLOT_STEP}%)`;
    }
    swipeStartX = null;
    swipeActive  = false;
  });

  // Mouse drag (for desktop testing)
  let mouseSwipeX    = null;
  let mouseSwipePhys = 0;
  let mouseActive    = false;

  swipePagesEl.addEventListener('mousedown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    mouseSwipeX    = e.clientX;
    mouseSwipePhys = physicalIdx;
    mouseActive    = false;
  });
  document.addEventListener('mousemove', e => {
    if (mouseSwipeX === null) return;
    const dx = e.clientX - mouseSwipeX;
    if (!mouseActive && Math.abs(dx) > 8) {
      mouseActive = true;
      swipePagesEl.style.transition = 'none';
    }
    if (!mouseActive) return;
    const containerW = swipePagesEl.parentElement.offsetWidth;
    const dragPct    = (dx / containerW) * SLOT_STEP;
    const basePct    = mouseSwipePhys * SLOT_STEP;
    swipePagesEl.style.transform = `translateX(${-(basePct - dragPct)}%)`;
  });
  document.addEventListener('mouseup', e => {
    if (mouseSwipeX === null) return;
    swipePagesEl.style.transition = '';
    const dx = e.clientX - mouseSwipeX;
    const THRESHOLD = 50;
    if      (dx < -THRESHOLD) goForward();
    else if (dx >  THRESHOLD) goBackward();
    else {
      physicalIdx = mouseSwipePhys;
      swipePagesEl.style.transform = `translateX(-${physicalIdx * SLOT_STEP}%)`;
    }
    mouseSwipeX = null;
    mouseActive  = false;
  });

  // ──── Bottom Navigation ────
  const navMetronomeBtn = document.getElementById('navMetronome');
  const navSetlistBtn   = document.getElementById('navSetlist');
  const navLibraryBtn   = document.getElementById('navLibrary');
  const viewMetronomeEl = document.getElementById('viewMetronome');
  const viewSetlistEl   = document.getElementById('viewSetlist');
  const viewLibraryEl   = document.getElementById('viewLibrary');

  function setView(targetView, targetNav) {
    [viewMetronomeEl, viewSetlistEl, viewLibraryEl].forEach(v =>
      v.classList.toggle('active', v === targetView));
    [navMetronomeBtn, navSetlistBtn, navLibraryBtn].forEach(n =>
      n.classList.toggle('active', n === targetNav));
    if (targetView === viewMetronomeEl) {
      requestAnimationFrame(() => {
        resizeBallCanvases();
        syncVolumeSectionHeight();
      });
    }
  }

  navMetronomeBtn.addEventListener('click', () => setView(viewMetronomeEl, navMetronomeBtn));
  navSetlistBtn.addEventListener('click',   () => setView(viewSetlistEl,   navSetlistBtn));
  navLibraryBtn.addEventListener('click',   () => { setView(viewLibraryEl, navLibraryBtn); renderLibrary(); });

})();

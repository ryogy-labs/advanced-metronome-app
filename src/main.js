import './style.css';

(() => {
  // ──── State ────
  let bpm = 120;
  let beatsPerMeasure = 4;
  let masterVol = 1.0;
  let volBeat1 = 1.0, volQuarter = 0.8, volEighth = 0.5, volSixteenth = 0.0;
  let running = false;

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
  const beatRowEls      = [beatRow, beatRowSetlist];
  const playBtn         = document.getElementById('playBtn');
  const tapBtn          = document.getElementById('tapBtn');
  const timeSigSel      = document.getElementById('timeSig');

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
    gain.gain.setValueAtTime(vol * 0.4, time);
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
    document.getElementById('navMetronome').classList.add('nav-running');
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
    document.getElementById('navMetronome').classList.remove('nav-running');
    beatRow.querySelectorAll('.beat-dot').forEach(d => {
      d.classList.remove('active-1', 'active-n');
    });
    updateNowPlayingState();
  }

  // ──── BPM helpers ────
  function setBPM(val) {
    bpm = Math.min(300, Math.max(20, Math.round(val)));
    bpmDisplay.textContent = bpm;
    bpmSlider.value = bpm;
    updateSliderFill(bpmSlider, 20, 300);
  }

  function updateSliderFill(slider, min, max) {
    const pct = ((slider.value - min) / (max - min)) * 100;
    slider.style.setProperty('--pct', pct + '%');
  }

  function updateVolSlider(slider, numEl) {
    updateSliderFill(slider, 0, 100);
    numEl.textContent = slider.value;
  }

  // ──── Event listeners ────
  bpmSlider.addEventListener('input', () => setBPM(Number(bpmSlider.value)));

  document.getElementById('bpmMinus10').addEventListener('click', () => setBPM(bpm - 10));
  document.getElementById('bpmMinus1').addEventListener('click',  () => setBPM(bpm - 1));
  document.getElementById('bpmPlus1').addEventListener('click',   () => setBPM(bpm + 1));
  document.getElementById('bpmPlus10').addEventListener('click',  () => setBPM(bpm + 10));

  timeSigSel.addEventListener('change', () => {
    beatsPerMeasure = Number(timeSigSel.value);
    buildBeatDots();
    if (running) { stopMetronome(); startMetronome(); }
  });

  volMasterEl.addEventListener('input', () => {
    masterVol = volMasterEl.value / 100;
    updateVolSlider(volMasterEl, volMasterNum);
  });

  volBeat1El.addEventListener('input', () => {
    volBeat1 = volBeat1El.value / 100;
    updateVolSlider(volBeat1El, volBeat1Num);
  });
  volQuarterEl.addEventListener('input', () => {
    volQuarter = volQuarterEl.value / 100;
    updateVolSlider(volQuarterEl, volQuarterNum);
  });
  volEighthEl.addEventListener('input', () => {
    volEighth = volEighthEl.value / 100;
    updateVolSlider(volEighthEl, volEighthNum);
  });
  volSixteenthEl.addEventListener('input', () => {
    volSixteenth = volSixteenthEl.value / 100;
    updateVolSlider(volSixteenthEl, volSixteenthNum);
  });

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
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
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

  // ── Ball toggle ──
  const ballOnBtn      = document.getElementById('ballOnBtn');
  const ballOffBtn     = document.getElementById('ballOffBtn');
  const ballSubOptions = document.getElementById('ballSubOptions');
  let ballVisible = true;

  function setBallVisible(v) {
    ballVisible = v;
    ballCanvas.classList.toggle('hidden',     !v);
    ballSubOptions.classList.toggle('hidden', !v);
    ballOnBtn.classList.toggle('active',       v);
    ballOffBtn.classList.toggle('active',     !v);
  }
  ballOnBtn.addEventListener('click',  () => setBallVisible(true));
  ballOffBtn.addEventListener('click', () => setBallVisible(false));

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
  const ballCanvas = document.getElementById('ballCanvas');
  const ballCtx2d  = ballCanvas.getContext('2d');
  const BALL_MAX_H = 160; // px: max height above ground
  const BALL_R     = 30;  // px: ball radius

  function resizeCanvas() {
    ballCanvas.width  = ballCanvas.offsetWidth;
    ballCanvas.height = ballCanvas.offsetHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  function drawBall() {
    const w = ballCanvas.width;
    const h = ballCanvas.height;
    ballCtx2d.clearRect(0, 0, w, h);

    const groundY = h - 10;

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

    // Ball center: bottom of ellipse touches groundY when heightFrac=0
    const ballY = groundY - ry - heightFrac * BALL_MAX_H;

    // Shadow (grows darker/larger as ball approaches ground)
    const shadowAlpha = 0.08 + 0.22 * (1 - heightFrac);
    const shadowRx    = BALL_R * (0.5 + 0.9 * (1 - heightFrac));
    ballCtx2d.save();
    ballCtx2d.fillStyle = `rgba(124, 92, 252, ${shadowAlpha})`;
    ballCtx2d.beginPath();
    ballCtx2d.ellipse(cx, groundY, shadowRx, 4, 0, 0, Math.PI * 2);
    ballCtx2d.fill();
    ballCtx2d.restore();

    // Ground line
    ballCtx2d.save();
    ballCtx2d.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();
    ballCtx2d.lineWidth = 2;
    ballCtx2d.beginPath();
    ballCtx2d.moveTo(0, groundY);
    ballCtx2d.lineTo(w, groundY);
    ballCtx2d.stroke();
    ballCtx2d.restore();

    // Ball: flash pink only on Beat 1 impact; other beats stay purple
    const isImpact  = phase < 0.15 && running;
    const ballColor = (isImpact && isBeat1) ? '#fc5c7d' : '#7c5cfc';
    ballCtx2d.save();
    ballCtx2d.shadowColor = ballColor;
    ballCtx2d.shadowBlur  = (isImpact && isBeat1) ? 24 : 14;
    ballCtx2d.fillStyle   = ballColor;
    ballCtx2d.beginPath();
    ballCtx2d.ellipse(cx, ballY, rx, ry, 0, 0, Math.PI * 2);
    ballCtx2d.fill();
    ballCtx2d.restore();

    requestAnimationFrame(drawBall);
  }

  drawBall();

  // ──── iOS Background Playback ────
  // Strategy:
  //   1. Looping silent <audio> keeps the iOS audio session alive so
  //      AudioContext is not forcibly suspended when the screen locks.
  //   2. On visibilitychange → hidden: pre-schedule 10 s of beats and stop
  //      the JS timer (it would be throttled anyway).
  //   3. The silent audio's `timeupdate` (~4 Hz) refills the schedule while
  //      in background, so playback continues indefinitely.
  //   4. On visibilitychange → visible: resume AudioContext + JS scheduler.

  let _silentEl  = null;
  let _silentUrl = null;

  function getSilentWavUrl() {
    if (_silentUrl) return _silentUrl;
    // Build a 1-second mono silent PCM WAV in memory
    const rate = 22050, len = rate; // 1 s × 22050 samples × 2 bytes = 44100 bytes
    const ab = new ArrayBuffer(44 + len * 2);
    const dv = new DataView(ab);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + len * 2, true);
    ws(8, 'WAVE'); ws(12, 'fmt ');
    dv.setUint32(16, 16, true);  // chunk size
    dv.setUint16(20,  1, true);  // PCM
    dv.setUint16(22,  1, true);  // mono
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * 2, true); // byte rate
    dv.setUint16(32,  2, true);  // block align
    dv.setUint16(34, 16, true);  // bits per sample
    ws(36, 'data'); dv.setUint32(40, len * 2, true);
    // sample data is all zeros → silence
    _silentUrl = URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
    return _silentUrl;
  }

  function initSilentEl() {
    if (_silentEl) return;
    _silentEl = new Audio(getSilentWavUrl());
    _silentEl.loop   = true;
    _silentEl.volume = 0.001; // inaudible

    // timeupdate fires ~4×/s on iOS even in background while audio is playing.
    // Use it to keep the Web Audio schedule topped up.
    _silentEl.addEventListener('timeupdate', () => {
      if (!running || !document.hidden || !audioCtx) return;
      const interval = 60 / bpm / 4; // 16th-note duration
      const horizon  = audioCtx.currentTime + 10; // keep 10 s ahead
      while (nextNoteTime < horizon) {
        scheduleNote(nextNoteTime, subBeatCount);
        subBeatCount = (subBeatCount + 1) % (beatsPerMeasure * 4);
        nextNoteTime += interval;
      }
    });
  }

  function bgAudioStart() {
    initSilentEl();
    _silentEl.play().catch(() => {});
  }

  function bgAudioStop() {
    if (_silentEl) _silentEl.pause();
  }

  document.addEventListener('visibilitychange', () => {
    if (!running || !audioCtx) return;
    if (document.hidden) {
      // Pre-schedule 10 s then let timeupdate maintain it; stop JS timer.
      clearTimeout(timerID);
      timerID = null;
      const interval = 60 / bpm / 4;
      const horizon  = audioCtx.currentTime + 10;
      while (nextNoteTime < horizon) {
        scheduleNote(nextNoteTime, subBeatCount);
        subBeatCount = (subBeatCount + 1) % (beatsPerMeasure * 4);
        nextNoteTime += interval;
      }
    } else {
      // Back in foreground: ensure AudioContext is running, restart JS scheduler.
      audioCtx.resume().catch(() => {});
      if (!timerID) scheduler();
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
      activeSongId = id;
      activeSlId   = currentSlId;
      setBPM(p.bpm);
      renderSongs();
      updateNowPlaying();
      startMetronome();
    }
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
    const sorted = [...songLibrary].sort((a, b) => a.name.localeCompare(b.name));
    pfLibList.innerHTML = sorted.map(s => `
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

  function renderLibrary() {
    if (songLibrary.length === 0) {
      libSongList.innerHTML = '<div class="setlist-empty">曲を追加してください</div>';
      return;
    }
    const sorted = [...songLibrary].sort((a, b) => a.name.localeCompare(b.name));
    libSongList.innerHTML = sorted.map(s => `
      <div class="preset-row">
        <div class="preset-apply" style="cursor:default; pointer-events:none">
          <span class="preset-name">${escHtml(s.name)}</span>
          <span class="preset-bpm">${escHtml(s.bpm)} BPM</span>
        </div>
        <button class="preset-icon-btn" data-id="${s.id}" data-action="edit-lib" title="編集">✏</button>
        <button class="preset-icon-btn del" data-id="${s.id}" data-action="del-lib" title="削除">✕</button>
      </div>
    `).join('');
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
    songLibrary = songLibrary.filter(s => s.id !== id);
    saveSongLib(); renderLibrary();
  }

  document.getElementById('btnAddLibSong').addEventListener('click', openAddLibForm);
  document.getElementById('libSave').addEventListener('click', saveLibForm);
  document.getElementById('libCancel').addEventListener('click', closeLibForm);
  libNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveLibForm(); });
  libBpmInput.addEventListener('keydown',  e => { if (e.key === 'Enter') saveLibForm(); });

  // ── Init ──
  showSlIndex();
  updateNowPlaying();
  renderLibrary();

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
  }

  navMetronomeBtn.addEventListener('click', () => setView(viewMetronomeEl, navMetronomeBtn));
  navSetlistBtn.addEventListener('click',   () => setView(viewSetlistEl,   navSetlistBtn));
  navLibraryBtn.addEventListener('click',   () => { setView(viewLibraryEl, navLibraryBtn); renderLibrary(); });

})();

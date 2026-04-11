import './style.css';
import { registerPlugin } from '@capacitor/core';

const NativeMetronomeAudio = registerPlugin('MetronomeAudio');
const isNative = window.Capacitor?.isNativePlatform() ?? false;

(() => {
  const isNativeApp = Boolean(
    window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === 'function' &&
    window.Capacitor.isNativePlatform()
  );

  // ──── State ────
  let bpm = 120;
  let beatsPerMeasure = 4;
  let beatStates = ['accent', 'normal', 'normal', 'normal'];
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
  let isMuted = false;
  // ── Pro ステータス ──────────────────────────────
  // Production では RevenueCat/StoreKit の結果に差し替える（この1箇所だけ変更すれば良い）
  let isPro = (() => {
    if (!isNativeApp) {
      return localStorage.getItem('metro-dev-force-pro') === '1';
    }
    return false; // 本番はデフォルト free
  })();

  // AudioContext & scheduling (always runs at 16th note resolution)
  let audioCtx = null;
  let masterGainNode = null;
  let nextNoteTime = 0;
  let lookahead = 25.0;     // ms
  let scheduleAhead = 0.1;  // sec
  let timerID = null;
  let subBeatCount = 0;     // 16th note position within measure
  let playbackRefreshSeq = 0;
  let nativeLoopAnchorMs = 0;

  // iOS AudioContext unlock: 初回タップで resume を保証する
  (function iosAudioUnlock() {
    const unlock = () => {
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      document.removeEventListener('touchstart', unlock, true);
      document.removeEventListener('touchend',   unlock, true);
      document.removeEventListener('click',      unlock, true);
    };
    document.addEventListener('touchstart', unlock, { capture: true, passive: true });
    document.addEventListener('touchend',   unlock, { capture: true, passive: true });
    document.addEventListener('click',      unlock, { capture: true, passive: true });
  })();

  // Ball animation
  let scheduledBeatTimes = []; // { time: audioCtxTime, beatIdx }
  let squashEnabled = true;
  let animMode = 'vertical'; // 'vertical' | 'horizontal'

  // ──── i18n ────────────────────────────────────────────────
  const I18N = {
    ja: {
      'settings.title': '設定',
      'settings.language': '言語',
      'settings.wakelock': '常時画面オン',
      'settings.ball': 'ボール設定',
      'settings.ballDirection': '移動方向',
      'settings.vertical': '縦',
      'settings.horizontal': '横',
      'settings.squash': 'スクワッシュ',
      'common.on': 'ON',
      'common.off': 'OFF',
      'common.save': '保存',
      'common.cancel': 'キャンセル',
      'common.back': '← 戻る',
      'common.add': '＋ 追加',
      'metro.start': '▶ START',
      'metro.stop': '⏹ STOP',
      'metro.tap': 'TAP\nTEMPO',
      'nowplaying.playing': '再生中',
      'nav.metronome': 'メトロノーム',
      'nav.setlist': 'セットリスト',
      'nav.library': 'ライブラリ',
      'page.ball': 'ボール',
      'page.volume': '音量設定',
      'page.timesig': '拍子',
      'volume.master': '全体',
      'volume.beat1': '強拍',
      'volume.quarter': '4分',
      'volume.eighth': '8分',
      'volume.sixteenth': '16分',
      'setlist.addSetlist': '＋ 新規作成',
      'setlist.namePlaceholder': 'セットリスト名 (例: ワンマンライブ)',
      'setlist.songList': '♩ 曲リスト',
      'setlist.fromLibrary': 'ライブラリから',
      'setlist.manualInput': '直接入力',
      'library.title': '♩ 曲ライブラリ',
      'library.sort': 'ソート',
      'library.sortManual': '手動',
      'library.sortName': '曲名',
      'library.sortBpm': 'BPM',
      'library.songName': '曲名',
      'capture.currentSettings': '現在のBPM・音量・拍子設定を取り込む',
      'paywall.unlimited': '✓ セットリスト・ライブラリが無制限に',
      'paywall.volumePreset': '✓ 曲ごとの音量プリセット保存',
      'paywall.timeSignature': '✓ 曲ごとの拍子記録',
      'paywall.future': '✓ 今後追加される Pro 機能すべて',
      'paywall.upgrade': 'Pro にアップグレード（$7.99）',
      'paywall.restore': '購入を復元',
      'empty.noSetlists': 'セットリストを追加してください',
      'empty.noSongs': '曲を追加してください',
      'empty.noLibrarySongs': 'ライブラリに曲がありません',
      'label.songsCount': '曲',
      'action.edit': '編集',
      'action.delete': '削除',
      'confirm.deleteSetlist': 'このセットリストを削除しますか？',
      'confirm.deleteSong': 'この曲を削除しますか？',
      'confirm.deleteLibrarySong': 'この曲をライブラリから削除しますか？',
      'untitled': '(無題)',
    },
    en: {
      'settings.title': 'Settings',
      'settings.language': 'Language',
      'settings.wakelock': 'Keep Screen On',
      'settings.ball': 'Ball Settings',
      'settings.ballDirection': 'Ball Direction',
      'settings.vertical': 'Vertical',
      'settings.horizontal': 'Horizontal',
      'settings.squash': 'Squash',
      'common.on': 'ON',
      'common.off': 'OFF',
      'common.save': 'Save',
      'common.cancel': 'Cancel',
      'common.back': '← Back',
      'common.add': '+ Add',
      'metro.start': '▶ START',
      'metro.stop': '⏹ STOP',
      'metro.tap': 'TAP\nTEMPO',
      'nowplaying.playing': 'Now Playing',
      'nav.metronome': 'Metronome',
      'nav.setlist': 'Setlist',
      'nav.library': 'Library',
      'page.ball': 'Ball',
      'page.volume': 'Volume',
      'page.timesig': 'Time Sig',
      'volume.master': 'Master',
      'volume.beat1': 'Accent',
      'volume.quarter': 'Quarter',
      'volume.eighth': 'Eighth',
      'volume.sixteenth': 'Sixteenth',
      'setlist.addSetlist': '+ New Setlist',
      'setlist.namePlaceholder': 'Setlist name (e.g. One-Man Live)',
      'setlist.songList': '♩ Songs',
      'setlist.fromLibrary': 'From Library',
      'setlist.manualInput': 'Manual',
      'library.title': '♩ Song Library',
      'library.sort': 'Sort',
      'library.sortManual': 'Manual',
      'library.sortName': 'Name',
      'library.sortBpm': 'BPM',
      'library.songName': 'Song name',
      'capture.currentSettings': 'Capture current BPM/volume/time-signature',
      'paywall.unlimited': '✓ Unlimited setlists and library songs',
      'paywall.volumePreset': '✓ Save volume presets per song',
      'paywall.timeSignature': '✓ Save time signatures per song',
      'paywall.future': '✓ All future Pro features',
      'paywall.upgrade': 'Upgrade to Pro ($7.99)',
      'paywall.restore': 'Restore Purchase',
      'empty.noSetlists': 'Add a setlist to get started',
      'empty.noSongs': 'Add songs to get started',
      'empty.noLibrarySongs': 'No songs in your library',
      'label.songsCount': 'songs',
      'action.edit': 'Edit',
      'action.delete': 'Delete',
      'confirm.deleteSetlist': 'Delete this setlist?',
      'confirm.deleteSong': 'Delete this song?',
      'confirm.deleteLibrarySong': 'Delete this song from the library?',
      'untitled': '(Untitled)',
    }
  };

  function buildDefaultBeatStates(count) {
    return Array.from({ length: count }, (_, idx) => (idx === 0 ? 'accent' : 'normal'));
  }

  function normalizeBeatStates(states, count = beatsPerMeasure) {
    const fallback = buildDefaultBeatStates(count);
    if (!Array.isArray(states)) return fallback;
    return fallback.map((state, idx) => {
      const next = states[idx];
      return next === 'accent' || next === 'normal' || next === 'mute' ? next : state;
    });
  }

  let currentLang = localStorage.getItem('metro-lang') || 'ja';

  function t(key) {
    return (I18N[currentLang] || I18N.ja)[key] ?? key;
  }

  // ──── Screen Wake Lock ────────────────────────────────────
  let wakeLockEnabled = localStorage.getItem('metro-wakelock') !== '0';
  let _wakeLockSentinel = null;

  async function acquireWakeLock() {
    if (!wakeLockEnabled) return;
    if (!('wakeLock' in navigator)) return;
    try {
      _wakeLockSentinel = await navigator.wakeLock.request('screen');
      _wakeLockSentinel.addEventListener('release', () => { _wakeLockSentinel = null; });
    } catch (e) {
      console.warn('[WakeLock] acquire failed:', e);
    }
  }

  function releaseWakeLock() {
    if (_wakeLockSentinel) {
      _wakeLockSentinel.release().catch(() => {});
      _wakeLockSentinel = null;
    }
  }

  // ──── DOM ────
  const bpmDisplay      = document.getElementById('bpmDisplay');
  const bpmSlider       = document.getElementById('bpmSlider');
  const beatRow         = document.getElementById('beatRow');
  const beatRowSetlist  = document.getElementById('beatRowSetlist');
  const beatRowLibrary  = document.getElementById('beatRowLibrary');
  const beatRowEls      = [beatRow, beatRowSetlist, beatRowLibrary].filter(Boolean);
  const muteBtnEls      = [
    document.getElementById('muteBtnMetro'),
    document.getElementById('muteBtnSetlist'),
    document.getElementById('muteBtnLibrary'),
  ].filter(Boolean);
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
  const proPaywallEl      = document.getElementById('proPaywall');
  const paywallBuyBtn     = document.getElementById('paywallBuyBtn');
  const paywallRestoreBtn = document.getElementById('paywallRestoreBtn');
  const paywallCloseBtn   = document.getElementById('paywallCloseBtn');
  const settingsOverlay   = document.getElementById('settingsOverlay');
  const settingsBtns      = document.querySelectorAll('.settings-btn');
  const settingsClose     = document.getElementById('settingsClose');
  const langJaBtn         = document.getElementById('langJa');
  const langEnBtn         = document.getElementById('langEn');
  const wakelockOnBtn     = document.getElementById('wakelockOnBtn');
  const wakelockOffBtn    = document.getElementById('wakelockOffBtn');

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      const val = t(key);
      if (el.tagName === 'BUTTON' || el.tagName === 'SPAN' || el.tagName === 'DIV') {
        el.textContent = val;
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.dataset.i18nPlaceholder;
      el.setAttribute('placeholder', t(key));
    });
    playBtn.textContent = running ? t('metro.stop') : t('metro.start');
    tapBtn.innerHTML = t('metro.tap').replace('\n', '<br>');
    const navMetronomeLabel = document.querySelector('[data-nav="metronome"] .nav-label');
    const navSetlistLabel = document.querySelector('[data-nav="setlist"] .nav-label');
    const navLibraryLabel = document.querySelector('[data-nav="library"] .nav-label');
    if (navMetronomeLabel) navMetronomeLabel.textContent = t('nav.metronome');
    if (navSetlistLabel) navSetlistLabel.textContent = t('nav.setlist');
    if (navLibraryLabel) navLibraryLabel.textContent = t('nav.library');
  }

  // ──── Beat dots ────
  function getBeatIndicatorState(beatIdx) {
    return beatStates[beatIdx] ?? 'normal';
  }

  function getNextBeatState(state) {
    if (state === 'accent') return 'normal';
    if (state === 'normal') return 'mute';
    return 'accent';
  }

  function syncBeatStatesForMeasure() {
    beatStates = buildDefaultBeatStates(beatsPerMeasure);
  }

  function getQuarterBeatSound(beatIdx) {
    const state = getBeatIndicatorState(beatIdx);
    if (state === 'mute') return null;
    if (state === 'accent') {
      return { volume: volBeat1 * masterVol, freq: 1200, dur: 0.030 };
    }
    return { volume: volQuarter * masterVol, freq: 900, dur: 0.025 };
  }

  function getCurrentBeatIndicatorIndex() {
    if (!running) return null;
    if (isNative && nativeLoopAnchorMs > 0) {
      const beatDurMs = 60000 / bpm;
      const loopDurMs = beatDurMs * beatsPerMeasure;
      const elapsedMs = Math.max(0, performance.now() - nativeLoopAnchorMs);
      return Math.floor((elapsedMs % loopDurMs) / beatDurMs) % beatsPerMeasure;
    }
    if (audioCtx) {
      const now = audioCtx.currentTime;
      for (let i = scheduledBeatTimes.length - 1; i >= 0; i--) {
        if (scheduledBeatTimes[i].time <= now) {
          return scheduledBeatTimes[i].beatIdx;
        }
      }
    }
    return null;
  }

  function cycleBeatState(beatIdx) {
    beatStates[beatIdx] = getNextBeatState(getBeatIndicatorState(beatIdx));
    buildBeatDots();
    updateBeatIndicators(getCurrentBeatIndicatorIndex());
    if (running) refreshRunningLoopOnly();
  }

  function buildBeatDots() {
    beatRowEls.forEach(rowEl => {
      rowEl.innerHTML = '';
      for (let i = 0; i < beatsPerMeasure; i++) {
        const d = document.createElement('button');
        d.className = 'beat-dot';
        d.type = 'button';
        d.dataset.state = getBeatIndicatorState(i);
        d.dataset.beatIdx = String(i);
        d.setAttribute('aria-label', `Beat ${i + 1}`);
        d.textContent = i + 1;
        d.addEventListener('click', () => cycleBeatState(i));
        rowEl.appendChild(d);
      }
    });
  }
  buildBeatDots();

  function updateBeatIndicators(beatIdx = null) {
    beatRowEls.forEach(rowEl => {
      const dots = rowEl.querySelectorAll('.beat-dot');
      dots.forEach((d, i) => {
        const state = d.dataset.state || getBeatIndicatorState(i);
        d.classList.remove('active-1', 'active-n', 'active-muted', 'idle-accent', 'idle-normal', 'idle-muted');
        if (state === 'accent') d.classList.add('idle-accent');
        else if (state === 'mute') d.classList.add('idle-muted');
        else d.classList.add('idle-normal');
        if (beatIdx !== null && i === beatIdx) {
          d.classList.remove('idle-accent', 'idle-normal', 'idle-muted');
          if (state === 'accent') d.classList.add('active-1');
          else if (state === 'mute') d.classList.add('active-muted');
          else d.classList.add('active-n');
        }
      });
    });
  }

  updateBeatIndicators();

  function flashBeat(beatIdx, scheduledTime) {
    // Skip visual updates in background, or if the beat is stale (> 0.5s off)
    if (document.hidden) return;
    if (audioCtx && typeof scheduledTime === 'number' &&
        Math.abs(audioCtx.currentTime - scheduledTime) > 0.5) return;
    updateBeatIndicators(beatIdx);
  }

  // ──── Audio synthesis ────
  function getCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGainNode = audioCtx.createGain();
      masterGainNode.gain.value = isMuted ? 0 : 1;
      masterGainNode.connect(audioCtx.destination);
    }
    return audioCtx;
  }

  async function isContextClockAdvancing(ctx) {
    const before = ctx.currentTime;
    await new Promise(resolve => setTimeout(resolve, 60));
    return ctx.currentTime > before + 0.001;
  }

  async function recreateSchedulerContext() {
    if (audioCtx) {
      try {
        await audioCtx.close();
      } catch {}
    }
    audioCtx = null;
    masterGainNode = null;
    const ctx = getCtx();
    try {
      await ctx.resume();
    } catch {}
    return ctx;
  }

  function playClick(time, vol, freq, dur) {
    if (isNative) return;
    if (vol <= 0) return;
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(masterGainNode);
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(vol * 0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.start(time);
    osc.stop(time + dur + 0.01);
  }

  function setMute(m) {
    isMuted = m;
    if (masterGainNode && audioCtx) {
      masterGainNode.gain.setTargetAtTime(m ? 0 : 1, audioCtx.currentTime, 0.015);
    }
    if (isNative && running) {
      void (_nativeLoopPreparePromise ?? Promise.resolve())
        .then(() => syncNativeLoopState());
    }
    syncBgLoopMuted();
    muteBtnEls.forEach(btn => {
      btn.classList.toggle('muted', m);
      btn.textContent = m ? '🔇' : '🔊';
    });
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
      const beatSound = getQuarterBeatSound(beatIdx);
      if (beatSound) {
        playClick(time, beatSound.volume, beatSound.freq, beatSound.dur);
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

  function startSchedulerFromNow() {
    const ctx = getCtx();
    clearTimeout(timerID);
    timerID = null;
    subBeatCount = 0;
    nextNoteTime = ctx.currentTime + (isNative ? 0.005 : 0.05);
    scheduledBeatTimes = [];
    updateBeatIndicators(0);
    scheduler();
  }

  async function ensureSchedulerContextRunning() {
    let ctx = getCtx();
    if (ctx.state === 'running' && await isContextClockAdvancing(ctx)) return true;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await ctx.resume();
      } catch {}
      if (ctx.state === 'running' && await isContextClockAdvancing(ctx)) return true;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!isNative) return false;
    ctx = await recreateSchedulerContext();
    return isContextClockAdvancing(ctx);
  }

  function startMetronome() {
    if (running) return;
    const boot = () => {
      running = true;
      startSchedulerFromNow();
      bgAudioStart();
      playBtn.textContent = t('metro.stop');
      playBtn.classList.add('running');
      void acquireWakeLock();
      updateNowPlayingState();
    };
    void ensureSchedulerContextRunning().then(boot);
  }

  function stopMetronome() {
    if (!running) return;
    running = false;
    clearTimeout(timerID);
    timerID = null;
    nativeLoopAnchorMs = 0;
    bgAudioStop();
    scheduledBeatTimes = [];
    playBtn.textContent = t('metro.start');
    playBtn.classList.remove('running');
    releaseWakeLock();
    updateBeatIndicators();
    updateNowPlayingState();
  }

  // ──── BPM helpers ────
  function setBPM(val) {
    bpm = Math.min(300, Math.max(20, Math.round(val)));
    bpmDisplay.textContent = bpm;
    bpmSlider.value = bpm;
    updateSliderFill(bpmSlider, 20, 300);
    if (running) {
      refreshRunningPlayback({ realignVisuals: true });
    }
  }

  function updateSliderFill(slider, min, max) {
    const pct = ((slider.value - min) / (max - min)) * 100;
    slider.style.setProperty('--pct', pct + '%');
  }

  function updateVolSlider(slider, numEl) {
    updateSliderFill(slider, 0, 100);
    numEl.value = slider.value;
  }

  function refreshRunningPlayback({ realignVisuals = false } = {}) {
    if (!running) return;
    const refreshSeq = ++playbackRefreshSeq;
    if (!isNative) {
      if (realignVisuals) startSchedulerFromNow();
      refreshBackgroundLoop();
      return;
    }
    void refreshBackgroundLoop().then(() => {
      if (!running || refreshSeq !== playbackRefreshSeq) return;
      if (realignVisuals) {
        nativeLoopAnchorMs = performance.now();
        updateBeatIndicators(0);
      }
    });
  }

  function refreshRunningTimingAndLoop() {
    refreshRunningPlayback({ realignVisuals: true });
  }

  function refreshRunningLoopOnly() {
    refreshRunningPlayback({ realignVisuals: isNative });
  }

  function currentBeatVolumes() {
    return {
      master: masterVol,
      beat1: volBeat1,
      quarter: volQuarter,
      eighth: volEighth,
      sixteenth: volSixteenth,
    };
  }

  function currentBeatStates() {
    return [...beatStates];
  }

  function applyBeatVolumes(bv) {
    if (!bv) return;
    masterVol    = bv.master    ?? 1.0;
    volBeat1     = bv.beat1     ?? 1.0;
    volQuarter   = bv.quarter   ?? 0.8;
    volEighth    = bv.eighth    ?? 0.5;
    volSixteenth = bv.sixteenth ?? 0.0;
    volMasterEl.value    = Math.round(masterVol * 100);
    volBeat1El.value     = Math.round(volBeat1 * 100);
    volQuarterEl.value   = Math.round(volQuarter * 100);
    volEighthEl.value    = Math.round(volEighth * 100);
    volSixteenthEl.value = Math.round(volSixteenth * 100);
    updateVolSlider(volMasterEl, volMasterNum);
    updateVolSlider(volBeat1El, volBeat1Num);
    updateVolSlider(volQuarterEl, volQuarterNum);
    updateVolSlider(volEighthEl, volEighthNum);
    updateVolSlider(volSixteenthEl, volSixteenthNum);
    refreshRunningLoopOnly();
  }

  function applyBeatStates(states, { refreshLoop = true } = {}) {
    beatStates = normalizeBeatStates(states, beatsPerMeasure);
    buildBeatDots();
    updateBeatIndicators(getCurrentBeatIndicatorIndex());
    if (refreshLoop) refreshRunningLoopOnly();
  }

  /**
   * Pro 機能のゲート。isPro なら即実行、free なら paywall を表示。
   * @param {() => void} onGranted - Pro 時に実行するコールバック
   */
  function requirePro(onGranted) {
    if (isPro) { onGranted(); return; }
    showProPaywall();
  }

  function showProPaywall() {
    if (!proPaywallEl) return;
    proPaywallEl.style.display = 'flex';
  }

  function hideProPaywall() {
    if (!proPaywallEl) return;
    proPaywallEl.style.display = 'none';
  }

  paywallCloseBtn?.addEventListener('click', hideProPaywall);
  proPaywallEl?.addEventListener('click', e => {
    if (e.target === proPaywallEl) hideProPaywall();
  });

  paywallBuyBtn?.addEventListener('click', () => {
    // Production: RevenueCat の購入フローを呼び出す
    console.log('[DEV] 購入フロー（未実装）');
    hideProPaywall();
  });

  paywallRestoreBtn?.addEventListener('click', () => {
    // Production: RevenueCat の restorePurchases を呼び出す
    console.log('[DEV] 購入復元（未実装）');
    hideProPaywall();
  });

  function applyPreset(song) {
    if (!song) return;
    setBPM(song.bpm);
    setTimeSig(song.tsNum ?? 4, song.tsDen ?? 4);
    applyBeatStates(song.beatStates ?? null, { refreshLoop: false });
    applyBeatVolumes(song.beatVolumes ?? null);
  }

  function buildTsPickerHTML(tsNumVal, tsDenVal, prefix) {
    const nums = [2, 3, 4, 5, 6, 7];
    const dens = [4, 8];
    return `
      <div class="ts-picker-row">
        <label>${t('page.timesig')}</label>
        <div class="ts-picker-group">
          <div class="ts-picker-nums">
            ${nums.map(n => `<button type="button" class="ts-btn${tsNumVal === n ? ' active' : ''}" data-target="${prefix}Num" data-val="${n}">${n}</button>`).join('')}
          </div>
          <span class="ts-slash">/</span>
          <div class="ts-picker-dens">
            ${dens.map(d => `<button type="button" class="ts-btn${tsDenVal === d ? ' active' : ''}" data-target="${prefix}Den" data-val="${d}">${d}</button>`).join('')}
          </div>
        </div>
        <input type="hidden" id="${prefix}Num" value="${tsNumVal}">
        <input type="hidden" id="${prefix}Den" value="${tsDenVal}">
      </div>
    `;
  }

  function mountTsPicker(container, tsNumVal, tsDenVal, prefix) {
    if (!container) return;
    container.innerHTML = buildTsPickerHTML(tsNumVal, tsDenVal, prefix);
    container.onclick = e => {
      const btn = e.target.closest('.ts-btn');
      if (!btn || !container.contains(btn)) return;
      const target = btn.dataset.target;
      const val = Number(btn.dataset.val);
      const inputEl = container.querySelector(`#${target}`);
      if (!inputEl) return;
      inputEl.value = String(val);
      container.querySelectorAll(`.ts-btn[data-target="${target}"]`)
        .forEach(b => b.classList.toggle('active', Number(b.dataset.val) === val));
    };
  }

  function setTsPickerValues(prefix, nextNum, nextDen) {
    const numEl = document.getElementById(`${prefix}Num`);
    const denEl = document.getElementById(`${prefix}Den`);
    if (!numEl || !denEl) return;
    numEl.value = String(nextNum);
    denEl.value = String(nextDen);
    const container = numEl.closest('.form-ts-picker') || denEl.closest('.form-ts-picker');
    if (!container) return;
    container.querySelectorAll(`.ts-btn[data-target="${prefix}Num"]`)
      .forEach(b => b.classList.toggle('active', Number(b.dataset.val) === nextNum));
    container.querySelectorAll(`.ts-btn[data-target="${prefix}Den"]`)
      .forEach(b => b.classList.toggle('active', Number(b.dataset.val) === nextDen));
  }

  function updateCapturePreview(prefix, bv, capturedBpm = null) {
    const el = document.getElementById(`${prefix}CapturePreview`);
    if (!el) return;
    if (!bv) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    const bpmText = Number.isFinite(capturedBpm) ? `BPM:${Math.round(capturedBpm)} ` : '';
    el.textContent =
      bpmText +
      `Master:${Math.round((bv.master ?? 1) * 100)} ` +
      `${t('volume.beat1')}:${Math.round((bv.beat1 ?? 1) * 100)} ` +
      `${t('volume.quarter')}:${Math.round((bv.quarter ?? 0.8) * 100)} ` +
      `${t('volume.eighth')}:${Math.round((bv.eighth ?? 0.5) * 100)} ` +
      `${t('volume.sixteenth')}:${Math.round((bv.sixteenth ?? 0) * 100)}`;
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
      refreshRunningLoopOnly();
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
  document.getElementById('bpmMinus5').addEventListener('click',  () => setBPM(bpm - 5));
  document.getElementById('bpmMinus1').addEventListener('click',  () => setBPM(bpm - 1));
  document.getElementById('bpmPlus1').addEventListener('click',   () => setBPM(bpm + 1));
  document.getElementById('bpmPlus5').addEventListener('click',   () => setBPM(bpm + 5));
  document.getElementById('bpmPlus10').addEventListener('click',  () => setBPM(bpm + 10));

  // ──── Time Signature Picker ────
  const TS_NUMS = [2, 3, 4, 5, 6, 7];
  const TS_DENS = [4, 8];

  function setTimeSig(nextNum, nextDen) {
    tsNum = TS_NUMS.includes(nextNum) ? nextNum : 4;
    tsDen = TS_DENS.includes(nextDen) ? nextDen : 4;
    beatsPerMeasure = tsNum;
    syncBeatStatesForMeasure();
    tsNumValEl.textContent = tsNum;
    tsDenValEl.textContent = tsDen;
    buildBeatDots();
    updateBeatIndicators(running ? 0 : null);
    if (running) refreshBackgroundLoop();
    if (running) { stopMetronome(); startMetronome(); }
  }

  function applyTimeSig() {
    setTimeSig(tsNum, tsDen);
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
    refreshRunningLoopOnly();
  });

  volBeat1El.addEventListener('input', () => {
    volBeat1 = volBeat1El.value / 100;
    updateVolSlider(volBeat1El, volBeat1Num);
    refreshRunningLoopOnly();
  });
  volQuarterEl.addEventListener('input', () => {
    volQuarter = volQuarterEl.value / 100;
    updateVolSlider(volQuarterEl, volQuarterNum);
    refreshRunningLoopOnly();
  });
  volEighthEl.addEventListener('input', () => {
    volEighth = volEighthEl.value / 100;
    updateVolSlider(volEighthEl, volEighthNum);
    refreshRunningLoopOnly();
  });
  volSixteenthEl.addEventListener('input', () => {
    volSixteenth = volSixteenthEl.value / 100;
    updateVolSlider(volSixteenthEl, volSixteenthNum);
    refreshRunningLoopOnly();
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
  muteBtnEls.forEach(btn => btn.addEventListener('click', () => setMute(!isMuted)));

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
    if (e.code === 'KeyM')  { setMute(!isMuted); }
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

  // ──── Settings Modal ─────────────────────────────────────
  function openSettings() {
    settingsOverlay.hidden = false;
    langJaBtn.classList.toggle('active', currentLang === 'ja');
    langEnBtn.classList.toggle('active', currentLang === 'en');
    wakelockOnBtn.classList.toggle('active', wakeLockEnabled);
    wakelockOffBtn.classList.toggle('active', !wakeLockEnabled);
  }

  function closeSettings() {
    settingsOverlay.hidden = true;
  }

  function setLang(lang) {
    currentLang = lang;
    localStorage.setItem('metro-lang', lang);
    langJaBtn.classList.toggle('active', lang === 'ja');
    langEnBtn.classList.toggle('active', lang === 'en');
    applyI18n();
  }

  function setWakeLock(enabled) {
    wakeLockEnabled = enabled;
    localStorage.setItem('metro-wakelock', enabled ? '1' : '0');
    wakelockOnBtn.classList.toggle('active', enabled);
    wakelockOffBtn.classList.toggle('active', !enabled);
    if (!enabled) releaseWakeLock();
    else if (running) void acquireWakeLock();
  }

  settingsBtns.forEach(btn => btn.addEventListener('click', openSettings));
  settingsClose.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', e => {
    if (e.target === settingsOverlay) closeSettings();
  });
  langJaBtn.addEventListener('click', () => setLang('ja'));
  langEnBtn.addEventListener('click', () => setLang('en'));
  wakelockOnBtn.addEventListener('click', () => setWakeLock(true));
  wakelockOffBtn.addEventListener('click', () => setWakeLock(false));

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
    if (isNative && running && nativeLoopAnchorMs > 0) {
      const beatDurMs = 60000 / bpm;
      const loopDurMs = beatDurMs * beatsPerMeasure;
      const elapsedMs = Math.max(0, performance.now() - nativeLoopAnchorMs);
      const loopMs = elapsedMs % loopDurMs;
      beatIdx = Math.floor(loopMs / beatDurMs) % beatsPerMeasure;
      phase = (loopMs % beatDurMs) / beatDurMs;
      updateBeatIndicators(beatIdx);
    } else if (running && audioCtx) {
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
    } else {
      updateBeatIndicators();
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
  let _bgLoopPendingSig = '';
  let _bgLoopBuildPromise = null;
  let _bgLoopReloading = false;
  let _nativeLoopPreparePromise = null;
  const BG_LOOP_MEASURES = 32;
  const NATIVE_BG_LOOP_MEASURES = 2;

  async function buildClickLoopWav() {
    const sig = [
      bpm, beatsPerMeasure,
      beatStates.join(','),
      masterVol, volBeat1, volQuarter, volEighth, volSixteenth,
    ].join('|');
    if (_bgLoopUrl && _bgLoopSig === sig) return _bgLoopUrl;
    if (_bgLoopBuildPromise && _bgLoopPendingSig === sig) return _bgLoopBuildPromise;

    _bgLoopPendingSig = sig;
    _bgLoopBuildPromise = (async () => {
      const rate = audioCtx ? audioCtx.sampleRate : 44100;
      const beatDur = 60 / bpm;
      const sixteenthDur = beatDur / 4;
      const loopMeasures = isNative ? NATIVE_BG_LOOP_MEASURES : BG_LOOP_MEASURES;
      const loopDuration = beatDur * beatsPerMeasure * loopMeasures;
      const frameCount = Math.max(1, Math.ceil(rate * loopDuration));
      const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, frameCount, rate);

      function renderClick(time, vol, freq, dur) {
        if (vol <= 0) return;
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();
        osc.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, time);
        gain.gain.setValueAtTime(vol * 0.6, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
        osc.start(time);
        osc.stop(time + dur + 0.01);
      }

      function scheduleOfflineNote(time, subBeat) {
        const mod4 = subBeat % 4;
        const beatIdx = Math.floor(subBeat / 4);

        if (mod4 === 0) {
          const beatSound = getQuarterBeatSound(beatIdx);
          if (beatSound) {
            renderClick(time, beatSound.volume, beatSound.freq, beatSound.dur);
          }
        } else if (mod4 === 2) {
          renderClick(time, volEighth * masterVol, 700, 0.022);
        } else {
          renderClick(time, volSixteenth * masterVol, 550, 0.018);
        }
      }

      for (let measure = 0; measure < loopMeasures; measure++) {
        const measureBaseTime = measure * beatDur * beatsPerMeasure;
        for (let subBeat = 0; subBeat < beatsPerMeasure * 4; subBeat++) {
          const time = measureBaseTime + (subBeat * sixteenthDur);
          scheduleOfflineNote(time, subBeat);
        }
      }

      const rendered = await offlineCtx.startRendering();
      const pcm = rendered.getChannelData(0);
      const ab = new ArrayBuffer(44 + pcm.length * 2);
      const dv = new DataView(ab);
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };

      ws(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true);
      ws(8, 'WAVE'); ws(12, 'fmt ');
      dv.setUint32(16, 16, true);
      dv.setUint16(20, 1, true);
      dv.setUint16(22, 1, true);
      dv.setUint32(24, rate, true);
      dv.setUint32(28, rate * 2, true);
      dv.setUint16(32, 2, true);
      dv.setUint16(34, 16, true);
      ws(36, 'data'); dv.setUint32(40, pcm.length * 2, true);

      for (let i = 0; i < pcm.length; i++) {
        const s = Math.max(-1, Math.min(1, pcm[i]));
        dv.setInt16(44 + i * 2, s * 32767, true);
      }

      const nextUrl = URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
      if (_bgLoopUrl && _bgLoopSig !== sig) URL.revokeObjectURL(_bgLoopUrl);
      _bgLoopUrl = nextUrl;
      _bgLoopSig = sig;
      return nextUrl;
    })();

    try {
      return await _bgLoopBuildPromise;
    } finally {
      if (_bgLoopPendingSig === sig) {
        _bgLoopBuildPromise = null;
      }
    }
  }

  function initBgLoopEl() {
    if (_bgLoopEl) return;
    _bgLoopEl = new Audio();
    _bgLoopEl.loop = true;
    _bgLoopEl.preload = 'auto';
    _bgLoopEl.muted = true;
    _bgLoopEl.playsInline = true;
    _bgLoopEl.setAttribute('playsinline', '');
    _bgLoopEl.setAttribute('webkit-playsinline', '');
    _bgLoopEl.addEventListener('pause', () => {
      if (!running || _bgLoopReloading) return;
      _bgLoopEl.play().catch(() => {});
    });
  }

  function syncBgLoopMuted() {
    if (_bgLoopEl) _bgLoopEl.muted = !document.hidden ? true : isMuted;
  }

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let b64 = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      b64 += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(b64);
  }

  async function refreshBgLoopTrack() {
    initBgLoopEl();
    const nextSrc = await buildClickLoopWav();
    if (_bgLoopEl.src !== nextSrc) {
      const wasPlaying = !_bgLoopEl.paused;
      _bgLoopReloading = true;
      _bgLoopEl.src = nextSrc;
      _bgLoopEl.load();
      _bgLoopReloading = false;
      if (wasPlaying) _bgLoopEl.play().catch(() => {});
    }
  }

  async function prepareNativeLoop() {
    const url = await buildClickLoopWav();
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);
    await NativeMetronomeAudio.prepareLoop({ base64 }).catch(err => {
      console.error('[MetronomeAudio] prepareLoop failed', err);
      throw err;
    });
  }

  function nativeLoopMutedValue() {
    return isMuted;
  }

  function syncNativeLoopState() {
    if (!running) return Promise.resolve();
    return NativeMetronomeAudio.startLoop({ muted: nativeLoopMutedValue() }).catch(err => {
      console.error('[MetronomeAudio] startLoop failed', err);
    });
  }

  function refreshBackgroundLoop() {
    if (isNative) {
      _nativeLoopPreparePromise = prepareNativeLoop().then(() => syncNativeLoopState());
      return _nativeLoopPreparePromise;
    }
    return refreshBgLoopTrack();
  }

  function bgAudioStart() {
    if (isNative) {
      _nativeLoopPreparePromise = prepareNativeLoop().then(() =>
        NativeMetronomeAudio.startLoop({ muted: isMuted }).then(() => {
          nativeLoopAnchorMs = performance.now();
          updateBeatIndicators(0);
        }).catch(err => {
          console.error('[MetronomeAudio] startLoop failed', err);
        }));
    } else {
      initBgLoopEl();
      // ユーザージェスチャー内で即 play（iOS autoplay 制限を回避）
      syncBgLoopMuted();
      if (_bgLoopEl.src) {
        _bgLoopEl.play().catch(() => {});
      }
      void refreshBgLoopTrack().then(() => {
        if (!running) return;
        syncBgLoopMuted();
        _bgLoopEl.play().catch(() => {});
      });
    }
  }

  function bgAudioStop() {
    if (isNative) {
      NativeMetronomeAudio.stopLoop().catch(err => {
        console.error('[MetronomeAudio] stopLoop failed', err);
      });
    } else if (_bgLoopEl) {
      _bgLoopEl.pause();
      _bgLoopEl.currentTime = 0;
      _bgLoopEl.muted = true;
    }
  }

  function resumeForegroundScheduler() {
    if (!running || !audioCtx || document.hidden) return;
    if (isNative) {
      void syncNativeLoopState();
    } else {
      syncBgLoopMuted();
    }
    void ensureSchedulerContextRunning().then(isRunning => {
      if (running && isRunning) {
        startSchedulerFromNow();
      }
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (!running || !audioCtx) return;
    if (document.hidden) {
      clearTimeout(timerID);
      timerID = null;
      if (isNative) {
        audioCtx.suspend().catch(() => {});
        void (_nativeLoopPreparePromise ?? Promise.resolve())
          .then(() => syncNativeLoopState());
      } else {
        syncBgLoopMuted();
      }
    } else {
      resumeForegroundScheduler();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && running && wakeLockEnabled) {
      void acquireWakeLock();
    }
  });

  window.addEventListener('focus', resumeForegroundScheduler);
  window.addEventListener('pageshow', resumeForegroundScheduler);

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
  let libFormBeatVolumes = null;
  let libFormBeatStates = null;
  let pfFormBeatVolumes = null;
  let pfFormBeatStates = null;

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
  const libTsPickerEl    = document.getElementById('libTsPicker');
  const pfTsPickerEl     = document.getElementById('pfTsPicker');
  const libCaptureBtn    = document.getElementById('libCaptureBtn');
  const pfCaptureBtn     = document.getElementById('pfCaptureBtn');
  const nowPlayingEls = [
    document.getElementById('nowPlaying'),
    document.getElementById('nowPlayingLib'),
  ].filter(Boolean);

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
      slIndexList.innerHTML = `<div class="setlist-empty">${t('empty.noSetlists')}</div>`;
      return;
    }
    slIndexList.innerHTML = setlists.map((sl, idx) => `
      <div class="sl-row" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <button class="sl-row-btn" data-id="${sl.id}">
          <span class="sl-row-title">${escHtml(sl.name)}</span>
          <span class="sl-row-count">${sl.songs.length} ${t('label.songsCount')}</span>
        </button>
        <button class="preset-icon-btn" data-id="${sl.id}" data-action="edit-sl" title="${t('action.edit')}">✏</button>
        <button class="preset-icon-btn del" data-id="${sl.id}" data-action="del-sl" title="${t('action.delete')}">✕</button>
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
    if (!confirm(t('confirm.deleteSetlist'))) return;
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
      songList.innerHTML = `<div class="setlist-empty">${t('empty.noSongs')}</div>`;
      return;
    }
    songList.innerHTML = sl.songs.map((p, idx) => `
      <div class="preset-row${activeSongId === p.id ? ' active' : ''}" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <button class="preset-apply" data-id="${p.id}">
          <span class="preset-num">${idx + 1}</span>
          <span class="preset-name">${escHtml(p.name) || t('untitled')}</span>
          <span class="preset-bpm">${escHtml(p.bpm)} BPM</span>
          <span class="preset-ts">${escHtml(p.tsNum ?? 4)}/${escHtml(p.tsDen ?? 4)}</span>
        </button>
        <button class="preset-icon-btn" data-id="${p.id}" data-action="edit" title="${t('action.edit')}">✏</button>
        <button class="preset-icon-btn del" data-id="${p.id}" data-action="del" title="${t('action.delete')}">✕</button>
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
    const linkedLibSong = (p.libSongId ?? null)
      ? songLibrary.find(song => song.id === (p.libSongId ?? null))
      : null;
    const songCfg = {
      bpm: p.bpm,
      tsNum: p.tsNum ?? linkedLibSong?.tsNum ?? 4,
      tsDen: p.tsDen ?? linkedLibSong?.tsDen ?? 4,
      beatStates: p.beatStates ?? linkedLibSong?.beatStates ?? null,
      beatVolumes: p.beatVolumes ?? linkedLibSong?.beatVolumes ?? null,
    };
    if (activeSongId === id) {
      // Same song tapped again: stop, or (re)start with this song's saved config
      if (running) {
        stopMetronome();
      } else {
        setBPM(songCfg.bpm);
        setTimeSig(songCfg.tsNum, songCfg.tsDen);
        applyBeatStates(songCfg.beatStates ?? null, { refreshLoop: false });
        applyBeatVolumes(songCfg.beatVolumes);
        startMetronome();
      }
    } else {
      // New song: switch BPM and auto-start
      activeLibSongId = null;
      activeSongId = id;
      activeSlId   = currentSlId;
      setBPM(songCfg.bpm);
      setTimeSig(songCfg.tsNum, songCfg.tsDen);
      applyBeatStates(songCfg.beatStates ?? null, { refreshLoop: false });
      applyBeatVolumes(songCfg.beatVolumes);
      renderSongs();
      updateNowPlaying();
      startMetronome();
    }
  }

  function applyLibrarySong(id) {
    const s = songLibrary.find(song => song.id === id);
    if (!s) return;
    const songCfg = {
      bpm: s.bpm,
      tsNum: s.tsNum ?? 4,
      tsDen: s.tsDen ?? 4,
      beatStates: s.beatStates ?? null,
      beatVolumes: s.beatVolumes ?? null,
    };
    if (activeLibSongId === id) {
      // Same song tapped again: stop, or (re)start with this song's saved config
      if (running) {
        stopMetronome();
      } else {
        setBPM(songCfg.bpm);
        setTimeSig(songCfg.tsNum, songCfg.tsDen);
        applyBeatStates(songCfg.beatStates ?? null, { refreshLoop: false });
        applyBeatVolumes(songCfg.beatVolumes);
        startMetronome();
      }
      return;
    }
    // New library song: switch BPM and auto-start
    activeLibSongId = id;
    activeSongId = null;
    activeSlId = null;
    setBPM(songCfg.bpm);
    setTimeSig(songCfg.tsNum, songCfg.tsDen);
    applyBeatStates(songCfg.beatStates ?? null, { refreshLoop: false });
    applyBeatVolumes(songCfg.beatVolumes);
    renderLibrary();
    updateNowPlaying();
    startMetronome();
  }

  function openAddSongForm() {
    editingSongId = null;
    pfFormBeatVolumes = null;
    pfFormBeatStates = null;
    setFormMode('library');
    pfName.value = '';
    pfBpm.value  = bpm;
    mountTsPicker(pfTsPickerEl, tsNum, tsDen, 'pfTs');
    updateCapturePreview('pf', pfFormBeatVolumes);
    presetForm.style.display = 'block';
    pfName.focus();
  }

  function openEditSongForm(id) {
    const sl = currentSetlist();
    if (!sl) return;
    const p = sl.songs.find(s => s.id === id);
    if (!p) return;
    editingSongId = id;
    pfFormBeatVolumes = p.beatVolumes ?? null;
    pfFormBeatStates = p.beatStates ?? null;
    setFormMode('manual');
    pfName.value = p.name;
    pfBpm.value  = p.bpm;
    mountTsPicker(pfTsPickerEl, p.tsNum ?? 4, p.tsDen ?? 4, 'pfTs');
    updateCapturePreview('pf', pfFormBeatVolumes);
    presetForm.style.display = 'block';
    pfName.focus();
  }

  function closeSongForm() {
    editingSongId = null;
    pfFormBeatVolumes = null;
    pfFormBeatStates = null;
    updateCapturePreview('pf', null);
    if (presetForm) presetForm.style.display = 'none';
  }

  function saveSongForm() {
    const sl = currentSetlist();
    if (!sl) return;
    const name   = pfName.value.trim();
    const bpmVal = Math.min(300, Math.max(20, parseInt(pfBpm.value) || bpm));
    const tsNumVal = Number(document.getElementById('pfTsNum')?.value) || 4;
    const tsDenVal = Number(document.getElementById('pfTsDen')?.value) || 4;
    if (!name) { pfName.focus(); return; }
    if (editingSongId) {
      const idx = sl.songs.findIndex(s => s.id === editingSongId);
      if (idx !== -1) {
        sl.songs[idx] = {
          ...sl.songs[idx],
          name,
          bpm: bpmVal,
          tsNum: tsNumVal,
          tsDen: tsDenVal,
          beatStates: pfFormBeatStates,
          beatVolumes: pfFormBeatVolumes,
          libSongId: null,
        };
        if (activeSongId === editingSongId) {
          setBPM(bpmVal);
          setTimeSig(tsNumVal, tsDenVal);
          applyBeatStates(pfFormBeatStates ?? null, { refreshLoop: false });
          applyBeatVolumes(pfFormBeatVolumes ?? null);
          updateNowPlaying();
        }
      }
    } else {
      sl.songs.push({
        id: Date.now().toString(),
        name,
        bpm: bpmVal,
        tsNum: tsNumVal,
        tsDen: tsDenVal,
        beatStates: pfFormBeatStates,
        beatVolumes: pfFormBeatVolumes,
        libSongId: null,
      });
    }
    saveSetlists();
    closeSongForm();
    renderSongs();
  }

  function deleteSong(id) {
    const sl = currentSetlist();
    if (!sl) return;
    if (!confirm(t('confirm.deleteSong'))) return;
    sl.songs = sl.songs.filter(s => s.id !== id);
    if (activeSongId === id) { activeSongId = null; updateNowPlaying(); }
    saveSetlists();
    renderSongs();
  }

  function updateNowPlayingState() {
    nowPlayingEls.forEach(el => {
      if (el.style.display === 'none') return;
      el.classList.toggle('paused', !running);
      const icon = el.querySelector('.np-icon');
      if (icon) icon.textContent = running ? '▶' : '■';
    });
  }

  function updateNowPlaying() {
    let currentName = '';
    let currentBpm = null;
    if (activeSongId && activeSlId) {
      const sl = setlists.find(s => s.id === activeSlId);
      const p  = sl ? sl.songs.find(s => s.id === activeSongId) : null;
      if (p) {
        currentName = p.name || t('untitled');
        currentBpm = p.bpm;
      }
    }
    if (!currentName && activeLibSongId) {
      const s = songLibrary.find(song => song.id === activeLibSongId);
      if (s) {
        currentName = s.name || t('untitled');
        currentBpm = s.bpm;
      }
    }
    nowPlayingEls.forEach(el => {
      const nameEl = el.querySelector('.np-name');
      const bpmEl = el.querySelector('.np-bpm');
      if (currentName && currentBpm !== null) {
        if (nameEl) nameEl.textContent = currentName;
        if (bpmEl) bpmEl.textContent = currentBpm + ' BPM';
        el.style.display = 'flex';
      } else {
        el.style.display = 'none';
      }
    });
    updateNowPlayingState();
  }

  // ── Now Playing: click to toggle metronome ──
  nowPlayingEls.forEach(el => el.addEventListener('click', () => {
    if (!activeSongId && !activeLibSongId) return;
    if (running) stopMetronome(); else startMetronome();
  }));

  // ── Setlist event listeners ──
  document.getElementById('btnAddSetlist').addEventListener('click', () => {
    if (setlists.length >= 1 && !isPro) {
      requirePro(() => openAddSlForm());
    } else {
      openAddSlForm();
    }
  });
  document.getElementById('slSave').addEventListener('click', saveSlForm);
  document.getElementById('slCancel').addEventListener('click', closeSlForm);
  slNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveSlForm(); });

  document.getElementById('btnBack').addEventListener('click', showSlIndex);
  document.getElementById('btnAddSong').addEventListener('click', () => {
    const sl = currentSetlist();
    const currentSongs = sl ? sl.songs : [];
    if (currentSongs.length >= 10 && !isPro) {
      requirePro(() => openAddSongForm());
    } else {
      openAddSongForm();
    }
  });
  document.getElementById('pfSave').addEventListener('click', saveSongForm);
  document.getElementById('pfCancel').addEventListener('click', closeSongForm);
  pfName.addEventListener('keydown', e => { if (e.key === 'Enter') saveSongForm(); });
  pfBpm.addEventListener('keydown',  e => { if (e.key === 'Enter') saveSongForm(); });
  pfCaptureBtn.addEventListener('click', () => {
    requirePro(() => {
      pfFormBeatVolumes = currentBeatVolumes();
      pfFormBeatStates = currentBeatStates();
      pfBpm.value = bpm;
      setTsPickerValues('pfTs', tsNum, tsDen);
      updateCapturePreview('pf', pfFormBeatVolumes, bpm);
    });
  });

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
      pfLibList.innerHTML = `<div class="setlist-empty">${t('empty.noLibrarySongs')}</div>`;
      return;
    }
    pfLibList.innerHTML = getLibrarySongsForDisplay().map(s => `
      <div class="preset-row">
        <button class="preset-apply" data-id="${s.id}">
          <span class="preset-name">${escHtml(s.name)}</span>
          <span class="preset-bpm">${escHtml(s.bpm)} BPM</span>
          <span class="preset-ts">${escHtml(s.tsNum ?? 4)}/${escHtml(s.tsDen ?? 4)}</span>
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
        sl.songs[idx] = {
          ...sl.songs[idx],
          name: libSong.name,
          bpm: libSong.bpm,
          tsNum: libSong.tsNum ?? 4,
          tsDen: libSong.tsDen ?? 4,
          beatStates: libSong.beatStates ?? null,
          beatVolumes: libSong.beatVolumes ?? null,
          libSongId: libSong.id,
        };
        if (activeSongId === editingSongId) {
          setBPM(libSong.bpm);
          setTimeSig(libSong.tsNum ?? 4, libSong.tsDen ?? 4);
          applyBeatStates(libSong.beatStates ?? null, { refreshLoop: false });
          applyBeatVolumes(libSong.beatVolumes ?? null);
          updateNowPlaying();
        }
      }
    } else {
      sl.songs.push({
        id: Date.now().toString(),
        name: libSong.name,
        bpm: libSong.bpm,
        tsNum: libSong.tsNum ?? 4,
        tsDen: libSong.tsDen ?? 4,
        beatStates: libSong.beatStates ?? null,
        beatVolumes: libSong.beatVolumes ?? null,
        libSongId: libSong.id,
      });
    }
    saveSetlists();
    closeSongForm();
    renderSongs();
  }

  // ── Song Library CRUD ──
  function saveSongLib() { localStorage.setItem('metro-song-lib', JSON.stringify(songLibrary)); }

  function propagateLibSongChange(libSong) {
    let changed = false;
    setlists.forEach(sl => {
      sl.songs.forEach((song, idx) => {
        if ((song.libSongId ?? null) !== libSong.id) return;
        const nextSong = {
          ...song,
          name: libSong.name,
          bpm: libSong.bpm,
          tsNum: libSong.tsNum ?? 4,
          tsDen: libSong.tsDen ?? 4,
          beatStates: libSong.beatStates ?? null,
          beatVolumes: libSong.beatVolumes ?? null,
        };
        sl.songs[idx] = nextSong;
        if (activeSongId === song.id) {
          applyPreset(nextSong);
          updateNowPlaying();
        }
        changed = true;
      });
    });
    if (!changed) return;
    saveSetlists();
    if (slDetailEl.classList.contains('active')) renderSongs();
  }

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
      libSongList.innerHTML = `<div class="setlist-empty">${t('empty.noSongs')}</div>`;
      return;
    }
    const showDragHandle = libSortMode === 'manual';
    libSongList.innerHTML = getLibrarySongsForDisplay().map((s, idx) => `
      <div class="preset-row${activeLibSongId === s.id ? ' active' : ''}" data-idx="${idx}">
        ${showDragHandle ? '<span class="drag-handle">⠿</span>' : ''}
        <button class="preset-apply" data-id="${s.id}">
          <span class="preset-name">${escHtml(s.name)}</span>
          <span class="preset-bpm">${escHtml(s.bpm)} BPM</span>
          <span class="preset-ts">${escHtml(s.tsNum ?? 4)}/${escHtml(s.tsDen ?? 4)}</span>
        </button>
        <button class="preset-icon-btn" data-id="${s.id}" data-action="edit-lib" title="${t('action.edit')}">✏</button>
        <button class="preset-icon-btn del" data-id="${s.id}" data-action="del-lib" title="${t('action.delete')}">✕</button>
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
    editingLibId = null;
    libFormBeatVolumes = null;
    libFormBeatStates = null;
    libNameInput.value = '';
    libBpmInput.value = bpm;
    mountTsPicker(libTsPickerEl, 4, 4, 'libTs');
    updateCapturePreview('lib', libFormBeatVolumes);
    libForm.style.display = 'block'; libNameInput.focus();
  }
  function openEditLibForm(id) {
    const s = songLibrary.find(s => s.id === id);
    if (!s) return;
    editingLibId = id;
    libFormBeatVolumes = s.beatVolumes ?? null;
    libFormBeatStates = s.beatStates ?? null;
    libNameInput.value = s.name;
    libBpmInput.value = s.bpm;
    mountTsPicker(libTsPickerEl, s.tsNum ?? 4, s.tsDen ?? 4, 'libTs');
    updateCapturePreview('lib', libFormBeatVolumes);
    libForm.style.display = 'block'; libNameInput.focus();
  }
  function closeLibForm() {
    editingLibId = null;
    libFormBeatVolumes = null;
    libFormBeatStates = null;
    updateCapturePreview('lib', null);
    libForm.style.display = 'none';
  }
  function saveLibForm() {
    const name = libNameInput.value.trim();
    const bpmVal = Math.min(300, Math.max(20, parseInt(libBpmInput.value) || bpm));
    const tsNumVal = Number(document.getElementById('libTsNum')?.value) || 4;
    const tsDenVal = Number(document.getElementById('libTsDen')?.value) || 4;
    if (!name) { libNameInput.focus(); return; }
    let editedSong = null;
    if (editingLibId) {
      const s = songLibrary.find(s => s.id === editingLibId);
      if (s) {
        s.name = name;
        s.bpm = bpmVal;
        s.tsNum = tsNumVal;
        s.tsDen = tsDenVal;
        s.beatVolumes = libFormBeatVolumes;
        s.beatStates = libFormBeatStates;
        editedSong = s;
      }
    } else {
      songLibrary.push({
        id: Date.now().toString(),
        name,
        bpm: bpmVal,
        tsNum: tsNumVal,
        tsDen: tsDenVal,
        beatVolumes: libFormBeatVolumes,
        beatStates: libFormBeatStates,
      });
    }
    if (editedSong) propagateLibSongChange(editedSong);
    saveSongLib();
    closeLibForm();
    renderLibrary();
  }
  function deleteLibSong(id) {
    if (!confirm(t('confirm.deleteLibrarySong'))) return;
    if (activeLibSongId === id) activeLibSongId = null;
    songLibrary = songLibrary.filter(s => s.id !== id);
    saveSongLib(); renderLibrary(); updateNowPlaying();
  }

  document.getElementById('btnAddLibSong').addEventListener('click', () => {
    if (songLibrary.length >= 10 && !isPro) {
      requirePro(() => openAddLibForm());
    } else {
      openAddLibForm();
    }
  });
  libSortManualBtn.addEventListener('click', () => setLibrarySortMode('manual'));
  libSortNameBtn.addEventListener('click',   () => setLibrarySortMode('name'));
  libSortBpmBtn.addEventListener('click',    () => setLibrarySortMode('bpm'));
  document.getElementById('libSave').addEventListener('click', saveLibForm);
  document.getElementById('libCancel').addEventListener('click', closeLibForm);
  libNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveLibForm(); });
  libBpmInput.addEventListener('keydown',  e => { if (e.key === 'Enter') saveLibForm(); });
  libCaptureBtn.addEventListener('click', () => {
    requirePro(() => {
      libFormBeatVolumes = currentBeatVolumes();
      libFormBeatStates = currentBeatStates();
      libBpmInput.value = bpm;
      setTsPickerValues('libTs', tsNum, tsDen);
      updateCapturePreview('lib', libFormBeatVolumes, bpm);
    });
  });

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

  if (!isNativeApp) {
    const devBtn = document.createElement('button');
    devBtn.id = 'devProToggle';
    devBtn.style.cssText =
      'position:fixed;bottom:12px;left:12px;z-index:10000;' +
      'padding:4px 10px;font-size:11px;border-radius:6px;' +
      'background:#333;color:#fff;border:1px solid #666;cursor:pointer;opacity:0.8;';
    const update = () => { devBtn.textContent = isPro ? 'DEV: PRO ON' : 'DEV: PRO OFF'; };
    update();
    devBtn.addEventListener('click', () => {
      isPro = !isPro;
      localStorage.setItem('metro-dev-force-pro', isPro ? '1' : '0');
      update();
      renderLibrary();
      renderSetlists();
    });
    document.body.appendChild(devBtn);
  }

  applyI18n();

  // バックグラウンドループ WAV をアプリ起動時に事前ビルドしておく
  // OfflineAudioContext は AudioContext 不要なのでユーザー操作前でも実行できる
  void (isNative ? prepareNativeLoop() : refreshBgLoopTrack());

})();

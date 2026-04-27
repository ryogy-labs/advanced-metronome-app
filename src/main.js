import './style.css';
import { registerPlugin } from '@capacitor/core';
import {
  BPM_MIN, BPM_MAX, BPM_DEFAULT,
  TAP_RESET_MS,
  TS_NUMS, TS_DENS,
  SWIPE_TOTAL_PAGES, SWIPE_SLOT_STEP, SWIPE_THRESHOLD_PX,
  FREE_SETLIST_LIMIT, FREE_SONGS_PER_SETLIST, FREE_LIBRARY_LIMIT,
  CLICK_ACCENT, CLICK_QUARTER,
  LS_KEYS,
} from './config.js';
import { createI18n, readInitialLang } from './i18n.js';
import { safeParseJSON, writeJSON } from './utils/storage.js';
import { escHtml } from './utils/dom.js';
import { nextId } from './utils/id.js';
import { createBgLoopBuilder, arrayBufferToBase64 } from './audio/bg-loop.js';
import { createBgPlayback } from './audio/bg-playback.js';
import { createScheduler } from './audio/scheduler.js';
import { setupDnD } from './ui/dnd.js';
import { renderSongRows } from './ui/song-row.js';
import { createBallAnimator } from './ui/ball.js';
import { createSwipePanel } from './ui/swipe-panel.js';

const NativeMetronomeAudio = registerPlugin('MetronomeAudio');
const isNative = window.Capacitor?.isNativePlatform() ?? false;

(() => {
  const isNativeApp = Boolean(
    window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === 'function' &&
    window.Capacitor.isNativePlatform()
  );

  // ──── State ────
  let bpm = BPM_DEFAULT;
  let beatsPerMeasure = 4;
  let beatStates = ['accent', 'normal', 'normal', 'normal'];
  // Time signature picker state
  let tsNum = 4;          // numerator  : 2-12
  let tsDen = 4;          // denominator: 4 or 8
  let masterVol = 1.0;
  let volBeat1 = 1.0, volQuarter = 0.8, volEighth = 0.5, volSixteenth = 0.0;
  let running = false;
  let isEditingBpm = false;
  let bpmBeforeEdit = BPM_DEFAULT;

  // Tap tempo
  let tapTimes = [];
  let isMuted = false;
  // ── Pro ステータス ──────────────────────────────
  // Production では RevenueCat/StoreKit の結果に差し替える（この1箇所だけ変更すれば良い）
  let isPro = (() => {
    if (!isNativeApp) {
      try { return localStorage.getItem(LS_KEYS.devForcePro) === '1'; } catch { return false; }
    }
    return false; // 本番はデフォルト free
  })();

  // AudioContext (scheduling state lives in the scheduler module).
  let audioCtx = null;
  let masterGainNode = null;
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
  let squashEnabled = true;
  let animMode = 'vertical'; // 'vertical' | 'horizontal'


  function buildDefaultBeatStates(count) {
    return Array.from({ length: count }, (_, idx) => {
      const isCompoundAccent = tsDen === 8 && count >= 6 && count % 3 === 0 && idx % 3 === 0;
      return idx === 0 || isCompoundAccent ? 'accent' : 'normal';
    });
  }

  function normalizeBeatStates(states, count = beatsPerMeasure) {
    const fallback = buildDefaultBeatStates(count);
    if (!Array.isArray(states)) return fallback;
    return fallback.map((state, idx) => {
      const next = states[idx];
      return next === 'accent' || next === 'normal' || next === 'mute' ? next : state;
    });
  }

  // ──── i18n (translations live in ./i18n.js) ────────────────
  const i18n = createI18n(readInitialLang());
  const t = (key) => i18n.t(key);

  // ──── Screen Wake Lock ────────────────────────────────────
  let wakeLockEnabled = (() => {
    try { return localStorage.getItem(LS_KEYS.wakelock) !== '0'; } catch { return true; }
  })();
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
  const denominatorAwareVolumeEls = [
    { labelKey: 'volume.quarter', slider: volQuarterEl, num: volQuarterNum },
    { labelKey: 'volume.eighth', slider: volEighthEl, num: volEighthNum },
    { labelKey: 'volume.sixteenth', slider: volSixteenthEl, num: volSixteenthNum },
  ];
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
    updateDenominatorAwareVolumeUi();
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
      return { volume: volBeat1 * masterVol, freq: CLICK_ACCENT.freq, dur: CLICK_ACCENT.dur };
    }
    return { volume: volQuarter * masterVol, freq: CLICK_QUARTER.freq, dur: CLICK_QUARTER.dur };
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
      const times = _scheduler.getScheduledBeatTimes();
      for (let i = times.length - 1; i >= 0; i--) {
        if (times[i].time <= now) {
          return times[i].beatIdx;
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
      rowEl.dataset.count = String(beatsPerMeasure);
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

  function setMute(m) {
    isMuted = m;
    if (masterGainNode && audioCtx) {
      masterGainNode.gain.setTargetAtTime(m ? 0 : 1, audioCtx.currentTime, 0.015);
    }
    if (isNative && running) {
      void _bgPlayback.awaitNativePrepare()
        .then(() => _bgPlayback.syncNativeState());
    }
    _bgPlayback.syncMuted();
    muteBtnEls.forEach(btn => {
      btn.classList.toggle('muted', m);
      btn.textContent = m ? '🔇' : '🔊';
    });
  }

  // ──── Scheduler (always 16th note resolution) ────
  const _scheduler = createScheduler({
    getCtx,
    getDestination: () => masterGainNode,
    isNative: () => isNative,
    getState: () => ({
      bpm,
      beatsPerMeasure,
      tsDen,
      masterVol,
      volEighth,
      volSixteenth,
    }),
    getQuarterBeatSound,
    onBeatFlash: flashBeat,
  });

  function startSchedulerFromNow() {
    _scheduler.start();
    updateBeatIndicators(0);
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
      _bgPlayback.start();
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
    _scheduler.stop();
    nativeLoopAnchorMs = 0;
    _bgPlayback.stop();
    playBtn.textContent = t('metro.start');
    playBtn.classList.remove('running');
    releaseWakeLock();
    updateBeatIndicators();
    updateNowPlayingState();
  }

  // ──── BPM helpers ────
  function setBPM(val) {
    bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(val)));
    bpmDisplay.textContent = bpm;
    bpmSlider.value = bpm;
    updateSliderFill(bpmSlider, BPM_MIN, BPM_MAX);
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

  function getSubdivisionVolumeLabels(den = tsDen) {
    if (den === 8) {
      return i18n.lang === 'ja'
        ? { quarter: '8分', eighth: '16分', sixteenth: '32分' }
        : { quarter: 'Eighth', eighth: 'Sixteenth', sixteenth: '32nd' };
    }
    return i18n.lang === 'ja'
      ? { quarter: '4分', eighth: '8分', sixteenth: '16分' }
      : { quarter: 'Quarter', eighth: 'Eighth', sixteenth: 'Sixteenth' };
  }

  function updateDenominatorAwareVolumeUi() {
    const labels = getSubdivisionVolumeLabels();
    document.querySelectorAll('[data-i18n="volume.quarter"]')
      .forEach(el => { el.textContent = labels.quarter; });
    document.querySelectorAll('[data-i18n="volume.eighth"]')
      .forEach(el => { el.textContent = labels.eighth; });
    document.querySelectorAll('[data-i18n="volume.sixteenth"]')
      .forEach(el => { el.textContent = labels.sixteenth; });

    const disableFinest = tsDen === 8;
    denominatorAwareVolumeEls.forEach(({ labelKey, slider, num }) => {
      const disabled = disableFinest && labelKey === 'volume.sixteenth';
      const row = slider?.closest('.vol-row');
      if (slider) slider.disabled = disabled;
      if (num) num.disabled = disabled;
      row?.classList.toggle('is-disabled', disabled);
      row?.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    });
  }

  function refreshRunningPlayback({ realignVisuals = false } = {}) {
    if (!running) return;
    const refreshSeq = ++playbackRefreshSeq;
    if (!isNative) {
      if (realignVisuals) startSchedulerFromNow();
      _bgPlayback.refreshWhenSafe();
      return;
    }
    void _bgPlayback.refreshNow().then(() => {
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
    const nums = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
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

  function updateCapturePreview(prefix, bv, capturedBpm = null, capturedDen = tsDen) {
    const el = document.getElementById(`${prefix}CapturePreview`);
    if (!el) return;
    if (!bv) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    const bpmText = Number.isFinite(capturedBpm) ? `BPM:${Math.round(capturedBpm)} ` : '';
    const labels = getSubdivisionVolumeLabels(capturedDen);
    el.textContent =
      bpmText +
      `Master:${Math.round((bv.master ?? 1) * 100)} ` +
      `${t('volume.beat1')}:${Math.round((bv.beat1 ?? 1) * 100)} ` +
      `${labels.quarter}:${Math.round((bv.quarter ?? 0.8) * 100)} ` +
      `${labels.eighth}:${Math.round((bv.eighth ?? 0.5) * 100)} ` +
      `${labels.sixteenth}:${Math.round((bv.sixteenth ?? 0) * 100)}`;
  }

  function parseVolumeInput(inputEl, fallback) {
    const raw = String(inputEl.value || '').trim();
    const typed = Number(raw);
    if (!Number.isFinite(typed)) return fallback;
    return Math.min(100, Math.max(0, Math.round(typed)));
  }

  function bindVolumeNumberInput(sliderEl, numEl, onApply) {
    const commit = () => {
      if (sliderEl.disabled || numEl.disabled) return;
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

  // ──── Time Signature Picker (TS_NUMS/TS_DENS in ./config.js) ────

  function setTimeSig(nextNum, nextDen) {
    tsNum = TS_NUMS.includes(nextNum) ? nextNum : 4;
    tsDen = TS_DENS.includes(nextDen) ? nextDen : 4;
    beatsPerMeasure = tsNum;
    syncBeatStatesForMeasure();
    tsNumValEl.textContent = tsNum;
    tsDenValEl.textContent = tsDen;
    buildBeatDots();
    updateDenominatorAwareVolumeUi();
    updateBeatIndicators(running ? 0 : null);
    if (running) _bgPlayback.refreshNow();
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
  updateSliderFill(bpmSlider, BPM_MIN, BPM_MAX);
  updateVolSlider(volMasterEl,    volMasterNum);
  updateVolSlider(volBeat1El,     volBeat1Num);
  updateVolSlider(volQuarterEl,   volQuarterNum);
  updateVolSlider(volEighthEl,    volEighthNum);
  updateVolSlider(volSixteenthEl, volSixteenthNum);
  updateDenominatorAwareVolumeUi();

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
    langJaBtn.classList.toggle('active', i18n.lang === 'ja');
    langEnBtn.classList.toggle('active', i18n.lang === 'en');
    wakelockOnBtn.classList.toggle('active', wakeLockEnabled);
    wakelockOffBtn.classList.toggle('active', !wakeLockEnabled);
  }

  function closeSettings() {
    settingsOverlay.hidden = true;
  }

  function setLang(lang) {
    i18n.setLang(lang);
    langJaBtn.classList.toggle('active', lang === 'ja');
    langEnBtn.classList.toggle('active', lang === 'en');
    applyI18n();
  }

  function setWakeLock(enabled) {
    wakeLockEnabled = enabled;
    try { localStorage.setItem(LS_KEYS.wakelock, enabled ? '1' : '0'); } catch {}
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
  const _ballAnimator = createBallAnimator({
    canvasSelector: '.ball-canvas',
    getState: () => ({ running, bpm, beatsPerMeasure, animMode, squashEnabled }),
    getAudioCtx: () => audioCtx,
    getScheduledBeatTimes: () => _scheduler.getScheduledBeatTimes(),
    isNative: () => isNative,
    getNativeLoopAnchorMs: () => nativeLoopAnchorMs,
    getBeatIndicatorState,
    onNativeBeat: (idx) => updateBeatIndicators(idx),
    onIdle: () => updateBeatIndicators(),
  });
  const refreshBallCanvases = () => _ballAnimator.refresh();
  const resizeBallCanvases = () => _ballAnimator.resize();

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

  _ballAnimator.start();

  // ──── iOS Background Playback ────
  // Foreground: WebAudio scheduler only.
  // Background: HTMLAudio click loop (Safari keeps this alive more reliably);
  // on native iOS, hand the same WAV to the MetronomeAudio plugin.
  // See src/audio/bg-playback.js for the full lifecycle.
  const _bgLoopBuilder = createBgLoopBuilder({
    getCtx: () => audioCtx,
    isNative: () => isNative,
  });
  const _bgPlayback = createBgPlayback({
    isNative,
    nativePlugin: NativeMetronomeAudio,
    bgLoopBuilder: _bgLoopBuilder,
    arrayBufferToBase64,
    getQuarterBeatSound,
    getRunning: () => running,
    getMuted: () => isMuted,
    getLoopParams: () => ({
      bpm, beatsPerMeasure, tsDen, beatStates,
      masterVol, volBeat1, volQuarter, volEighth, volSixteenth,
    }),
    getMeasureMs: () => (60000 / bpm) * beatsPerMeasure,
    onNativeStart: () => {
      nativeLoopAnchorMs = performance.now();
      updateBeatIndicators(0);
    },
  });

  function resumeForegroundScheduler() {
    if (!running || !audioCtx || document.hidden) return;
    if (isNative) {
      void _bgPlayback.syncNativeState();
    } else {
      _bgPlayback.syncMuted();
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
      _scheduler.stop();
      if (isNative) {
        audioCtx.suspend().catch(() => {});
        void _bgPlayback.awaitNativePrepare()
          .then(() => _bgPlayback.syncNativeState());
      } else {
        _bgPlayback.cancelDeferredRefresh();
        void _bgPlayback.refreshAndResume();
        _bgPlayback.syncMuted();
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
  let setlists      = safeParseJSON(LS_KEYS.setlists, []);
  let currentSlId   = null;   // setlist shown in detail view
  let activeSongId  = null;   // song currently applied to metronome
  let activeSlId    = null;   // setlist that owns the active song
  let editingSlId   = null;   // setlist being edited (index form)
  let editingSongId = null;   // song being edited (detail form)
  let songLibrary   = safeParseJSON(LS_KEYS.songLib, []);
  let activeLibSongId = null; // song currently selected from library tab
  let libSortMode   = 'manual'; // 'manual' | 'name' | 'bpm'
  let editingLibId  = null;
  let libFormBeatVolumes = null;
  let libFormBeatStates = null;
  let pfFormBeatVolumes = null;
  let pfFormBeatStates = null;

  function saveSetlists() {
    writeJSON(LS_KEYS.setlists, setlists);
  }

  // (escHtml moved to ./utils/dom.js)

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
      setlists.push({ id: nextId(), name, songs: [] });
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
    renderSongRows({
      listEl: songList,
      items: sl.songs,
      activeId: activeSongId,
      emptyText: t('empty.noSongs'),
      untitledText: t('untitled'),
      editTitle: t('action.edit'),
      deleteTitle: t('action.delete'),
      showTrackNumber: true,
      showDragHandle: true,
      editAction: 'edit',
      deleteAction: 'del',
      onApply: applySong,
      onEdit: openEditSongForm,
      onDelete: deleteSong,
    });
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
    updateCapturePreview('pf', pfFormBeatVolumes, null, p.tsDen ?? 4);
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
    const bpmVal = Math.min(BPM_MAX, Math.max(BPM_MIN, parseInt(pfBpm.value) || bpm));
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
        id: nextId(),
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
    if (setlists.length >= FREE_SETLIST_LIMIT && !isPro) {
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
    if (currentSongs.length >= FREE_SONGS_PER_SETLIST && !isPro) {
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
      updateCapturePreview('pf', pfFormBeatVolumes, bpm, tsDen);
    });
  });

  // ── Generic DnD factory (moved to ./ui/dnd.js) ──

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
        id: nextId(),
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
  function saveSongLib() { writeJSON(LS_KEYS.songLib, songLibrary); }

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
    renderSongRows({
      listEl: libSongList,
      items: getLibrarySongsForDisplay(),
      activeId: activeLibSongId,
      emptyText: t('empty.noSongs'),
      editTitle: t('action.edit'),
      deleteTitle: t('action.delete'),
      showTrackNumber: false,
      showDragHandle: libSortMode === 'manual',
      editAction: 'edit-lib',
      deleteAction: 'del-lib',
      onApply: applyLibrarySong,
      onEdit: openEditLibForm,
      onDelete: deleteLibSong,
    });
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
    updateCapturePreview('lib', libFormBeatVolumes, null, s.tsDen ?? 4);
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
    const bpmVal = Math.min(BPM_MAX, Math.max(BPM_MIN, parseInt(libBpmInput.value) || bpm));
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
        id: nextId(),
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
    if (songLibrary.length >= FREE_LIBRARY_LIMIT && !isPro) {
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
      updateCapturePreview('lib', libFormBeatVolumes, bpm, tsDen);
    });
  });

  // ── Init ──
  showSlIndex();
  updateNowPlaying();
  renderLibrary();

  // ──── Swipe Panel (5-slot clone carousel) ────
  createSwipePanel({
    pagesEl: swipePagesEl,
    dotEls: pageDotEls,
    totalPages: SWIPE_TOTAL_PAGES,
    slotStep: SWIPE_SLOT_STEP,
    thresholdPx: SWIPE_THRESHOLD_PX,
    // Clones duplicate the metronome page (which contains a `.ball-canvas`)
    // and the volume section, so re-scan after they're inserted into the DOM.
    onAfterClonesInserted: () => {
      refreshBallCanvases();
      resizeBallCanvases();
      syncVolumeSectionHeight();
    },
    // The metronome page (logical page 0) hosts the canvas-based ball
    // animation. When it becomes visible again, re-measure the canvas.
    onPageEnter: (page) => { if (page === 0) resizeBallCanvases(); },
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
      try { localStorage.setItem(LS_KEYS.devForcePro, isPro ? '1' : '0'); } catch {}
      update();
      renderLibrary();
      renderSetlists();
    });
    document.body.appendChild(devBtn);
  }

  applyI18n();

  // バックグラウンドループ WAV をアプリ起動時に事前ビルドしておく
  // OfflineAudioContext は AudioContext 不要なのでユーザー操作前でも実行できる
  void _bgPlayback.warmUp();

})();

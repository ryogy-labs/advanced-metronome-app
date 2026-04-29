import { registerPlugin } from '@capacitor/core';
import {
  BPM_MIN, BPM_MAX, BPM_DEFAULT,
  TAP_RESET_MS,
  TS_NUMS, TS_DENS,
  SWING_MODES, SWING_DEFAULT_MODE, SWING_DEFAULT_AMOUNT, SWING_MIN, SWING_MAX,
  VISUAL_DELAY_DEFAULT_MS, VISUAL_DELAY_MIN_MS, VISUAL_DELAY_MAX_MS, VISUAL_DELAY_STEP_MS,
  CLICK_ACCENT, CLICK_QUARTER,
  LS_KEYS,
} from '../config.js';
import { createBgLoopBuilder, arrayBufferToBase64 } from '../audio/bg-loop.js';
import { createBgPlayback } from '../audio/bg-playback.js';
import { createScheduler } from '../audio/scheduler.js';
import {
  clampSwingAmount,
  findLastScheduledBeat,
  getLoopDurationMs,
  getNativeBeatPosition,
} from '../audio/timing.js';
import { createSettingsPanel } from '../ui/settings-panel.js';
import { createBeatDots } from '../ui/beat-dots.js';
import { createBpmControls } from '../ui/bpm-controls.js';
import { createTimeSignatureControls } from '../ui/time-signature-controls.js';
import { createVolumeLayout } from '../ui/volume-layout.js';
import { createBallAnimator } from '../ui/ball.js';
import {
  buildDefaultBeatStates,
  getNextBeatState,
  normalizeBeatStates,
} from '../state/beat-states.js';
import { withSongDefaults } from '../state/song-config.js';

const NativeMetronomeAudio = registerPlugin('MetronomeAudio');
const isNative = Boolean(
  window.Capacitor &&
  typeof window.Capacitor.isNativePlatform === 'function' &&
  window.Capacitor.isNativePlatform()
);

export function createMetronomeController({ i18n, t, onPlaybackStateChange, onI18nChange }) {
  let bpm = BPM_DEFAULT;
  let beatsPerMeasure = 4;
  let beatStates = ['accent', 'normal', 'normal', 'normal'];
  let tsNum = 4;
  let tsDen = 4;
  let masterVol = 1.0;
  let volBeat1 = 1.0;
  let volQuarter = 0.8;
  let volEighth = 0.5;
  let volSixteenth = 0.0;
  let swingMode = SWING_DEFAULT_MODE;
  let swingAmount = SWING_DEFAULT_AMOUNT;
  let running = false;
  let tapTimes = [];
  let isMuted = false;
  let audioCtx = null;
  let masterGainNode = null;
  let bpmControls = null;
  let playbackRefreshSeq = 0;
  let nativeLoopAnchorMs = 0;
  let squashEnabled = true;
  let animMode = 'vertical';
  let visualDelayMs = (() => {
    try {
      const stored = Number(localStorage.getItem(LS_KEYS.visualDelayMs));
      if (!Number.isFinite(stored)) return VISUAL_DELAY_DEFAULT_MS;
      return clampVisualDelayMs(stored);
    } catch {
      return VISUAL_DELAY_DEFAULT_MS;
    }
  })();
  let visualDelayCalibrationSamples = [];
  let visualDelayCalibrationText = '';
  let wakeLockEnabled = (() => {
    try { return localStorage.getItem(LS_KEYS.wakelock) !== '0'; } catch { return true; }
  })();
  let wakeLockSentinel = null;

  const bpmDisplay = document.getElementById('bpmDisplay');
  const bpmSlider = document.getElementById('bpmSlider');
  const beatRowEls = [
    document.getElementById('beatRow'),
    document.getElementById('beatRowSetlist'),
    document.getElementById('beatRowLibrary'),
  ].filter(Boolean);
  const muteBtnEls = [
    document.getElementById('muteBtnMetro'),
    document.getElementById('muteBtnSetlist'),
    document.getElementById('muteBtnLibrary'),
  ].filter(Boolean);
  const playBtn = document.getElementById('playBtn');
  const tapBtn = document.getElementById('tapBtn');
  const tsNumValEl = document.getElementById('tsNumVal');
  const tsDenValEl = document.getElementById('tsDenVal');
  const pageDotEls = document.querySelectorAll('.page-dot');
  const volMasterEl = document.getElementById('volMaster');
  const volMasterNum = document.getElementById('volMasterNum');
  const volBeat1El = document.getElementById('volBeat1');
  const volQuarterEl = document.getElementById('volQuarter');
  const volEighthEl = document.getElementById('volEighth');
  const volSixteenthEl = document.getElementById('volSixteenth');
  const volBeat1Num = document.getElementById('volBeat1Num');
  const volQuarterNum = document.getElementById('volQuarterNum');
  const volEighthNum = document.getElementById('volEighthNum');
  const volSixteenthNum = document.getElementById('volSixteenthNum');
  const swingAmountEl = document.getElementById('swingAmount');
  const swingAmountNum = document.getElementById('swingAmountNum');
  const swingModeBtns = Array.from(document.querySelectorAll('[data-swing-mode]'));
  const swingPresetBtns = Array.from(document.querySelectorAll('[data-swing-preset]'));
  const denominatorAwareVolumeEls = [
    { labelKey: 'volume.quarter', slider: volQuarterEl, num: volQuarterNum },
    { labelKey: 'volume.eighth', slider: volEighthEl, num: volEighthNum },
    { labelKey: 'volume.sixteenth', slider: volSixteenthEl, num: volSixteenthNum },
  ];

  (function iosAudioUnlock() {
    const unlock = () => {
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      document.removeEventListener('touchstart', unlock, true);
      document.removeEventListener('touchend', unlock, true);
      document.removeEventListener('click', unlock, true);
    };
    document.addEventListener('touchstart', unlock, { capture: true, passive: true });
    document.addEventListener('touchend', unlock, { capture: true, passive: true });
    document.addEventListener('click', unlock, { capture: true, passive: true });
  })();

  async function acquireWakeLock() {
    if (!wakeLockEnabled || !('wakeLock' in navigator)) return;
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
    } catch (e) {
      console.warn('[WakeLock] acquire failed:', e);
    }
  }

  function releaseWakeLock() {
    if (!wakeLockSentinel) return;
    wakeLockSentinel.release().catch(() => {});
    wakeLockSentinel = null;
  }

  function getBeatIndicatorState(beatIdx) {
    return beatStates[beatIdx] ?? 'normal';
  }

  function syncBeatStatesForMeasure() {
    beatStates = buildDefaultBeatStates(beatsPerMeasure, tsDen);
  }

  function getQuarterBeatSound(beatIdx) {
    const state = getBeatIndicatorState(beatIdx);
    if (state === 'mute') return null;
    if (state === 'accent') {
      return { volume: volBeat1 * masterVol, freq: CLICK_ACCENT.freq, dur: CLICK_ACCENT.dur };
    }
    return { volume: volQuarter * masterVol, freq: CLICK_QUARTER.freq, dur: CLICK_QUARTER.dur };
  }

  function getEffectiveSixteenthVolume() {
    return swingMode === 'eighth' ? 0 : volSixteenth;
  }

  function getCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGainNode = audioCtx.createGain();
      masterGainNode.gain.value = isMuted ? 0 : 1;
      masterGainNode.connect(audioCtx.destination);
    }
    return audioCtx;
  }

  const scheduler = createScheduler({
    getCtx,
    getDestination: () => masterGainNode,
    isNative: () => isNative,
    getState: () => ({
      bpm,
      beatsPerMeasure,
      tsDen,
      masterVol,
      volEighth,
      volSixteenth: getEffectiveSixteenthVolume(),
      swingMode,
      swingAmount,
    }),
    getQuarterBeatSound,
    onBeatFlash: flashBeat,
    getVisualDelayMs: () => visualDelayMs,
  });

  function getCurrentBeatIndicatorIndex() {
    if (!running) return null;
    if (isNative && nativeLoopAnchorMs > 0) {
      return getNativeBeatPosition({
        nowMs: performance.now(),
        anchorMs: nativeLoopAnchorMs,
        bpm,
        beatsPerMeasure,
        tsDen,
        swingMode,
        swingAmount,
      }).beatIdx;
    }
    if (!audioCtx) return null;
    return findLastScheduledBeat({
      scheduledBeatTimes: scheduler.getScheduledBeatTimes(),
      nowSec: audioCtx.currentTime,
    })?.beatIdx ?? null;
  }

  function cycleBeatState(beatIdx) {
    beatStates[beatIdx] = getNextBeatState(getBeatIndicatorState(beatIdx));
    buildBeatDots();
    updateBeatIndicators(getCurrentBeatIndicatorIndex());
    if (running) refreshRunningLoopOnly();
  }

  const beatDots = createBeatDots({
    rowEls: beatRowEls,
    onCycleBeatState: cycleBeatState,
  });

  function buildBeatDots() {
    beatDots.render({ count: beatsPerMeasure, getBeatState: getBeatIndicatorState });
  }

  function updateBeatIndicators(beatIdx = null) {
    beatDots.update(beatIdx, getBeatIndicatorState);
  }

  function flashBeat(beatIdx, scheduledTime) {
    if (document.hidden) return;
    if (audioCtx && typeof scheduledTime === 'number' &&
        Math.abs((audioCtx.currentTime - visualDelayMs / 1000) - scheduledTime) > 0.5) return;
    updateBeatIndicators(beatIdx);
  }

  async function isContextClockAdvancing(ctx) {
    const before = ctx.currentTime;
    await new Promise(resolve => setTimeout(resolve, 60));
    return ctx.currentTime > before + 0.001;
  }

  async function recreateSchedulerContext() {
    if (audioCtx) {
      try { await audioCtx.close(); } catch {}
    }
    audioCtx = null;
    masterGainNode = null;
    const ctx = getCtx();
    try { await ctx.resume(); } catch {}
    return ctx;
  }

  function startSchedulerFromNow() {
    scheduler.start();
    updateBeatIndicators(0);
  }

  async function ensureSchedulerContextRunning() {
    let ctx = getCtx();
    if (ctx.state === 'running' && await isContextClockAdvancing(ctx)) return true;
    for (let attempt = 0; attempt < 6; attempt++) {
      try { await ctx.resume(); } catch {}
      if (ctx.state === 'running' && await isContextClockAdvancing(ctx)) return true;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!isNative) return false;
    ctx = await recreateSchedulerContext();
    return isContextClockAdvancing(ctx);
  }

  const bgLoopBuilder = createBgLoopBuilder({
    getCtx: () => audioCtx,
    isNative: () => isNative,
  });
  const bgPlayback = createBgPlayback({
    isNative,
    nativePlugin: NativeMetronomeAudio,
    bgLoopBuilder,
    arrayBufferToBase64,
    getQuarterBeatSound,
    getRunning: () => running,
    getMuted: () => isMuted,
    getLoopParams: () => ({
      bpm, beatsPerMeasure, tsDen, beatStates,
      masterVol, volBeat1, volQuarter, volEighth, volSixteenth: getEffectiveSixteenthVolume(),
      swingMode, swingAmount,
    }),
    getMeasureMs: () => getLoopDurationMs({ bpm, beatsPerMeasure }),
    onNativeStart: () => {
      nativeLoopAnchorMs = performance.now();
      updateBeatIndicators(0);
    },
  });

  function startMetronome() {
    if (running) return;
    const boot = () => {
      running = true;
      startSchedulerFromNow();
      bgPlayback.start();
      playBtn.textContent = t('metro.stop');
      playBtn.classList.add('running');
      void acquireWakeLock();
      onPlaybackStateChange?.(running);
    };
    void ensureSchedulerContextRunning().then(boot);
  }

  function stopMetronome() {
    if (!running) return;
    running = false;
    scheduler.stop();
    nativeLoopAnchorMs = 0;
    bgPlayback.stop();
    playBtn.textContent = t('metro.start');
    playBtn.classList.remove('running');
    releaseWakeLock();
    updateBeatIndicators();
    onPlaybackStateChange?.(running);
  }

  function togglePlayback() {
    if (running) stopMetronome();
    else startMetronome();
  }

  function setMute(m) {
    isMuted = m;
    if (masterGainNode && audioCtx) {
      masterGainNode.gain.setTargetAtTime(m ? 0 : 1, audioCtx.currentTime, 0.015);
    }
    if (isNative && running) {
      void bgPlayback.awaitNativePrepare().then(() => bgPlayback.syncNativeState());
    }
    bgPlayback.syncMuted();
    muteBtnEls.forEach(btn => {
      btn.classList.toggle('muted', m);
      btn.textContent = m ? '🔇' : '🔊';
    });
  }

  function refreshRunningPlayback({ realignVisuals = false } = {}) {
    if (!running) return;
    const refreshSeq = ++playbackRefreshSeq;
    if (!isNative) {
      if (realignVisuals) startSchedulerFromNow();
      bgPlayback.refreshWhenSafe();
      return;
    }
    void bgPlayback.refreshNow().then(() => {
      if (!running || refreshSeq !== playbackRefreshSeq) return;
      if (realignVisuals) {
        nativeLoopAnchorMs = performance.now();
        updateBeatIndicators(0);
      }
    });
  }

  function refreshRunningLoopOnly() {
    refreshRunningPlayback({ realignVisuals: isNative });
  }

  function setSwingMode(mode) {
    swingMode = SWING_MODES.includes(mode) ? mode : SWING_DEFAULT_MODE;
    syncSwingUi();
    updateDenominatorAwareVolumeUi();
    refreshRunningPlayback({ realignVisuals: true });
  }

  function setSwingAmount(amount) {
    swingAmount = clampSwingAmount(amount);
    syncSwingUi();
    refreshRunningPlayback({ realignVisuals: true });
  }

  function clampVisualDelayMs(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return VISUAL_DELAY_DEFAULT_MS;
    const stepped = Math.round(next / VISUAL_DELAY_STEP_MS) * VISUAL_DELAY_STEP_MS;
    return Math.min(VISUAL_DELAY_MAX_MS, Math.max(VISUAL_DELAY_MIN_MS, stepped));
  }

  function setVisualDelayMs(value) {
    visualDelayMs = clampVisualDelayMs(value);
    try { localStorage.setItem(LS_KEYS.visualDelayMs, String(visualDelayMs)); } catch {}
  }

  function getAudioContextTimeForNow() {
    if (!audioCtx) return null;
    if (typeof audioCtx.getOutputTimestamp === 'function') {
      const timestamp = audioCtx.getOutputTimestamp();
      if (Number.isFinite(timestamp.contextTime) && Number.isFinite(timestamp.performanceTime)) {
        return timestamp.contextTime + (performance.now() - timestamp.performanceTime) / 1000;
      }
    }
    return audioCtx.currentTime;
  }

  function getPreviousScheduledBeatTime(nowSec) {
    const beats = scheduler.getScheduledBeatTimes();
    for (let i = beats.length - 1; i >= 0; i--) {
      if (beats[i].time <= nowSec) return beats[i].time;
    }
    return null;
  }

  function setVisualDelayCalibrationText(text) {
    visualDelayCalibrationText = text;
    return visualDelayCalibrationText;
  }

  function getVisualDelayCalibrationHint() {
    if (visualDelayCalibrationText) return visualDelayCalibrationText;
    return t('settings.visualDelayCalibrateHint');
  }

  function calibrateVisualDelayTap() {
    if (!running) {
      visualDelayCalibrationSamples = [];
      startMetronome();
      return setVisualDelayCalibrationText(
        i18n.lang === 'ja'
          ? '再生を開始しました。音が聞こえたら3回タップしてください'
          : 'Started playback. Tap 3 times when you hear the sound'
      );
    }

    const nowSec = getAudioContextTimeForNow();
    if (nowSec == null) {
      return setVisualDelayCalibrationText(
        i18n.lang === 'ja'
          ? '音声クロックの取得に失敗しました'
          : 'Could not read the audio clock'
      );
    }

    const previousBeatTime = getPreviousScheduledBeatTime(nowSec);
    if (previousBeatTime == null) {
      return setVisualDelayCalibrationText(
        i18n.lang === 'ja'
          ? '拍を検出中です。もう一度タップしてください'
          : 'Finding the beat. Tap again'
      );
    }

    const sampleMs = (nowSec - previousBeatTime) * 1000;
    if (!Number.isFinite(sampleMs) || sampleMs < 0) {
      return setVisualDelayCalibrationText(
        i18n.lang === 'ja'
          ? 'うまく読めませんでした。もう一度タップしてください'
          : 'Could not read that tap. Try again'
      );
    }

    visualDelayCalibrationSamples.push(sampleMs);
    if (visualDelayCalibrationSamples.length < 3) {
      return setVisualDelayCalibrationText(
        i18n.lang === 'ja'
          ? `${visualDelayCalibrationSamples.length}/3 タップ`
          : `${visualDelayCalibrationSamples.length}/3 taps`
      );
    }

    const sorted = [...visualDelayCalibrationSamples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    setVisualDelayMs(median);
    visualDelayCalibrationSamples = [];
    return setVisualDelayCalibrationText(
      i18n.lang === 'ja'
        ? `${visualDelayMs}ms に設定しました`
        : `Set to ${visualDelayMs} ms`
    );
  }

  function syncSwingUi() {
    const amountDisabled = swingMode === 'off';
    swingModeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.swingMode === swingMode);
    });
    if (swingAmountEl) {
      swingAmountEl.disabled = amountDisabled;
      swingAmountEl.value = swingAmount.toFixed(1);
      const pct = ((swingAmount - SWING_MIN) / (SWING_MAX - SWING_MIN)) * 100;
      swingAmountEl.style.setProperty('--pct', `${pct}%`);
    }
    if (swingAmountNum) {
      swingAmountNum.disabled = amountDisabled;
      swingAmountNum.value = swingAmount.toFixed(1);
    }
    swingPresetBtns.forEach(btn => {
      const preset = Number(btn.dataset.swingPreset);
      const isActive = Math.abs(swingAmount - preset) <= 0.05;
      btn.disabled = amountDisabled;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function setBPM(val) {
    bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(val)));
    bpmControls?.sync(bpm);
    refreshRunningPlayback({ realignVisuals: true });
  }

  function updateSliderFill(slider, min, max) {
    const pct = ((slider.value - min) / (max - min)) * 100;
    slider.style.setProperty('--pct', `${pct}%`);
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
    const muteFinestForSwing = swingMode === 'eighth';
    denominatorAwareVolumeEls.forEach(({ labelKey, slider, num }) => {
      const isFinest = labelKey === 'volume.sixteenth';
      const disabled = isFinest && (disableFinest || muteFinestForSwing);
      const row = slider?.closest('.vol-row');
      if (slider) slider.disabled = disabled;
      if (num) num.disabled = disabled;
      if (isFinest && slider && num) {
        if (muteFinestForSwing) {
          slider.value = '0';
          num.value = '0';
          updateSliderFill(slider, 0, 100);
        } else {
          slider.value = String(Math.round(volSixteenth * 100));
          updateVolSlider(slider, num);
        }
      }
      row?.classList.toggle('is-disabled', disabled);
      row?.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    });
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

  function currentSwing() {
    return { swingMode, swingAmount };
  }

  function applyBeatVolumes(bv) {
    if (!bv) return;
    masterVol = bv.master ?? 1.0;
    volBeat1 = bv.beat1 ?? 1.0;
    volQuarter = bv.quarter ?? 0.8;
    volEighth = bv.eighth ?? 0.5;
    volSixteenth = bv.sixteenth ?? 0.0;
    syncVolumeBindings();
    updateDenominatorAwareVolumeUi();
    refreshRunningLoopOnly();
  }

  function applyBeatStates(states, { refreshLoop = true } = {}) {
    beatStates = normalizeBeatStates(states, beatsPerMeasure, tsDen);
    buildBeatDots();
    updateBeatIndicators(getCurrentBeatIndicatorIndex());
    if (refreshLoop) refreshRunningLoopOnly();
  }

  function applySongConfig(songCfg) {
    const next = withSongDefaults(songCfg);
    setBPM(next.bpm);
    setTimeSig(next.tsNum, next.tsDen);
    setSwingMode(next.swingMode);
    setSwingAmount(next.swingAmount);
    applyBeatStates(next.beatStates, { refreshLoop: false });
    applyBeatVolumes(next.beatVolumes);
  }

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
    if (running) bgPlayback.refreshNow();
    if (running) { stopMetronome(); startMetronome(); }
  }

  function parseVolumeInput(inputEl, fallback) {
    const typed = Number(String(inputEl.value || '').trim());
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

  function getVolumeBindings() {
    return [
      { slider: volMasterEl, num: volMasterNum, get: () => masterVol, set: v => { masterVol = v; } },
      { slider: volBeat1El, num: volBeat1Num, get: () => volBeat1, set: v => { volBeat1 = v; } },
      { slider: volQuarterEl, num: volQuarterNum, get: () => volQuarter, set: v => { volQuarter = v; } },
      { slider: volEighthEl, num: volEighthNum, get: () => volEighth, set: v => { volEighth = v; } },
      { slider: volSixteenthEl, num: volSixteenthNum, get: () => volSixteenth, set: v => { volSixteenth = v; } },
    ];
  }

  function syncVolumeBindings() {
    getVolumeBindings().forEach(({ slider, num, get }) => {
      slider.value = Math.round(get() * 100);
      updateVolSlider(slider, num);
    });
  }

  function tapTempo() {
    const now = performance.now();
    tapTimes = tapTimes.filter(t => now - t < TAP_RESET_MS);
    tapTimes.push(now);
    if (tapTimes.length < 2) return;
    let total = 0;
    for (let i = 1; i < tapTimes.length; i++) total += tapTimes[i] - tapTimes[i - 1];
    if (total <= 0) return;
    setBPM(60000 / (total / (tapTimes.length - 1)));
  }

  function resumeForegroundScheduler() {
    if (!running || !audioCtx || document.hidden) return;
    if (isNative) {
      void bgPlayback.syncNativeState();
    } else {
      bgPlayback.syncMuted();
    }
    void ensureSchedulerContextRunning().then(isRunning => {
      if (running && isRunning) startSchedulerFromNow();
    });
  }

  function applyI18n() {
    playBtn.textContent = running ? t('metro.stop') : t('metro.start');
    tapBtn.replaceChildren(...t('metro.tap').split('\n').flatMap((part, idx) => {
      const nodes = [];
      if (idx > 0) nodes.push(document.createElement('br'));
      nodes.push(document.createTextNode(part));
      return nodes;
    }));
    ['page.ball', 'page.volume', 'page.swing', 'page.timesig'].forEach((key, idx) => {
      pageDotEls[idx]?.setAttribute('aria-label', t(key));
    });
    updateDenominatorAwareVolumeUi();
    syncSwingUi();
    if (!visualDelayCalibrationText) {
      visualDelayCalibrationText = t('settings.visualDelayCalibrateHint');
    }
  }

  bpmControls = createBpmControls({
    slider: bpmSlider,
    display: bpmDisplay,
    buttons: {
      minus10: document.getElementById('bpmMinus10'),
      minus5: document.getElementById('bpmMinus5'),
      minus1: document.getElementById('bpmMinus1'),
      plus1: document.getElementById('bpmPlus1'),
      plus5: document.getElementById('bpmPlus5'),
      plus10: document.getElementById('bpmPlus10'),
    },
    min: BPM_MIN,
    max: BPM_MAX,
    getBpm: () => bpm,
    setBpm: setBPM,
  });

  createTimeSignatureControls({
    buttons: {
      numUp: document.getElementById('tsNumUp'),
      numDown: document.getElementById('tsNumDn'),
      denUp: document.getElementById('tsDenUp'),
      denDown: document.getElementById('tsDenDn'),
    },
    nums: TS_NUMS,
    dens: TS_DENS,
    getValue: () => ({ num: tsNum, den: tsDen }),
    setValue: setTimeSig,
  });

  getVolumeBindings().forEach(({ slider, num, set }) => {
    slider.addEventListener('input', () => {
      set(slider.value / 100);
      updateVolSlider(slider, num);
      refreshRunningLoopOnly();
    });
    bindVolumeNumberInput(slider, num, set);
  });
  swingModeBtns.forEach(btn => {
    btn.addEventListener('click', () => setSwingMode(btn.dataset.swingMode));
  });
  swingAmountEl?.addEventListener('input', () => setSwingAmount(Number(swingAmountEl.value)));
  swingAmountNum?.addEventListener('change', () => setSwingAmount(Number(swingAmountNum.value)));
  swingAmountNum?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setSwingAmount(Number(swingAmountNum.value));
      swingAmountNum.blur();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      syncSwingUi();
      swingAmountNum.blur();
    }
  });
  swingPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => setSwingAmount(Number(btn.dataset.swingPreset)));
  });

  playBtn.addEventListener('click', togglePlayback);
  tapBtn.addEventListener('click', tapTempo);
  muteBtnEls.forEach(btn => btn.addEventListener('click', () => setMute(!isMuted)));
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.isContentEditable) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlayback(); }
    if (e.code === 'KeyT') tapTempo();
    if (e.code === 'KeyM') setMute(!isMuted);
  });

  updateSliderFill(bpmSlider, BPM_MIN, BPM_MAX);
  syncVolumeBindings();
  syncSwingUi();
  updateDenominatorAwareVolumeUi();
  buildBeatDots();
  updateBeatIndicators();

  createSettingsPanel({
    els: {
      overlay: document.getElementById('settingsOverlay'),
      openBtns: document.querySelectorAll('.settings-btn'),
      closeBtn: document.getElementById('settingsClose'),
      langJaBtn: document.getElementById('langJa'),
      langEnBtn: document.getElementById('langEn'),
      wakelockOnBtn: document.getElementById('wakelockOnBtn'),
      wakelockOffBtn: document.getElementById('wakelockOffBtn'),
      visualDelaySlider: document.getElementById('visualDelaySlider'),
      visualDelayNum: document.getElementById('visualDelayNum'),
      visualDelayCalibrateBtn: document.getElementById('visualDelayCalibrateBtn'),
      visualDelayCalibrateStatus: document.getElementById('visualDelayCalibrateStatus'),
      modeVerticalBtn: document.getElementById('modeVertical'),
      modeHorizontalBtn: document.getElementById('modeHorizontal'),
      squashOnBtn: document.getElementById('squashOnBtn'),
      squashOffBtn: document.getElementById('squashOffBtn'),
    },
    getLang: () => i18n.lang,
    setLang: (lang) => {
      i18n.setLang(lang);
      onI18nChange?.();
    },
    getWakeLockEnabled: () => wakeLockEnabled,
    setWakeLockEnabled: (enabled) => {
      wakeLockEnabled = enabled;
      try { localStorage.setItem(LS_KEYS.wakelock, enabled ? '1' : '0'); } catch {}
      if (!enabled) releaseWakeLock();
      else if (running) void acquireWakeLock();
    },
    getVisualDelayMs: () => visualDelayMs,
    setVisualDelayMs,
    onVisualDelayCalibrateTap: calibrateVisualDelayTap,
    getVisualDelayCalibrationHint,
    visualDelayRange: { min: VISUAL_DELAY_MIN_MS, max: VISUAL_DELAY_MAX_MS },
    getMode: () => animMode,
    setMode: (mode) => { animMode = mode; },
    getSquashEnabled: () => squashEnabled,
    setSquashEnabled: (enabled) => { squashEnabled = enabled; },
  });

  const ballAnimator = createBallAnimator({
    canvasSelector: '.ball-canvas',
    getState: () => ({ running, bpm, beatsPerMeasure, tsDen, swingMode, swingAmount, animMode, squashEnabled }),
    getAudioCtx: () => audioCtx,
    getScheduledBeatTimes: () => scheduler.getScheduledBeatTimes(),
    isNative: () => isNative,
    getNativeLoopAnchorMs: () => nativeLoopAnchorMs,
    getBeatIndicatorState,
    getVisualDelayMs: () => visualDelayMs,
    onNativeBeat: (idx) => updateBeatIndicators(idx),
    onIdle: () => updateBeatIndicators(),
  });
  const refreshBallCanvases = () => ballAnimator.refresh();
  const resizeBallCanvases = () => ballAnimator.resize();
  const volumeLayout = createVolumeLayout({
    getTsCards: () => Array.from(document.querySelectorAll('.ts-picker-wrap')),
    getVolumeSections: () => Array.from(document.querySelectorAll('.vol-section')),
  });
  const syncVolumeSectionHeight = () => volumeLayout.syncHeight();

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
  ballAnimator.start();

  document.addEventListener('visibilitychange', () => {
    if (!running || !audioCtx) return;
    if (document.hidden) {
      scheduler.stop();
      if (isNative) {
        audioCtx.suspend().catch(() => {});
        void bgPlayback.awaitNativePrepare().then(() => bgPlayback.syncNativeState());
      } else {
        bgPlayback.cancelDeferredRefresh();
        void bgPlayback.refreshAndResume();
        bgPlayback.syncMuted();
      }
    } else {
      resumeForegroundScheduler();
      if (wakeLockEnabled) void acquireWakeLock();
    }
  });
  window.addEventListener('focus', resumeForegroundScheduler);
  window.addEventListener('pageshow', resumeForegroundScheduler);

  return {
    isNativeApp: isNative,
    get bpm() { return bpm; },
    get tsNum() { return tsNum; },
    get tsDen() { return tsDen; },
    get swingMode() { return swingMode; },
    get swingAmount() { return swingAmount; },
    get running() { return running; },
    startMetronome,
    stopMetronome,
    togglePlayback,
    applySongConfig,
    currentBeatVolumes,
    currentBeatStates,
    currentSwing,
    getSubdivisionVolumeLabels,
    refreshBallCanvases,
    resizeBallCanvases,
    syncVolumeSectionHeight,
    applyI18n,
    warmUp: () => bgPlayback.warmUp(),
  };
}

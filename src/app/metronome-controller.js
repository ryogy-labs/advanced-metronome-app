// @ts-check

import { BPM_MIN, BPM_MAX, BPM_DEFAULT, TAP_RESET_MS, TS_NUMS, TS_DENS, SWING_DEFAULT_MODE } from '../config.js';
import { findLastScheduledBeat, getNativeBeatPosition } from '../audio/timing.js';
import { createBeatDots } from '../ui/beat-dots.js';
import { buildDefaultBeatStates, getNextBeatState, normalizeBeatStates } from '../state/beat-states.js';
import { withSongDefaults } from '../state/song-config.js';
import { createAudioRuntime } from './audio-runtime.js';
import { createVolumeController } from './volume-controller.js';
import { createSwingController } from './swing-controller.js';
import { createVisualDelayCalibration } from './visual-delay-calibration.js';
import { createMetronomeChrome } from './metronome-chrome.js';

/**
 * @typedef {import('../state/song-config.js').SongConfig} SongConfig
 * @typedef {import('../state/song-config.js').BeatVolumes} BeatVolumes
 * @typedef {import('../state/song-config.js').BeatState} BeatState
 */

export function createMetronomeController({ els, i18n, t, onPlaybackStateChange, onI18nChange }) {
  let bpm = BPM_DEFAULT;
  let beatsPerMeasure = 4;
  /** @type {BeatState[]} */
  let beatStates = ['accent', 'normal', 'normal', 'normal'];
  let tsNum = 4;
  let tsDen = 4;
  /** @type {number[]} */
  let tapTimes = [];
  let squashEnabled = true;
  let animMode = 'vertical';
  /** @type {any} */
  let chrome;
  /** @type {any} */
  let audioRuntime;
  /** @type {any} */
  let swingController;
  /** @type {any} */
  let visualDelay;

  function getState() {
    return {
      running: audioRuntime?.running ?? false,
      bpm,
      beatsPerMeasure,
      tsNum,
      tsDen,
      swingMode: swingController?.swingMode ?? SWING_DEFAULT_MODE,
      swingAmount: swingController?.swingAmount ?? 50,
      animMode,
      squashEnabled,
    };
  }

  function getBeatIndicatorState(beatIdx) {
    return beatStates[beatIdx] ?? 'normal';
  }

  function getCurrentBeatIndicatorIndex() {
    if (!audioRuntime?.running) return null;
    if (audioRuntime.isNative && audioRuntime.nativeLoopAnchorMs > 0) {
      return getNativeBeatPosition({
        nowMs: performance.now(),
        anchorMs: audioRuntime.nativeLoopAnchorMs,
        bpm,
        beatsPerMeasure,
        tsDen,
        swingMode: swingController.swingMode,
        swingAmount: swingController.swingAmount,
      }).beatIdx;
    }
    const audioCtx = audioRuntime.getAudioCtx();
    if (!audioCtx) return null;
    return findLastScheduledBeat({
      scheduledBeatTimes: audioRuntime.getScheduledBeatTimes(),
      nowSec: audioCtx.currentTime,
    })?.beatIdx ?? null;
  }

  function cycleBeatState(beatIdx) {
    beatStates[beatIdx] = getNextBeatState(getBeatIndicatorState(beatIdx));
    buildBeatDots();
    updateBeatIndicators(getCurrentBeatIndicatorIndex());
    audioRuntime?.refreshRunningLoopOnly();
  }

  const beatDots = createBeatDots({
    rowEls: els.beatRowEls,
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
    const audioCtx = audioRuntime?.getAudioCtx();
    if (audioCtx && typeof scheduledTime === 'number' &&
        Math.abs((audioCtx.currentTime - visualDelay.getVisualDelayMs() / 1000) - scheduledTime) > 0.5) return;
    updateBeatIndicators(beatIdx);
  }

  function setBPM(val) {
    bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(val)));
    chrome?.bpmControls.sync(bpm);
    audioRuntime?.refreshRunningPlayback({ realignVisuals: true });
  }

  function setTimeSig(nextNum, nextDen) {
    tsNum = TS_NUMS.includes(nextNum) ? nextNum : 4;
    tsDen = TS_DENS.includes(nextDen) ? nextDen : 4;
    beatsPerMeasure = tsNum;
    beatStates = /** @type {BeatState[]} */ (buildDefaultBeatStates(beatsPerMeasure, tsDen));
    els.tsNumValEl.textContent = String(tsNum);
    els.tsDenValEl.textContent = String(tsDen);
    buildBeatDots();
    volumeController.updateDenominatorAwareVolumeUi();
    updateBeatIndicators(audioRuntime?.running ? 0 : null);
    if (audioRuntime?.running) {
      audioRuntime.stopMetronome();
      audioRuntime.startMetronome();
    }
  }

  /** @returns {BeatState[]} */
  function currentBeatStates() {
    return [...beatStates];
  }

  function applyBeatStates(states, { refreshLoop = true } = {}) {
    beatStates = /** @type {BeatState[]} */ (normalizeBeatStates(states, beatsPerMeasure, tsDen));
    buildBeatDots();
    updateBeatIndicators(getCurrentBeatIndicatorIndex());
    if (refreshLoop) audioRuntime?.refreshRunningLoopOnly();
  }

  /** @param {SongConfig} songCfg */
  function applySongConfig(songCfg) {
    const next = withSongDefaults(songCfg);
    setBPM(next.bpm);
    setTimeSig(next.tsNum, next.tsDen);
    swingController.setSwingMode(next.swingMode);
    swingController.setSwingAmount(next.swingAmount);
    applyBeatStates(next.beatStates, { refreshLoop: false });
    volumeController.applyBeatVolumes(next.beatVolumes);
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

  const volumeController = createVolumeController({
    els: els.volume,
    i18n,
    getTsDen: () => tsDen,
    getSwingMode: () => swingController?.swingMode ?? SWING_DEFAULT_MODE,
    getBeatIndicatorState,
    onChange: () => audioRuntime?.refreshRunningLoopOnly(),
  });

  swingController = createSwingController({
    els: els.swing,
    onChange: opts => audioRuntime?.refreshRunningPlayback(opts),
    onModeChange: () => volumeController.updateDenominatorAwareVolumeUi(),
  });

  audioRuntime = createAudioRuntime({
    t,
    els: { playBtn: els.playBtn, muteBtnEls: els.muteBtnEls },
    getSchedulerState: () => ({
      bpm,
      beatsPerMeasure,
      tsDen,
      ...volumeController.getState(),
      swingMode: swingController.swingMode,
      swingAmount: swingController.swingAmount,
    }),
    getLoopParams: () => ({
      bpm,
      beatsPerMeasure,
      tsDen,
      beatStates,
      ...volumeController.getState(),
      swingMode: swingController.swingMode,
      swingAmount: swingController.swingAmount,
    }),
    getQuarterBeatSound: volumeController.getQuarterBeatSound,
    getVisualDelayMs: () => visualDelay?.getVisualDelayMs() ?? 0,
    onBeatFlash: flashBeat,
    onVisualReset: updateBeatIndicators,
    onPlaybackStateChange,
  });

  visualDelay = createVisualDelayCalibration({
    t,
    getLang: () => i18n.lang,
    getRunning: () => audioRuntime.running,
    startMetronome: audioRuntime.startMetronome,
    getAudioContextTimeForNow: audioRuntime.getAudioContextTimeForNow,
    getScheduledBeatTimes: audioRuntime.getScheduledBeatTimes,
  });

  buildBeatDots();
  updateBeatIndicators();
  chrome = createMetronomeChrome({
    els,
    i18n,
    t,
    getState,
    actions: {
      setBpm: setBPM,
      setTimeSig,
      tapTempo,
      updateBeatIndicators,
      getBeatIndicatorState,
      setAnimMode: mode => { animMode = mode; },
      setSquashEnabled: enabled => { squashEnabled = enabled; },
      onI18nChange,
    },
    controllers: { audioRuntime, volumeController, swingController, visualDelay },
  });

  return {
    isNativeApp: audioRuntime.isNative,
    get bpm() { return bpm; },
    get tsNum() { return tsNum; },
    get tsDen() { return tsDen; },
    get swingMode() { return swingController.swingMode; },
    get swingAmount() { return swingController.swingAmount; },
    get running() { return audioRuntime.running; },
    startMetronome: audioRuntime.startMetronome,
    stopMetronome: audioRuntime.stopMetronome,
    togglePlayback: audioRuntime.togglePlayback,
    applySongConfig,
    currentBeatVolumes: volumeController.currentBeatVolumes,
    currentBeatStates,
    currentSwing: swingController.currentSwing,
    getSubdivisionVolumeLabels: volumeController.getSubdivisionVolumeLabels,
    refreshBallCanvases: chrome.refreshBallCanvases,
    resizeBallCanvases: chrome.resizeBallCanvases,
    syncVolumeSectionHeight: chrome.syncVolumeSectionHeight,
    applyI18n: chrome.applyI18n,
    warmUp: audioRuntime.warmUp,
  };
}

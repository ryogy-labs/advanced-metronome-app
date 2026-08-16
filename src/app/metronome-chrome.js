// @ts-check

import {
  BPM_MIN,
  BPM_MAX,
  TS_NUMS,
  TS_DENS,
  VISUAL_DELAY_MIN_MS,
  VISUAL_DELAY_MAX_MS,
} from '../config.js';
import { createSettingsPanel } from '../ui/settings-panel.js';
import { createBpmControls } from '../ui/bpm-controls.js';
import { createTimeSignatureControls } from '../ui/time-signature-controls.js';
import { createVolumeLayout } from '../ui/volume-layout.js';
import { createBallAnimator } from '../ui/ball.js';

/**
 * @param {{
 *   els: ReturnType<import('./metronome-elements.js').getMetronomeElements>,
 *   i18n: { lang: string, setLang: (lang: string) => void },
 *   t: (key: string) => string,
 *   getState: () => {
 *     running: boolean, bpm: number, beatsPerMeasure: number, tsDen: number,
 *     swingMode: string, swingAmount: number, animMode: string, squashEnabled: boolean,
 *     tsNum: number,
 *   },
 *   actions: {
 *     setBpm: (value: number) => void,
 *     setTimeSig: (num: number, den: number) => void,
 *     tapTempo: () => void,
 *     updateBeatIndicators: (idx?: number | null) => void,
 *     getBeatIndicatorState: (idx: number) => string,
 *     setAnimMode: (mode: string) => void,
 *     setSquashEnabled: (enabled: boolean) => void,
 *     onI18nChange?: () => void,
 *   },
 *   controllers: {
 *     audioRuntime: any,
 *     volumeController: any,
 *     swingController: any,
 *     visualDelay: any,
 *   },
 * }} deps
 */
export function createMetronomeChrome({
  els,
  i18n,
  t,
  getState,
  actions,
  controllers: { audioRuntime, volumeController, swingController, visualDelay },
}) {
  const bpmControls = createBpmControls({
    slider: els.bpm.slider,
    display: els.bpm.display,
    buttons: els.bpm.buttons,
    min: BPM_MIN,
    max: BPM_MAX,
    getBpm: () => getState().bpm,
    setBpm: actions.setBpm,
  });

  createTimeSignatureControls({
    buttons: els.timeSigButtons,
    nums: TS_NUMS,
    dens: TS_DENS,
    getValue: () => ({ num: getState().tsNum, den: getState().tsDen }),
    setValue: actions.setTimeSig,
  });

  els.playBtn.addEventListener('click', audioRuntime.togglePlayback);
  els.tapBtn.addEventListener('click', actions.tapTempo);
  els.muteBtnEls.forEach(btn => btn.addEventListener('click', audioRuntime.toggleMute));
  document.addEventListener('keydown', e => {
    const target = /** @type {HTMLElement | null} */ (e.target);
    if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.isContentEditable) return;
    if (e.code === 'Space') { e.preventDefault(); audioRuntime.togglePlayback(); }
    if (e.code === 'KeyT') actions.tapTempo();
    if (e.code === 'KeyM') audioRuntime.toggleMute();
  });

  function applyI18n() {
    audioRuntime.applyI18n();
    els.tapBtn.replaceChildren(...t('metro.tap').split('\n').flatMap((part, idx) => {
      const nodes = [];
      if (idx > 0) nodes.push(document.createElement('br'));
      nodes.push(document.createTextNode(part));
      return nodes;
    }));
    ['page.ball', 'page.volume', 'page.swing', 'page.timesig'].forEach((key, idx) => {
      els.pageDotEls[idx]?.setAttribute('aria-label', t(key));
    });
    volumeController.updateDenominatorAwareVolumeUi();
    swingController.syncSwingUi();
    visualDelay.applyI18n();
  }

  createSettingsPanel({
    els: els.settings,
    getLang: () => i18n.lang,
    setLang: lang => {
      i18n.setLang(lang);
      actions.onI18nChange?.();
    },
    getWakeLockEnabled: audioRuntime.getWakeLockEnabled,
    setWakeLockEnabled: audioRuntime.setWakeLockEnabled,
    getVisualDelayMs: visualDelay.getVisualDelayMs,
    setVisualDelayMs: visualDelay.setVisualDelayMs,
    onVisualDelayCalibrateTap: visualDelay.calibrateVisualDelayTap,
    onVisualDelayCalibrateStart: visualDelay.startCalibration,
    onVisualDelayCalibrateCancel: visualDelay.cancelCalibration,
    isCalibrating: visualDelay.isCalibrating,
    getVisualDelayCalibrationHint: visualDelay.getVisualDelayCalibrationHint,
    visualDelayRange: { min: VISUAL_DELAY_MIN_MS, max: VISUAL_DELAY_MAX_MS },
    getMode: () => getState().animMode,
    setMode: actions.setAnimMode,
    getSquashEnabled: () => getState().squashEnabled,
    setSquashEnabled: actions.setSquashEnabled,
  });

  const ballAnimator = createBallAnimator({
    canvasSelector: '.ball-canvas',
    getState,
    getAudioCtx: audioRuntime.getAudioCtx,
    getScheduledBeatTimes: audioRuntime.getScheduledBeatTimes,
    isNative: () => audioRuntime.isNative,
    getNativeLoopAnchorMs: () => audioRuntime.nativeLoopAnchorMs,
    getBeatIndicatorState: actions.getBeatIndicatorState,
    getVisualDelayMs: visualDelay.getVisualDelayMs,
    onNativeBeat: idx => actions.updateBeatIndicators(idx),
    onIdle: () => actions.updateBeatIndicators(),
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
  applyI18n();

  return { bpmControls, applyI18n, refreshBallCanvases, resizeBallCanvases, syncVolumeSectionHeight };
}

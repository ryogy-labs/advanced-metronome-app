// @ts-check

import { CLICK_ACCENT, CLICK_QUARTER } from '../config.js';

/**
 * @typedef {import('../state/song-config.js').BeatVolumes} BeatVolumes
 * @typedef {import('../state/song-config.js').BeatState} BeatState
 */

/**
 * @param {{
 *   els: {
 *     masterSlider: HTMLInputElement,
 *     masterNum: HTMLInputElement,
 *     beat1Slider: HTMLInputElement,
 *     beat1Num: HTMLInputElement,
 *     quarterSlider: HTMLInputElement,
 *     quarterNum: HTMLInputElement,
 *     eighthSlider: HTMLInputElement,
 *     eighthNum: HTMLInputElement,
 *     sixteenthSlider: HTMLInputElement,
 *     sixteenthNum: HTMLInputElement,
 *   },
 *   i18n: { lang: string },
 *   getTsDen: () => number,
 *   getSwingMode: () => string,
 *   getBeatIndicatorState: (beatIdx: number) => BeatState,
 *   onChange: () => void,
 * }} deps
 */
export function createVolumeController({
  els,
  i18n,
  getTsDen,
  getSwingMode,
  getBeatIndicatorState,
  onChange,
}) {
  let masterVol = 1.0;
  let volBeat1 = 1.0;
  let volQuarter = 0.8;
  let volEighth = 0.5;
  let volSixteenth = 0.0;

  const denominatorAwareVolumeEls = [
    { labelKey: 'volume.quarter', slider: els.quarterSlider, num: els.quarterNum },
    { labelKey: 'volume.eighth', slider: els.eighthSlider, num: els.eighthNum },
    { labelKey: 'volume.sixteenth', slider: els.sixteenthSlider, num: els.sixteenthNum },
  ];

  function getEffectiveSixteenthVolume() {
    return getSwingMode() === 'eighth' ? 0 : volSixteenth;
  }

  /** @param {number} beatIdx */
  function getQuarterBeatSound(beatIdx) {
    const state = getBeatIndicatorState(beatIdx);
    if (state === 'mute') return null;
    if (state === 'accent') {
      return { volume: volBeat1 * masterVol, freq: CLICK_ACCENT.freq, dur: CLICK_ACCENT.dur };
    }
    return { volume: volQuarter * masterVol, freq: CLICK_QUARTER.freq, dur: CLICK_QUARTER.dur };
  }

  /** @param {number} [den] */
  function getSubdivisionVolumeLabels(den = getTsDen()) {
    if (den === 8) {
      return i18n.lang === 'ja'
        ? { quarter: '8分', eighth: '16分', sixteenth: '32分' }
        : { quarter: 'Eighth', eighth: 'Sixteenth', sixteenth: '32nd' };
    }
    return i18n.lang === 'ja'
      ? { quarter: '4分', eighth: '8分', sixteenth: '16分' }
      : { quarter: 'Quarter', eighth: 'Eighth', sixteenth: 'Sixteenth' };
  }

  /** @param {HTMLInputElement} slider @param {number} min @param {number} max */
  function updateSliderFill(slider, min, max) {
    const pct = ((Number(slider.value) - min) / (max - min)) * 100;
    slider.style.setProperty('--pct', `${pct}%`);
  }

  /** @param {HTMLInputElement} slider @param {HTMLInputElement} numEl */
  function updateVolSlider(slider, numEl) {
    updateSliderFill(slider, 0, 100);
    numEl.value = slider.value;
  }

  function updateDenominatorAwareVolumeUi() {
    const labels = getSubdivisionVolumeLabels();
    document.querySelectorAll('[data-i18n="volume.quarter"]')
      .forEach(el => { el.textContent = labels.quarter; });
    document.querySelectorAll('[data-i18n="volume.eighth"]')
      .forEach(el => { el.textContent = labels.eighth; });
    document.querySelectorAll('[data-i18n="volume.sixteenth"]')
      .forEach(el => { el.textContent = labels.sixteenth; });

    const disableFinest = getTsDen() === 8;
    const muteFinestForSwing = getSwingMode() === 'eighth';
    denominatorAwareVolumeEls.forEach(({ labelKey, slider, num }) => {
      const isFinest = labelKey === 'volume.sixteenth';
      const disabled = isFinest && (disableFinest || muteFinestForSwing);
      const row = slider.closest('.vol-row');
      slider.disabled = disabled;
      num.disabled = disabled;
      if (isFinest) {
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

  /** @returns {BeatVolumes} */
  function currentBeatVolumes() {
    return {
      master: masterVol,
      beat1: volBeat1,
      quarter: volQuarter,
      eighth: volEighth,
      sixteenth: volSixteenth,
    };
  }

  /** @param {BeatVolumes | null} bv */
  function applyBeatVolumes(bv) {
    if (!bv) return;
    masterVol = bv.master ?? 1.0;
    volBeat1 = bv.beat1 ?? 1.0;
    volQuarter = bv.quarter ?? 0.8;
    volEighth = bv.eighth ?? 0.5;
    volSixteenth = bv.sixteenth ?? 0.0;
    syncVolumeBindings();
    updateDenominatorAwareVolumeUi();
    onChange();
  }

  function getVolumeBindings() {
    return [
      { slider: els.masterSlider, num: els.masterNum, get: () => masterVol, set: (/** @type {number} */ v) => { masterVol = v; } },
      { slider: els.beat1Slider, num: els.beat1Num, get: () => volBeat1, set: (/** @type {number} */ v) => { volBeat1 = v; } },
      { slider: els.quarterSlider, num: els.quarterNum, get: () => volQuarter, set: (/** @type {number} */ v) => { volQuarter = v; } },
      { slider: els.eighthSlider, num: els.eighthNum, get: () => volEighth, set: (/** @type {number} */ v) => { volEighth = v; } },
      { slider: els.sixteenthSlider, num: els.sixteenthNum, get: () => volSixteenth, set: (/** @type {number} */ v) => { volSixteenth = v; } },
    ];
  }

  function syncVolumeBindings() {
    getVolumeBindings().forEach(({ slider, num, get }) => {
      slider.value = String(Math.round(get() * 100));
      updateVolSlider(slider, num);
    });
  }

  /** @param {HTMLInputElement} inputEl @param {number} fallback */
  function parseVolumeInput(inputEl, fallback) {
    const typed = Number(String(inputEl.value || '').trim());
    if (!Number.isFinite(typed)) return fallback;
    return Math.min(100, Math.max(0, Math.round(typed)));
  }

  /**
   * @param {HTMLInputElement} sliderEl
   * @param {HTMLInputElement} numEl
   * @param {(value: number) => void} onApply
   */
  function bindVolumeNumberInput(sliderEl, numEl, onApply) {
    const commit = () => {
      if (sliderEl.disabled || numEl.disabled) return;
      const next = parseVolumeInput(numEl, Number(sliderEl.value));
      sliderEl.value = String(next);
      updateVolSlider(sliderEl, numEl);
      onApply(next / 100);
      onChange();
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

  getVolumeBindings().forEach(({ slider, num, set }) => {
    slider.addEventListener('input', () => {
      set(Number(slider.value) / 100);
      updateVolSlider(slider, num);
      onChange();
    });
    bindVolumeNumberInput(slider, num, set);
  });
  syncVolumeBindings();
  updateDenominatorAwareVolumeUi();

  return {
    getState: () => ({
      masterVol,
      volBeat1,
      volQuarter,
      volEighth,
      volSixteenth: getEffectiveSixteenthVolume(),
    }),
    getQuarterBeatSound,
    getSubdivisionVolumeLabels,
    updateDenominatorAwareVolumeUi,
    currentBeatVolumes,
    applyBeatVolumes,
  };
}

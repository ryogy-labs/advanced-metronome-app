// @ts-check

import {
  SWING_DEFAULT_AMOUNT,
  SWING_DEFAULT_MODE,
  SWING_MAX,
  SWING_MIN,
  SWING_MODES,
} from '../config.js';
import { clampSwingAmount } from '../audio/timing.js';

/**
 * @typedef {import('../state/song-config.js').SwingMode} SwingMode
 */

/**
 * @param {{
 *   els: {
 *     amountSlider: HTMLInputElement,
 *     amountNum: HTMLInputElement,
 *     modeBtns: HTMLElement[],
 *     presetBtns: HTMLButtonElement[],
 *   },
 *   onChange: (args?: { realignVisuals?: boolean }) => void,
 *   onModeChange: () => void,
 * }} deps
 */
export function createSwingController({
  els: { amountSlider, amountNum, modeBtns, presetBtns },
  onChange,
  onModeChange,
}) {
  /** @type {SwingMode} */
  let swingMode = SWING_DEFAULT_MODE;
  let swingAmount = SWING_DEFAULT_AMOUNT;

  /** @param {string | undefined} mode */
  function setSwingMode(mode) {
    swingMode = /** @type {SwingMode} */ (
      typeof mode === 'string' && SWING_MODES.includes(mode)
        ? mode
        : SWING_DEFAULT_MODE
    );
    syncSwingUi();
    onModeChange();
    onChange({ realignVisuals: true });
  }

  /** @param {number} amount */
  function setSwingAmount(amount) {
    swingAmount = clampSwingAmount(amount);
    syncSwingUi();
    onChange({ realignVisuals: true });
  }

  function syncSwingUi() {
    const amountDisabled = swingMode === 'off';
    modeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.swingMode === swingMode);
    });
    amountSlider.disabled = amountDisabled;
    amountSlider.value = swingAmount.toFixed(1);
    const pct = ((swingAmount - SWING_MIN) / (SWING_MAX - SWING_MIN)) * 100;
    amountSlider.style.setProperty('--pct', `${pct}%`);

    amountNum.disabled = amountDisabled;
    amountNum.value = swingAmount.toFixed(1);

    presetBtns.forEach(btn => {
      const preset = Number(btn.dataset.swingPreset);
      const isActive = Math.abs(swingAmount - preset) <= 0.05;
      btn.disabled = amountDisabled;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => setSwingMode(btn.dataset.swingMode));
  });
  amountSlider.addEventListener('input', () => setSwingAmount(Number(amountSlider.value)));
  amountNum.addEventListener('change', () => setSwingAmount(Number(amountNum.value)));
  amountNum.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setSwingAmount(Number(amountNum.value));
      amountNum.blur();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      syncSwingUi();
      amountNum.blur();
    }
  });
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => setSwingAmount(Number(btn.dataset.swingPreset)));
  });
  syncSwingUi();

  return {
    get swingMode() { return swingMode; },
    get swingAmount() { return swingAmount; },
    currentSwing: () => ({ swingMode, swingAmount }),
    setSwingMode,
    setSwingAmount,
    syncSwingUi,
  };
}

// @ts-check

// Shared lifecycle for the manual song form.
//
// Both the setlist song form (`pf*` ids — the "直接入力" branch of
// `#presetForm`) and the library form (`lib*` ids — the whole of
// `#libForm`) share the same shape: name input, BPM input, time-
// signature picker, "capture from current state" button + preview, and
// save/cancel buttons. This module owns that shared lifecycle.
//
// What it does NOT own:
//   - Outer form visibility (`#presetForm.style.display` /
//     `#libForm.style.display`). The host shows / hides the outer form
//     itself, because the setlist form has a mode toggle + library
//     picker side-by-side with the manual section, and only the host
//     knows when to flip those.
//   - Pro-gating for the capture button. The host wraps
//     `onCaptureRequest` in its `requirePro` modal and decides what to
//     pass back to `applyCapture`.
//   - The destination store (setlistStore vs songLibraryStore) and any
//     cross-cutting effects (e.g. `propagateLibSongChange`).
//
// Inputs:
//   - prefix:                'pf' | 'lib' — id prefix for inputs/buttons
//                            (matches the existing markup; lets the same
//                            module mount against either form).
//   - t, mountTsPicker, setTsPickerValues:
//                            i18n + ts-picker module functions, passed
//                            in so this module stays a pure UI piece.
//   - bpmRange:              { min, max } — clamp window for save.
//   - getCurrentBpm:         () => number — fallback when input is empty.
//   - getSubdivisionVolumeLabels:
//                            (denominator) => { quarter, eighth,
//                            sixteenth } — i18n-aware labels for the
//                            preview text.
//   - onSave(values):        host commits values to its store. `values`
//                            shape: { name, bpm, tsNum, tsDen,
//                            beatVolumes, beatStates, swingMode,
//                            swingAmount }.
//   - onCancel():            host reacts to the cancel button. Always
//                            fires *after* the form's own state is
//                            cleared.
//   - onCaptureRequest():    fires when the capture button is clicked.
//                            Host should pro-gate, then call back into
//                            `applyCapture(values)`.

import { SWING_DEFAULT_AMOUNT, SWING_DEFAULT_MODE } from '../config.js';

/**
 * @typedef {import('../state/song-config.js').BeatStates} BeatStates
 * @typedef {import('../state/song-config.js').BeatVolumes} BeatVolumes
 * @typedef {import('../state/song-config.js').SongConfig} SongConfig
 * @typedef {import('../state/song-config.js').SongConfigInput} SongConfigInput
 * @typedef {SongConfig & { name: string }} SongFormValues
 * @typedef {SongConfigInput & { name?: string }} SongFormOpenValues
 * @typedef {SongConfigInput & { bpm: number, tsNum: number, tsDen: number }} SongFormCaptureValues
 */

/**
 * @param {{
 *   prefix: string,
 *   t: (key: string) => string,
 *   mountTsPicker: (args: { container: HTMLElement, tsNum: number, tsDen: number, prefix: string, t: (key: string) => string }) => void,
 *   setTsPickerValues: (args: { prefix: string, tsNum: number, tsDen: number }) => void,
 *   bpmRange: { min: number, max: number },
 *   getCurrentBpm: () => number,
 *   getSubdivisionVolumeLabels: (denominator: number) => { quarter: string, eighth: string, sixteenth: string },
 *   onSave: (values: SongFormValues) => void,
 *   onCancel?: () => void,
 *   onCaptureRequest?: () => void,
 * }} options
 */
export function createSongForm({
  prefix,
  t,
  mountTsPicker,
  setTsPickerValues,
  bpmRange,
  getCurrentBpm,
  getSubdivisionVolumeLabels,
  onSave,
  onCancel,
  onCaptureRequest,
}) {
  const nameEl = /** @type {HTMLInputElement} */ (document.getElementById(`${prefix}Name`));
  const bpmEl = /** @type {HTMLInputElement} */ (document.getElementById(`${prefix}Bpm`));
  const tsEl = /** @type {HTMLElement} */ (document.getElementById(`${prefix}TsPicker`));
  const captureBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById(`${prefix}CaptureBtn`));
  const previewEl = /** @type {HTMLElement} */ (document.getElementById(`${prefix}CapturePreview`));
  const saveBtn = /** @type {HTMLButtonElement} */ (document.getElementById(`${prefix}Save`));
  const cancelBtn = /** @type {HTMLButtonElement} */ (document.getElementById(`${prefix}Cancel`));

  // Beat volumes / states are captured via the "現在の設定を取り込む"
  // button and persisted alongside name/bpm/ts. They live on the form
  // instance because they aren't tied to any input element.
  /** @type {BeatVolumes | null} */
  let beatVolumes = null;
  /** @type {BeatStates} */
  let beatStates = null;
  /** @type {import('../state/song-config.js').SwingMode} */
  let swingMode = SWING_DEFAULT_MODE;
  let swingAmount = SWING_DEFAULT_AMOUNT;

  /** @param {number} min @param {number} max @param {number} n */
  function clamp(min, max, n) {
    return Math.min(max, Math.max(min, n));
  }

  function getSwingPreviewText() {
    if (swingMode === 'off') return t('common.off');
    const label = swingMode === 'sixteenth' ? t('swing.sixteenth') : t('swing.eighth');
    return `${label} ${swingAmount.toFixed(1)}`;
  }

  /** @param {{ capturedBpm?: number | null, capturedDen?: number }} [args] */
  function renderPreview({ capturedBpm = null, capturedDen } = {}) {
    if (!beatVolumes) {
      previewEl.style.display = 'none';
      return;
    }
    const den = capturedDen ?? readTsValues().tsDen;
    const labels = getSubdivisionVolumeLabels(den);
    const bpmText = Number.isFinite(capturedBpm)
      ? `BPM:${Math.round(capturedBpm)} `
      : '';
    previewEl.style.display = 'block';
    previewEl.textContent =
      bpmText +
      `Master:${Math.round((beatVolumes.master ?? 1) * 100)} ` +
      `${t('volume.beat1')}:${Math.round((beatVolumes.beat1 ?? 1) * 100)} ` +
      `${labels.quarter}:${Math.round((beatVolumes.quarter ?? 0.8) * 100)} ` +
      `${labels.eighth}:${Math.round((beatVolumes.eighth ?? 0.5) * 100)} ` +
      `${labels.sixteenth}:${Math.round((beatVolumes.sixteenth ?? 0) * 100)} ` +
      `${t('swing.preview')}:${getSwingPreviewText()}`;
  }

  function readTsValues() {
    const tsNumEl = /** @type {HTMLInputElement | null} */ (document.getElementById(`${prefix}TsNum`));
    const tsDenEl = /** @type {HTMLInputElement | null} */ (document.getElementById(`${prefix}TsDen`));
    const tsNum = Number(tsNumEl?.value) || 4;
    const tsDen = Number(tsDenEl?.value) || 4;
    return { tsNum, tsDen };
  }

  /** @returns {SongFormValues} */
  function readValues() {
    const name = nameEl.value.trim();
    const parsed = parseInt(bpmEl.value, 10);
    const bpm = clamp(
      bpmRange.min, bpmRange.max,
      Number.isFinite(parsed) ? parsed : getCurrentBpm()
    );
    const { tsNum, tsDen } = readTsValues();
    return { name, bpm, tsNum, tsDen, beatVolumes, beatStates, swingMode, swingAmount };
  }

  // Populate fields and refresh the preview. Does NOT toggle the outer
  // form's visibility — host handles that (setlist form coexists with a
  // mode toggle + library picker, library form is just shown directly).
  /** @param {SongFormOpenValues} values */
  function open({
    name = '',
    bpm,
    tsNum = 4,
    tsDen = 4,
    beatVolumes: bv = null,
    beatStates: bs = null,
    swingMode: sm = SWING_DEFAULT_MODE,
    swingAmount: sa = SWING_DEFAULT_AMOUNT,
  }) {
    beatVolumes = bv;
    beatStates = bs;
    swingMode = sm;
    swingAmount = Number.isFinite(Number(sa)) ? Number(sa) : SWING_DEFAULT_AMOUNT;
    nameEl.value = name;
    bpmEl.value = String(bpm ?? getCurrentBpm());
    mountTsPicker({ container: tsEl, tsNum, tsDen, prefix: `${prefix}Ts`, t });
    renderPreview({ capturedDen: tsDen });
  }

  function close() {
    beatVolumes = null;
    beatStates = null;
    swingMode = SWING_DEFAULT_MODE;
    swingAmount = SWING_DEFAULT_AMOUNT;
    renderPreview();
  }

  // Apply a capture snapshot taken from the live metronome state. Host
  // calls this from inside its pro-gated capture handler.
  /** @param {SongFormCaptureValues} values */
  function applyCapture({ bpm, tsNum, tsDen, beatVolumes: bv, beatStates: bs, swingMode: sm, swingAmount: sa }) {
    beatVolumes = bv ?? null;
    beatStates = bs ?? null;
    swingMode = sm ?? SWING_DEFAULT_MODE;
    swingAmount = Number.isFinite(Number(sa)) ? Number(sa) : SWING_DEFAULT_AMOUNT;
    bpmEl.value = String(bpm);
    setTsPickerValues({ prefix: `${prefix}Ts`, tsNum, tsDen });
    renderPreview({ capturedBpm: bpm, capturedDen: tsDen });
  }

  function attemptSave() {
    const values = readValues();
    if (!values.name) { nameEl.focus(); return; }
    onSave(values);
  }

  // ── Wire buttons + Enter handling once at construction ──
  saveBtn.addEventListener('click', attemptSave);
  cancelBtn.addEventListener('click', () => { close(); onCancel?.(); });
  nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') attemptSave(); });
  bpmEl.addEventListener('keydown',  e => { if (e.key === 'Enter') attemptSave(); });
  if (captureBtn && onCaptureRequest) {
    captureBtn.addEventListener('click', () => onCaptureRequest());
  }

  return {
    open,
    close,
    applyCapture,
    focusName: () => nameEl.focus(),
  };
}

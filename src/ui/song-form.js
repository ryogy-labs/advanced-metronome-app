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
  const nameEl    = document.getElementById(`${prefix}Name`);
  const bpmEl     = document.getElementById(`${prefix}Bpm`);
  const tsEl      = document.getElementById(`${prefix}TsPicker`);
  const captureBtn = document.getElementById(`${prefix}CaptureBtn`);
  const previewEl = document.getElementById(`${prefix}CapturePreview`);
  const saveBtn   = document.getElementById(`${prefix}Save`);
  const cancelBtn = document.getElementById(`${prefix}Cancel`);

  // Beat volumes / states are captured via the "現在の設定を取り込む"
  // button and persisted alongside name/bpm/ts. They live on the form
  // instance because they aren't tied to any input element.
  let beatVolumes = null;
  let beatStates = null;
  let swingMode = SWING_DEFAULT_MODE;
  let swingAmount = SWING_DEFAULT_AMOUNT;

  function clamp(min, max, n) {
    return Math.min(max, Math.max(min, n));
  }

  function getSwingPreviewText() {
    if (swingMode === 'off') return t('common.off');
    const label = swingMode === 'sixteenth' ? t('swing.sixteenth') : t('swing.eighth');
    return `${label} ${swingAmount.toFixed(1)}`;
  }

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
    const tsNum = Number(document.getElementById(`${prefix}TsNum`)?.value) || 4;
    const tsDen = Number(document.getElementById(`${prefix}TsDen`)?.value) || 4;
    return { tsNum, tsDen };
  }

  function readValues() {
    const name = nameEl.value.trim();
    const parsed = parseInt(bpmEl.value);
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
    bpmEl.value = bpm;
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
  function applyCapture({ bpm, tsNum, tsDen, beatVolumes: bv, beatStates: bs, swingMode: sm, swingAmount: sa }) {
    beatVolumes = bv;
    beatStates = bs;
    swingMode = sm ?? SWING_DEFAULT_MODE;
    swingAmount = Number.isFinite(Number(sa)) ? Number(sa) : SWING_DEFAULT_AMOUNT;
    bpmEl.value = bpm;
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

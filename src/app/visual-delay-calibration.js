// @ts-check

import {
  CALIBRATION_BPM,
  CALIBRATION_MAX_DROPS,
  CALIBRATION_MIN_CONCENTRATION,
  CALIBRATION_TAPS_REQUIRED,
  CALIBRATION_TOLERANCE_MS,
  VISUAL_DELAY_DEFAULT_MS,
  VISUAL_DELAY_MAX_MS,
  VISUAL_DELAY_MIN_MS,
  VISUAL_DELAY_STEP_MS,
  LS_KEYS,
} from '../config.js';
import { getBeatDurationMs } from '../audio/timing.js';
import { robustCircularMean, wrapToPeriod } from '../audio/tap-offset.js';

/**
 * Estimates how far behind the audio runs, by having the player tap along
 * with the click.
 *
 * Two things make this measurable at all:
 *
 * 1. The reference clock has to be the one the player actually hears. On
 *    native the audible loop is the plugin's AVAudioPlayer, anchored at
 *    `nativeLoopAnchorMs`; the Web Audio scheduler still runs but only
 *    drives visuals, and its start time differs from the native loop's by a
 *    variable amount. Measuring against it would fold that difference into
 *    the answer.
 *
 * 2. The task is synchronisation, not reaction. Asked to tap *when you hear*
 *    a sound, a person is 150-250ms late — the same size as the delay being
 *    measured. Asked to tap *along with* a steady beat, they anticipate and
 *    land within a few tens of milliseconds, so reaction time drops out.
 *    The tempo is fixed while calibrating so the beat is easy to lock onto.
 *
 * @param {{
 *   t: (key: string) => string,
 *   getLang: () => string,
 *   getRunning: () => boolean,
 *   isNativeApp: () => boolean,
 *   getBpm: () => number,
 *   setBpm: (bpm: number) => void,
 *   startMetronome: () => void,
 *   getAudioContextTimeForNow: () => number | null,
 *   getScheduledBeatTimes: () => Array<{ time: number, beatIdx: number }>,
 *   getNativeLoopAnchorMs: () => number,
 * }} deps
 */
export function createVisualDelayCalibration({
  t,
  getLang,
  getRunning,
  isNativeApp,
  getBpm,
  setBpm,
  startMetronome,
  getAudioContextTimeForNow,
  getScheduledBeatTimes,
  getNativeLoopAnchorMs,
}) {
  let visualDelayMs = readStoredVisualDelayMs();
  /** @type {number[]} */
  let samples = [];
  let calibrating = false;
  let bpmBeforeCalibration = 0;
  let statusText = '';

  const ja = () => getLang() === 'ja';

  function clamp(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return VISUAL_DELAY_DEFAULT_MS;
    const stepped = Math.round(next / VISUAL_DELAY_STEP_MS) * VISUAL_DELAY_STEP_MS;
    return Math.min(VISUAL_DELAY_MAX_MS, Math.max(VISUAL_DELAY_MIN_MS, stepped));
  }

  function readStoredVisualDelayMs() {
    try {
      const stored = Number(localStorage.getItem(LS_KEYS.visualDelayMs));
      if (!Number.isFinite(stored)) return VISUAL_DELAY_DEFAULT_MS;
      return clamp(stored);
    } catch {
      return VISUAL_DELAY_DEFAULT_MS;
    }
  }

  function setVisualDelayMs(value) {
    visualDelayMs = clamp(value);
    try { localStorage.setItem(LS_KEYS.visualDelayMs, String(visualDelayMs)); } catch {}
  }

  function setStatusText(text) {
    statusText = text;
    return statusText;
  }

  function getVisualDelayCalibrationHint() {
    return statusText || t('settings.visualDelayCalibrateHint');
  }

  /**
   * Milliseconds from the most recent audible beat to now, on whichever
   * clock is actually producing sound.
   * @returns {number | null}
   */
  function msSinceLastAudibleBeat() {
    const beatMs = getBeatDurationMs(CALIBRATION_BPM);

    if (isNativeApp()) {
      const anchorMs = getNativeLoopAnchorMs();
      if (!(anchorMs > 0)) return null;
      return wrapToPeriod(performance.now() - anchorMs, beatMs);
    }

    const nowSec = getAudioContextTimeForNow();
    if (nowSec == null) return null;
    const beats = getScheduledBeatTimes();
    for (let i = beats.length - 1; i >= 0; i--) {
      if (beats[i].time <= nowSec) {
        return wrapToPeriod((nowSec - beats[i].time) * 1000, beatMs);
      }
    }
    return null;
  }

  function stopCalibration() {
    calibrating = false;
    samples = [];
    if (bpmBeforeCalibration > 0) {
      setBpm(bpmBeforeCalibration);
      bpmBeforeCalibration = 0;
    }
  }

  function isCalibrating() {
    return calibrating;
  }

  /** Begins a run: fixes the tempo, starts playback, clears any samples. */
  function startCalibration() {
    samples = [];
    calibrating = true;
    if (!bpmBeforeCalibration) bpmBeforeCalibration = getBpm();
    setBpm(CALIBRATION_BPM);
    if (!getRunning()) startMetronome();
    return setStatusText(
      ja()
        ? `拍に合わせて${CALIBRATION_TAPS_REQUIRED}回タップしてください（0/${CALIBRATION_TAPS_REQUIRED}）`
        : `Tap along with the beat ${CALIBRATION_TAPS_REQUIRED} times (0/${CALIBRATION_TAPS_REQUIRED})`
    );
  }

  function cancelCalibration() {
    if (!calibrating) return statusText;
    stopCalibration();
    return setStatusText(ja() ? '補正を中止しました' : 'Calibration cancelled');
  }

  /** One tap during a run. */
  function calibrateVisualDelayTap() {
    if (!calibrating) return startCalibration();

    const offsetMs = msSinceLastAudibleBeat();
    if (offsetMs == null) {
      return setStatusText(
        ja() ? '拍を検出中です。もう一度タップしてください' : 'Finding the beat. Tap again'
      );
    }

    samples.push(offsetMs);
    if (samples.length < CALIBRATION_TAPS_REQUIRED) {
      return setStatusText(
        ja()
          ? `${samples.length}/${CALIBRATION_TAPS_REQUIRED} タップ`
          : `${samples.length}/${CALIBRATION_TAPS_REQUIRED} taps`
      );
    }

    const beatMs = getBeatDurationMs(CALIBRATION_BPM);
    const result = robustCircularMean(samples, beatMs, {
      toleranceMs: CALIBRATION_TOLERANCE_MS,
    });
    stopCalibration();

    // Refuse rather than write a number the taps do not support. A wrong
    // correction is worse than none: it shifts every beat the player sees.
    // Needing more than a couple of discards means the run had no rhythm to
    // begin with, which is the clearest signal available here.
    const unusable = !result
      || result.dropped.length > CALIBRATION_MAX_DROPS
      || result.concentration < CALIBRATION_MIN_CONCENTRATION;
    if (unusable) {
      return setStatusText(
        ja()
          ? 'タップがばらついたため測定できませんでした。もう一度お試しください'
          : 'The taps were too uneven to measure. Please try again'
      );
    }

    setVisualDelayMs(result.meanMs);
    const droppedNote = result.dropped.length
      ? (ja() ? `（${result.dropped.length}回除外）` : ` (${result.dropped.length} discarded)`)
      : '';
    return setStatusText(
      ja()
        ? `${visualDelayMs}ms に設定しました${droppedNote}`
        : `Set to ${visualDelayMs} ms${droppedNote}`
    );
  }

  function applyI18n() {
    if (!statusText) statusText = t('settings.visualDelayCalibrateHint');
  }

  return {
    getVisualDelayMs: () => visualDelayMs,
    setVisualDelayMs,
    startCalibration,
    cancelCalibration,
    isCalibrating,
    calibrateVisualDelayTap,
    getVisualDelayCalibrationHint,
    applyI18n,
  };
}

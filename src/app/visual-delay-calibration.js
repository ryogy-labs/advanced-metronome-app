// @ts-check

import {
  VISUAL_DELAY_DEFAULT_MS,
  VISUAL_DELAY_MAX_MS,
  VISUAL_DELAY_MIN_MS,
  VISUAL_DELAY_STEP_MS,
  LS_KEYS,
} from '../config.js';

/**
 * @param {{
 *   t: (key: string) => string,
 *   getLang: () => string,
 *   getRunning: () => boolean,
 *   startMetronome: () => void,
 *   getAudioContextTimeForNow: () => number | null,
 *   getScheduledBeatTimes: () => Array<{ time: number, beatIdx: number }>,
 * }} deps
 */
export function createVisualDelayCalibration({
  t,
  getLang,
  getRunning,
  startMetronome,
  getAudioContextTimeForNow,
  getScheduledBeatTimes,
}) {
  let visualDelayMs = readStoredVisualDelayMs();
  /** @type {number[]} */
  let samples = [];
  let statusText = '';

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

  function getVisualDelayCalibrationHint() {
    return statusText || t('settings.visualDelayCalibrateHint');
  }

  function setStatusText(text) {
    statusText = text;
    return statusText;
  }

  function getPreviousScheduledBeatTime(nowSec) {
    const beats = getScheduledBeatTimes();
    for (let i = beats.length - 1; i >= 0; i--) {
      if (beats[i].time <= nowSec) return beats[i].time;
    }
    return null;
  }

  function calibrateVisualDelayTap() {
    if (!getRunning()) {
      samples = [];
      startMetronome();
      return setStatusText(
        getLang() === 'ja'
          ? '再生を開始しました。音が聞こえたら3回タップしてください'
          : 'Started playback. Tap 3 times when you hear the sound'
      );
    }

    const nowSec = getAudioContextTimeForNow();
    if (nowSec == null) {
      return setStatusText(
        getLang() === 'ja'
          ? '音声クロックの取得に失敗しました'
          : 'Could not read the audio clock'
      );
    }

    const previousBeatTime = getPreviousScheduledBeatTime(nowSec);
    if (previousBeatTime == null) {
      return setStatusText(
        getLang() === 'ja'
          ? '拍を検出中です。もう一度タップしてください'
          : 'Finding the beat. Tap again'
      );
    }

    const sampleMs = (nowSec - previousBeatTime) * 1000;
    if (!Number.isFinite(sampleMs) || sampleMs < 0) {
      return setStatusText(
        getLang() === 'ja'
          ? 'うまく読めませんでした。もう一度タップしてください'
          : 'Could not read that tap. Try again'
      );
    }

    samples.push(sampleMs);
    if (samples.length < 3) {
      return setStatusText(
        getLang() === 'ja'
          ? `${samples.length}/3 タップ`
          : `${samples.length}/3 taps`
      );
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    setVisualDelayMs(median);
    samples = [];
    return setStatusText(
      getLang() === 'ja'
        ? `${visualDelayMs}ms に設定しました`
        : `Set to ${visualDelayMs} ms`
    );
  }

  function applyI18n() {
    if (!statusText) statusText = t('settings.visualDelayCalibrateHint');
  }

  return {
    getVisualDelayMs: () => visualDelayMs,
    setVisualDelayMs,
    calibrateVisualDelayTap,
    getVisualDelayCalibrationHint,
    applyI18n,
  };
}

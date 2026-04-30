// @ts-check

import { BPM_DEFAULT, SWING_DEFAULT_AMOUNT, SWING_DEFAULT_MODE } from '../config.js';

/**
 * @typedef {'accent' | 'normal' | 'mute'} BeatState
 * @typedef {'off' | 'eighth' | 'sixteenth'} SwingMode
 * @typedef {{ master?: number, beat1?: number, quarter?: number, eighth?: number, sixteenth?: number }} BeatVolumes
 * @typedef {object} SongConfigInput
 * @property {number=} bpm
 * @property {number=} tsNum
 * @property {number=} tsDen
 * @property {BeatStates=} beatStates
 * @property {BeatVolumes | null=} beatVolumes
 * @property {SwingMode=} swingMode
 * @property {number=} swingAmount
 * @typedef {BeatState[] | null} BeatStates
 * @typedef {object} SongConfig
 * @property {number} bpm
 * @property {number} tsNum
 * @property {number} tsDen
 * @property {BeatStates} beatStates
 * @property {BeatVolumes | null} beatVolumes
 * @property {SwingMode} swingMode
 * @property {number} swingAmount
 */

/**
 * @param {SongConfigInput} [song]
 * @param {SongConfigInput | null} [fallback]
 * @returns {SongConfig}
 */
export function withSongDefaults(song = {}, fallback = {}) {
  const fallbackConfig = fallback ?? {};
  return {
    bpm: song.bpm ?? fallbackConfig.bpm ?? BPM_DEFAULT,
    tsNum: song.tsNum ?? fallbackConfig.tsNum ?? 4,
    tsDen: song.tsDen ?? fallbackConfig.tsDen ?? 4,
    beatStates: song.beatStates ?? fallbackConfig.beatStates ?? null,
    beatVolumes: song.beatVolumes ?? fallbackConfig.beatVolumes ?? null,
    swingMode: song.swingMode ?? fallbackConfig.swingMode ?? SWING_DEFAULT_MODE,
    swingAmount: song.swingAmount ?? fallbackConfig.swingAmount ?? SWING_DEFAULT_AMOUNT,
  };
}

/**
 * @param {SongConfigInput} [song]
 * @returns {{ tsNum: number, tsDen: number }}
 */
export function getSongTimeSignature(song = {}) {
  return {
    tsNum: song.tsNum ?? 4,
    tsDen: song.tsDen ?? 4,
  };
}

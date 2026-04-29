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
 * @param {SongConfigInput} [fallback]
 * @returns {SongConfig}
 */
export function withSongDefaults(song = {}, fallback = {}) {
  return {
    bpm: song.bpm ?? fallback?.bpm ?? BPM_DEFAULT,
    tsNum: song.tsNum ?? fallback?.tsNum ?? 4,
    tsDen: song.tsDen ?? fallback?.tsDen ?? 4,
    beatStates: song.beatStates ?? fallback?.beatStates ?? null,
    beatVolumes: song.beatVolumes ?? fallback?.beatVolumes ?? null,
    swingMode: song.swingMode ?? fallback?.swingMode ?? SWING_DEFAULT_MODE,
    swingAmount: song.swingAmount ?? fallback?.swingAmount ?? SWING_DEFAULT_AMOUNT,
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

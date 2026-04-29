import { SWING_DEFAULT_AMOUNT, SWING_DEFAULT_MODE } from '../config.js';

export function withSongDefaults(song = {}, fallback = {}) {
  return {
    bpm: song.bpm ?? fallback?.bpm,
    tsNum: song.tsNum ?? fallback?.tsNum ?? 4,
    tsDen: song.tsDen ?? fallback?.tsDen ?? 4,
    beatStates: song.beatStates ?? fallback?.beatStates ?? null,
    beatVolumes: song.beatVolumes ?? fallback?.beatVolumes ?? null,
    swingMode: song.swingMode ?? fallback?.swingMode ?? SWING_DEFAULT_MODE,
    swingAmount: song.swingAmount ?? fallback?.swingAmount ?? SWING_DEFAULT_AMOUNT,
  };
}

export function getSongTimeSignature(song = {}) {
  return {
    tsNum: song.tsNum ?? 4,
    tsDen: song.tsDen ?? 4,
  };
}

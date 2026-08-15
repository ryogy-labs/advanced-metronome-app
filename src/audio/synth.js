// Square-wave click renderer shared between live AudioContext playback and
// OfflineAudioContext WAV pre-rendering for background loops.

import { CLICK_PEAK_SCALE } from '../config.js';

export function renderClick(ctx, destination, time, vol, freq, dur) {
  if (vol <= 0) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(destination);
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, time);
  gain.gain.setValueAtTime(vol * CLICK_PEAK_SCALE, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  osc.start(time);
  osc.stop(time + dur + 0.01);
}

export function getSubdivisionsPerBeat(tsDen) {
  return 16 / tsDen;
}

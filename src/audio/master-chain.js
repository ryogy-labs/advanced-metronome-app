// @ts-check

// Master output stage shared by live playback and the offline WAV pre-render.
//
// The raw square-wave click peaks at CLICK_PEAK_SCALE and decays exponentially
// within ~25ms, which leaves the metronome noticeably quieter than other apps
// even at maximum volume. Driving the summed click bus into a tanh soft
// clipper lets the loudest settings sit at full scale (and hold there for most
// of the click) while quiet settings stay close to a plain linear boost.
//
// A WaveShaper is used instead of a DynamicsCompressor because compressors add
// implementation-defined pre-delay, which would shift click timing.

import { MASTER_DRIVE, MASTER_CURVE_SAMPLES } from '../config.js';

/** @type {Float32Array | null} */
let curveCache = null;

function softClipCurve() {
  if (curveCache) return curveCache;
  const n = MASTER_CURVE_SAMPLES;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = Math.tanh(MASTER_DRIVE * x);
  }
  curveCache = curve;
  return curve;
}

/**
 * Builds the soft clipper and wires it to `destination`.
 *
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} destination
 * @returns {AudioNode} node that click sources should connect to
 */
export function createMasterChain(ctx, destination) {
  const shaper = ctx.createWaveShaper();
  shaper.curve = softClipCurve();
  // Oversampling would add resampling latency, so the click stays unshifted.
  shaper.oversample = 'none';
  shaper.connect(destination);
  return shaper;
}

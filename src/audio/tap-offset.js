// @ts-check

// Statistics for tap-calibration offsets.
//
// An offset is "how long after the beat the tap landed", so it lives on a
// circle of one beat period, not on a line: at 120 BPM a beat is 500ms, and
// a tap 10ms *before* the beat reads as 490ms after the previous one. Those
// two are the same point, 20ms apart — but a plain mean or median treats
// them as maximally distant and lands on 250ms, the worst possible answer.
//
// So everything here works in angles. Samples are mapped onto the circle,
// averaged as unit vectors, and only converted back to milliseconds at the
// end.

/** @param {number} ms @param {number} periodMs */
export function wrapToPeriod(ms, periodMs) {
  if (!(periodMs > 0)) return 0;
  return ((ms % periodMs) + periodMs) % periodMs;
}

/**
 * Shortest signed distance from `a` to `b` on the circle, in [-period/2, period/2].
 * @param {number} a @param {number} b @param {number} periodMs
 */
export function circularDistance(a, b, periodMs) {
  if (!(periodMs > 0)) return 0;
  const raw = wrapToPeriod(b - a, periodMs);
  return raw > periodMs / 2 ? raw - periodMs : raw;
}

/**
 * Vector mean of the samples on the circle.
 *
 * Returns `null` when the samples are spread so evenly that the resultant
 * vector has no direction — that means the taps carried no usable rhythm,
 * and inventing a number from them would be worse than refusing.
 *
 * `concentration` is the resultant length in [0, 1]: 1 for identical taps,
 * near 0 for noise. It is the honest confidence signal for the caller.
 *
 * @param {number[]} samples
 * @param {number} periodMs
 * @returns {{ meanMs: number, concentration: number } | null}
 */
export function circularMean(samples, periodMs) {
  if (!samples.length || !(periodMs > 0)) return null;
  let sumSin = 0;
  let sumCos = 0;
  for (const sample of samples) {
    const angle = (wrapToPeriod(sample, periodMs) / periodMs) * 2 * Math.PI;
    sumSin += Math.sin(angle);
    sumCos += Math.cos(angle);
  }
  const meanSin = sumSin / samples.length;
  const meanCos = sumCos / samples.length;
  const concentration = Math.hypot(meanSin, meanCos);
  // Below this the mean angle is numerically meaningless, not merely noisy.
  if (concentration < 1e-6) return null;
  const meanAngle = Math.atan2(meanSin, meanCos);
  return {
    meanMs: wrapToPeriod((meanAngle / (2 * Math.PI)) * periodMs, periodMs),
    concentration,
  };
}

/**
 * Drops taps that sit far from the group, then re-averages what is left.
 *
 * Tapping produces the occasional stray — a missed beat, a double tap, a
 * moment of inattention — and one stray can drag a mean by tens of
 * milliseconds. Samples further than `toleranceMs` from the provisional
 * mean are discarded, but never more than `maxDropRatio` of them: if most
 * taps disagree, the run is bad and should be reported as such rather than
 * trimmed until it looks tidy.
 *
 * @param {number[]} samples
 * @param {number} periodMs
 * @param {{ toleranceMs?: number, maxDropRatio?: number }} [opts]
 * @returns {{ meanMs: number, concentration: number, kept: number[], dropped: number[] } | null}
 */
export function robustCircularMean(samples, periodMs, opts = {}) {
  const { toleranceMs = 60, maxDropRatio = 0.4 } = opts;
  const provisional = circularMean(samples, periodMs);
  if (!provisional) return null;

  const scored = samples.map(sample => ({
    sample,
    distance: Math.abs(circularDistance(provisional.meanMs, sample, periodMs)),
  }));
  const maxDrops = Math.floor(samples.length * maxDropRatio);

  // Furthest first, so the drop budget is spent on the worst offenders.
  const ordered = [...scored].sort((a, b) => b.distance - a.distance);
  const dropped = [];
  for (const entry of ordered) {
    if (dropped.length >= maxDrops) break;
    if (entry.distance <= toleranceMs) break;
    dropped.push(entry.sample);
  }

  const droppedCounts = new Map();
  for (const value of dropped) droppedCounts.set(value, (droppedCounts.get(value) ?? 0) + 1);
  const kept = [];
  for (const sample of samples) {
    const remaining = droppedCounts.get(sample) ?? 0;
    if (remaining > 0) {
      droppedCounts.set(sample, remaining - 1);
      continue;
    }
    kept.push(sample);
  }

  const refined = circularMean(kept, periodMs);
  if (!refined) return null;
  return { meanMs: refined.meanMs, concentration: refined.concentration, kept, dropped };
}

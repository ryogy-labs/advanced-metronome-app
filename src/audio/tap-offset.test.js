import test from 'node:test';
import assert from 'node:assert/strict';

import {
  wrapToPeriod,
  circularDistance,
  circularMean,
  robustCircularMean,
} from './tap-offset.js';

const T = 500; // one beat at 120 BPM, and exactly VISUAL_DELAY_MAX_MS

test('wrapToPeriod folds negatives and overflow back into one period', () => {
  assert.equal(wrapToPeriod(120, T), 120);
  assert.equal(wrapToPeriod(-20, T), 480);
  assert.equal(wrapToPeriod(520, T), 20);
  assert.equal(wrapToPeriod(0, T), 0);
});

test('circularDistance takes the short way round', () => {
  assert.equal(circularDistance(10, 40, T), 30);
  assert.equal(circularDistance(40, 10, T), -30);
  // 490 and 10 are 20ms apart across the wrap, not 480ms apart
  assert.equal(circularDistance(490, 10, T), 20);
  assert.equal(circularDistance(10, 490, T), -20);
});

test('circularMean averages a tight cluster', () => {
  const result = circularMean([180, 190, 200, 210, 220], T);
  assert.ok(result);
  assert.ok(Math.abs(result.meanMs - 200) < 1, `got ${result.meanMs}`);
  // Samples span +-20ms of a 500ms period, so the resultant sits near 0.984.
  assert.ok(result.concentration > 0.98, `got ${result.concentration}`);
});

test('circularMean handles a cluster straddling the wrap point', () => {
  // This is the case a plain median gets catastrophically wrong: it would
  // return ~250ms, the far side of the circle.
  const samples = [490, 495, 0, 5, 10];
  const result = circularMean(samples, T);
  assert.ok(result);
  const distanceFromZero = Math.abs(circularDistance(0, result.meanMs, T));
  assert.ok(distanceFromZero < 5, `expected ~0ms, got ${result.meanMs}`);

  const plainMedian = [...samples].sort((a, b) => a - b)[2];
  assert.equal(plainMedian, 10);
  const plainMean = samples.reduce((a, b) => a + b, 0) / samples.length;
  assert.ok(Math.abs(plainMean - 200) < 1, 'a plain mean lands ~200ms away');
});

test('circularMean refuses samples with no direction', () => {
  // Evenly spread around the circle: no meaningful centre exists.
  assert.equal(circularMean([0, 125, 250, 375], T), null);
});

test('circularMean returns null for no samples', () => {
  assert.equal(circularMean([], T), null);
  assert.equal(circularMean([100], 0), null);
});

test('robustCircularMean drops a stray tap', () => {
  const samples = [200, 205, 195, 210, 198, 202, 380, 199];
  const result = robustCircularMean(samples, T);
  assert.ok(result);
  assert.deepEqual(result.dropped, [380]);
  assert.ok(Math.abs(result.meanMs - 201) < 4, `got ${result.meanMs}`);
});

test('robustCircularMean keeps everything when the run is clean', () => {
  const samples = [150, 155, 160, 152, 158, 149, 156, 153];
  const result = robustCircularMean(samples, T);
  assert.ok(result);
  assert.deepEqual(result.dropped, []);
  assert.equal(result.kept.length, 8);
});

test('robustCircularMean will not trim away a genuinely bad run', () => {
  // Scattered taps: dropping until it looks tidy would fabricate confidence,
  // so the drop budget is capped and the result stays visibly less certain
  // than a clean run. Compared against a clean run rather than a magic
  // threshold, since trimming does lift concentration somewhat.
  const scattered = [0, 60, 130, 190, 260, 320, 390, 450];
  const bad = robustCircularMean(scattered, T);
  const good = robustCircularMean([150, 155, 160, 152, 158, 149, 156, 153], T);
  assert.ok(bad && good);
  assert.ok(bad.dropped.length <= Math.floor(scattered.length * 0.4));
  assert.ok(bad.concentration < good.concentration - 0.3,
    `bad ${bad.concentration} vs good ${good.concentration}`);
});

test('robustCircularMean trims across the wrap point', () => {
  const samples = [495, 2, 498, 5, 0, 250, 3, 497];
  const result = robustCircularMean(samples, T);
  assert.ok(result);
  assert.deepEqual(result.dropped, [250]);
  assert.ok(Math.abs(circularDistance(0, result.meanMs, T)) < 5, `got ${result.meanMs}`);
});

test('duplicate sample values are dropped only once', () => {
  const samples = [200, 200, 200, 200, 380, 380, 200, 200];
  const result = robustCircularMean(samples, T);
  assert.ok(result);
  assert.equal(result.kept.filter(v => v === 200).length, 6);
  assert.equal(result.dropped.length, 2);
});

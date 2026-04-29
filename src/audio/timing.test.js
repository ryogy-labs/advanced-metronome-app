import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMeasureSubBeatEvents,
  getBeatPositionFromLoopMs,
  getSubBeatOffsetSec,
} from './timing.js';

test('getSubBeatOffsetSec keeps straight timing at 50 swing', () => {
  assert.equal(getSubBeatOffsetSec({
    subBeat: 2,
    bpm: 120,
    tsDen: 4,
    swingMode: 'eighth',
    swingAmount: 50,
  }), 0.25);
});

test('getSubBeatOffsetSec places eighth swing near 2:1 at 66.7', () => {
  assert.equal(getSubBeatOffsetSec({
    subBeat: 2,
    bpm: 120,
    tsDen: 4,
    swingMode: 'eighth',
    swingAmount: 66.7,
  }), 0.3335);
});

test('buildMeasureSubBeatEvents returns sorted events for x/4 and x/8', () => {
  const fourFour = buildMeasureSubBeatEvents({ bpm: 120, beatsPerMeasure: 4, tsDen: 4 });
  const sixEight = buildMeasureSubBeatEvents({ bpm: 120, beatsPerMeasure: 6, tsDen: 8 });

  assert.equal(fourFour.length, 16);
  assert.equal(sixEight.length, 12);
  assert.deepEqual(
    fourFour.map(event => event.offsetSec),
    fourFour.map(event => event.offsetSec).toSorted((a, b) => a - b)
  );
  assert.deepEqual(
    sixEight.map(event => event.offsetSec),
    sixEight.map(event => event.offsetSec).toSorted((a, b) => a - b)
  );
});

test('getBeatPositionFromLoopMs handles beat and measure boundaries', () => {
  assert.deepEqual(getBeatPositionFromLoopMs({
    loopMs: 0,
    bpm: 120,
    beatsPerMeasure: 4,
  }), { beatIdx: 0, phase: 0 });

  assert.deepEqual(getBeatPositionFromLoopMs({
    loopMs: 500,
    bpm: 120,
    beatsPerMeasure: 4,
  }), { beatIdx: 1, phase: 0 });

  assert.deepEqual(getBeatPositionFromLoopMs({
    loopMs: 1999,
    bpm: 120,
    beatsPerMeasure: 4,
  }), { beatIdx: 3, phase: 0.998 });
});

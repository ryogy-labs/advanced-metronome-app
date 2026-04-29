import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDefaultBeatStates,
  getNextBeatState,
  normalizeBeatStates,
} from './beat-states.js';

test('buildDefaultBeatStates accents compound 6/8 groups', () => {
  assert.deepEqual(
    buildDefaultBeatStates(6, 8),
    ['accent', 'normal', 'normal', 'accent', 'normal', 'normal']
  );
});

test('normalizeBeatStates preserves valid states and fills invalid values', () => {
  assert.deepEqual(
    normalizeBeatStates(['mute', 'accent', 'bad'], 4, 4),
    ['mute', 'accent', 'normal', 'normal']
  );
});

test('getNextBeatState cycles accent, normal, mute', () => {
  assert.equal(getNextBeatState('accent'), 'normal');
  assert.equal(getNextBeatState('normal'), 'mute');
  assert.equal(getNextBeatState('mute'), 'accent');
});

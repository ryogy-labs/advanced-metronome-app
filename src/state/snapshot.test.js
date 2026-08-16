import test from 'node:test';
import assert from 'node:assert/strict';

import { LS_KEYS } from '../config.js';
import {
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  buildSnapshot,
  validateSnapshot,
  snapshotToEntries,
  isEmptySnapshot,
} from './snapshot.js';

function fakeStore(entries) {
  return key => (key in entries ? entries[key] : null);
}

test('buildSnapshot collects setlists, songs and settings', () => {
  const getItem = fakeStore({
    [LS_KEYS.setlists]: JSON.stringify([{ id: '1', name: 'Set A', songs: [] }]),
    [LS_KEYS.songLib]: JSON.stringify([{ id: '9', name: 'Tune', bpm: 96 }]),
    [LS_KEYS.lang]: 'en',
    [LS_KEYS.visualDelayMs]: '120',
    [LS_KEYS.wakelock]: '0',
  });
  const snap = buildSnapshot(getItem, () => '2026-01-01T00:00:00.000Z');

  assert.equal(snap.format, SNAPSHOT_FORMAT);
  assert.equal(snap.version, SNAPSHOT_VERSION);
  assert.equal(snap.exportedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(snap.setlists.length, 1);
  assert.equal(snap.songs.length, 1);
  assert.deepEqual(snap.settings, { lang: 'en', visualDelayMs: '120', wakelock: '0' });
});

test('buildSnapshot tolerates missing and corrupt stored values', () => {
  const snap = buildSnapshot(fakeStore({ [LS_KEYS.setlists]: '{not json' }));
  assert.deepEqual(snap.setlists, []);
  assert.deepEqual(snap.songs, []);
  assert.deepEqual(snap.settings, {});
});

test('buildSnapshot ignores non-array stored collections', () => {
  const snap = buildSnapshot(fakeStore({ [LS_KEYS.songLib]: '{"id":"x"}' }));
  assert.deepEqual(snap.songs, []);
});

test('validateSnapshot accepts a well formed snapshot', () => {
  const result = validateSnapshot({
    format: SNAPSHOT_FORMAT,
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    setlists: [{ id: '1' }],
    songs: [],
    settings: { lang: 'ja' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.setlists.length, 1);
  assert.deepEqual(result.snapshot.settings, { lang: 'ja' });
});

test('validateSnapshot rejects foreign and malformed files', () => {
  const cases = [
    [null, 'notAnObject'],
    ['a string', 'notAnObject'],
    [[], 'notAnObject'],
    [{ version: 1 }, 'wrongFormat'],
    [{ format: 'something-else', version: 1 }, 'wrongFormat'],
    [{ format: SNAPSHOT_FORMAT }, 'badVersion'],
    [{ format: SNAPSHOT_FORMAT, version: 'one' }, 'badVersion'],
    [{ format: SNAPSHOT_FORMAT, version: 1, setlists: {} }, 'badSetlists'],
    [{ format: SNAPSHOT_FORMAT, version: 1, songs: 'nope' }, 'badSongs'],
  ];
  for (const [input, reason] of cases) {
    const result = validateSnapshot(input);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(input)}`);
    assert.equal(result.reason, reason);
  }
});

test('validateSnapshot refuses a snapshot from a newer version', () => {
  const result = validateSnapshot({ format: SNAPSHOT_FORMAT, version: SNAPSHOT_VERSION + 1 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'tooNew');
});

test('validateSnapshot fills defaults for absent optional fields', () => {
  const result = validateSnapshot({ format: SNAPSHOT_FORMAT, version: 1 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.setlists, []);
  assert.deepEqual(result.snapshot.songs, []);
  assert.deepEqual(result.snapshot.settings, {});
  assert.equal(result.snapshot.exportedAt, '');
});

test('snapshot survives a build then restore round trip', () => {
  const original = {
    [LS_KEYS.setlists]: JSON.stringify([{ id: '1', name: 'Set A', songs: [{ id: 's1', bpm: 120 }] }]),
    [LS_KEYS.songLib]: JSON.stringify([{ id: '9', name: 'Tune', bpm: 96 }]),
    [LS_KEYS.lang]: 'en',
    [LS_KEYS.visualDelayMs]: '120',
    [LS_KEYS.wakelock]: '1',
  };
  const snap = buildSnapshot(fakeStore(original));
  const parsed = validateSnapshot(JSON.parse(JSON.stringify(snap)));
  assert.equal(parsed.ok, true);

  const restored = Object.fromEntries(snapshotToEntries(parsed.snapshot));
  assert.deepEqual(JSON.parse(restored[LS_KEYS.setlists]), JSON.parse(original[LS_KEYS.setlists]));
  assert.deepEqual(JSON.parse(restored[LS_KEYS.songLib]), JSON.parse(original[LS_KEYS.songLib]));
  assert.equal(restored[LS_KEYS.lang], 'en');
  assert.equal(restored[LS_KEYS.visualDelayMs], '120');
  assert.equal(restored[LS_KEYS.wakelock], '1');
});

test('snapshotToEntries omits settings the snapshot does not carry', () => {
  const entries = Object.fromEntries(
    snapshotToEntries({
      format: SNAPSHOT_FORMAT,
      version: 1,
      exportedAt: '',
      setlists: [],
      songs: [],
      settings: {},
    })
  );
  assert.ok(LS_KEYS.setlists in entries);
  assert.ok(!(LS_KEYS.lang in entries));
});

test('isEmptySnapshot only reports empty when both collections are empty', () => {
  const base = { format: SNAPSHOT_FORMAT, version: 1, exportedAt: '', settings: {} };
  assert.equal(isEmptySnapshot({ ...base, setlists: [], songs: [] }), true);
  assert.equal(isEmptySnapshot({ ...base, setlists: [{ id: '1' }], songs: [] }), false);
  assert.equal(isEmptySnapshot({ ...base, setlists: [], songs: [{ id: '1' }] }), false);
});

// @ts-check

// A snapshot is the whole persisted state of the app in one plain object.
//
// Three features share it: the durable native-file mirror, backup export,
// and backup import. Keeping one shape means a file written by any of them
// is readable by the others.
//
// Setlists and the song library are stored parsed (they are the data users
// actually care about, and a readable backup file is worth more than a
// terse one). The small settings stay as the raw strings localStorage
// holds, because that is exactly what has to be written back.

import { LS_KEYS } from '../config.js';

export const SNAPSHOT_FORMAT = 'metrobeat-backup';
export const SNAPSHOT_VERSION = 1;

/** Settings carried in a snapshot. `devForcePro` is deliberately excluded. */
const SETTING_KEYS = /** @type {const} */ ([
  ['lang', LS_KEYS.lang],
  ['visualDelayMs', LS_KEYS.visualDelayMs],
  ['wakelock', LS_KEYS.wakelock],
]);

/**
 * @typedef {{
 *   format: string,
 *   version: number,
 *   exportedAt: string,
 *   setlists: unknown[],
 *   songs: unknown[],
 *   settings: Record<string, string>,
 * }} Snapshot
 */

/** @param {string} raw */
function parseArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {(key: string) => string | null} getItem
 * @param {() => string} [now]
 * @returns {Snapshot}
 */
export function buildSnapshot(getItem, now = () => new Date().toISOString()) {
  /** @type {Record<string, string>} */
  const settings = {};
  for (const [name, key] of SETTING_KEYS) {
    const value = getItem(key);
    if (value !== null && value !== undefined) settings[name] = String(value);
  }
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    exportedAt: now(),
    setlists: parseArray(getItem(LS_KEYS.setlists) ?? ''),
    songs: parseArray(getItem(LS_KEYS.songLib) ?? ''),
    settings,
  };
}

/**
 * Import runs on files the app did not necessarily write, so this is the
 * gate: anything that fails here must not touch stored data.
 *
 * @param {unknown} value
 * @returns {{ ok: true, snapshot: Snapshot } | { ok: false, reason: string }}
 */
export function validateSnapshot(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'notAnObject' };
  }
  const obj = /** @type {Record<string, unknown>} */ (value);
  if (obj.format !== SNAPSHOT_FORMAT) return { ok: false, reason: 'wrongFormat' };
  if (typeof obj.version !== 'number' || !Number.isFinite(obj.version)) {
    return { ok: false, reason: 'badVersion' };
  }
  // A file from a newer build may use fields this version would silently
  // drop, so refuse rather than quietly degrade the user's backup.
  if (obj.version > SNAPSHOT_VERSION) return { ok: false, reason: 'tooNew' };
  if (obj.setlists !== undefined && !Array.isArray(obj.setlists)) {
    return { ok: false, reason: 'badSetlists' };
  }
  if (obj.songs !== undefined && !Array.isArray(obj.songs)) {
    return { ok: false, reason: 'badSongs' };
  }
  return {
    ok: true,
    snapshot: {
      format: SNAPSHOT_FORMAT,
      version: obj.version,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
      setlists: Array.isArray(obj.setlists) ? obj.setlists : [],
      songs: Array.isArray(obj.songs) ? obj.songs : [],
      settings:
        typeof obj.settings === 'object' && obj.settings !== null && !Array.isArray(obj.settings)
          ? /** @type {Record<string, string>} */ (obj.settings)
          : {},
    },
  };
}

/**
 * Flattens a snapshot back into the localStorage entries it came from.
 *
 * @param {Snapshot} snapshot
 * @returns {[string, string][]}
 */
export function snapshotToEntries(snapshot) {
  /** @type {[string, string][]} */
  const entries = [
    [LS_KEYS.setlists, JSON.stringify(snapshot.setlists ?? [])],
    [LS_KEYS.songLib, JSON.stringify(snapshot.songs ?? [])],
  ];
  for (const [name, key] of SETTING_KEYS) {
    const value = snapshot.settings?.[name];
    if (typeof value === 'string') entries.push([key, value]);
  }
  return entries;
}

/** True when a snapshot carries nothing worth restoring. */
export function isEmptySnapshot(snapshot) {
  return (snapshot.setlists?.length ?? 0) === 0 && (snapshot.songs?.length ?? 0) === 0;
}

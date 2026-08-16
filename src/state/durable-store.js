// @ts-check

// Keeps a durable copy of everything the app persists.
//
// localStorage stays the synchronous working store — every existing reader
// and writer is untouched — while this module mirrors it into a native file
// that WebKit cannot evict. On launch the mirror is read first and, when it
// holds data localStorage has lost, it is written back before any store is
// constructed.
//
// On web there is no native file, so every method degrades to a no-op and
// localStorage remains the only copy.

import { registerPlugin } from '@capacitor/core';
import { buildSnapshot, validateSnapshot, snapshotToEntries, isEmptySnapshot } from './snapshot.js';

const DataStore = /** @type {any} */ (registerPlugin('DataStore'));

const FLUSH_DEBOUNCE_MS = 800;

/** @param {{ isNativeApp: boolean }} deps */
export function createDurableStore({ isNativeApp }) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let flushTimer = null;
  let lastWritten = '';

  function readItem(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function writeItem(key, value) {
    try { localStorage.setItem(key, value); } catch { /* quota or disabled */ }
  }

  function currentJson() {
    return JSON.stringify(buildSnapshot(readItem), null, 2);
  }

  async function flushNow() {
    if (!isNativeApp) return;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    const json = currentJson();
    // buildSnapshot stamps exportedAt, so compare only the payload.
    const payload = json.replace(/"exportedAt": "[^"]*",?\n?/, '');
    if (payload === lastWritten) return;
    try {
      await DataStore.write({ json });
      lastWritten = payload;
    } catch (e) {
      console.warn('[durable] write failed', e);
    }
  }

  function markDirty() {
    if (!isNativeApp) return;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flushTimer = null; flushNow(); }, FLUSH_DEBOUNCE_MS);
  }

  /**
   * Reads the mirror and restores it when localStorage has come up empty.
   * Must run before any store reads localStorage.
   *
   * @returns {Promise<{ restored: boolean }>}
   */
  async function hydrate() {
    if (!isNativeApp) return { restored: false };
    let res;
    try {
      res = await DataStore.read();
    } catch (e) {
      console.warn('[durable] read failed', e);
      return { restored: false };
    }
    if (!res?.exists || typeof res.json !== 'string') return { restored: false };

    let parsed;
    try {
      parsed = JSON.parse(res.json);
    } catch {
      return { restored: false };
    }
    const result = validateSnapshot(parsed);
    if (!result.ok) return { restored: false };

    // Only restore when the live store has actually lost data. Overwriting
    // a populated localStorage with a stale mirror would destroy edits made
    // after the last successful flush.
    const live = buildSnapshot(readItem);
    if (!isEmptySnapshot(live) || isEmptySnapshot(result.snapshot)) {
      lastWritten = currentJson().replace(/"exportedAt": "[^"]*",?\n?/, '');
      return { restored: false };
    }

    for (const [key, value] of snapshotToEntries(result.snapshot)) {
      writeItem(key, value);
    }
    lastWritten = currentJson().replace(/"exportedAt": "[^"]*",?\n?/, '');
    return { restored: true };
  }

  /** Serialized snapshot for export. */
  function exportJson() {
    return currentJson();
  }

  /**
   * Replaces stored data with a validated snapshot.
   * @param {string} json
   * @returns {{ ok: true } | { ok: false, reason: string }}
   */
  function importJson(json) {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, reason: 'notJson' };
    }
    const result = validateSnapshot(parsed);
    if (!result.ok) return { ok: false, reason: result.reason };
    for (const [key, value] of snapshotToEntries(result.snapshot)) {
      writeItem(key, value);
    }
    flushNow();
    return { ok: true };
  }

  // Backgrounding is the last reliable moment to persist before iOS may
  // suspend or kill the app.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushNow();
  });
  window.addEventListener('pagehide', () => { flushNow(); });

  return { hydrate, markDirty, flushNow, exportJson, importJson };
}

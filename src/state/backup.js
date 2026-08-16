// @ts-check

// Backup file I/O. Native uses the share sheet and the document picker;
// web falls back to a download link and a hidden file input so the same
// buttons work in the browser build.

import { registerPlugin } from '@capacitor/core';

const DataStore = /** @type {any} */ (registerPlugin('DataStore'));

function backupFilename() {
  const stamp = new Date().toISOString().slice(0, 10);
  return `metro-beat-backup-${stamp}.json`;
}

/** @param {{ isNativeApp: boolean }} deps */
export function createBackup({ isNativeApp }) {
  /**
   * @param {string} json
   * @returns {Promise<{ ok: boolean }>}
   */
  async function save(json) {
    const filename = backupFilename();
    if (isNativeApp) {
      try {
        await DataStore.exportFile({ json, filename });
        return { ok: true };
      } catch (e) {
        console.warn('[backup] export failed', e);
        return { ok: false };
      }
    }
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      return { ok: true };
    } catch (e) {
      console.warn('[backup] download failed', e);
      return { ok: false };
    }
  }

  /** @returns {Promise<{ cancelled: boolean, json?: string }>} */
  async function load() {
    if (isNativeApp) {
      try {
        const res = await DataStore.importFile();
        if (res?.cancelled) return { cancelled: true };
        return { cancelled: false, json: String(res?.json ?? '') };
      } catch (e) {
        console.warn('[backup] import failed', e);
        return { cancelled: true };
      }
    }
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) { resolve({ cancelled: true }); return; }
        resolve({ cancelled: false, json: await file.text() });
      });
      // A cancelled picker fires no event in some browsers; a focus round
      // trip is the only signal, so resolve as cancelled if nothing lands.
      input.addEventListener('cancel', () => resolve({ cancelled: true }));
      input.click();
    });
  }

  return { save, load };
}

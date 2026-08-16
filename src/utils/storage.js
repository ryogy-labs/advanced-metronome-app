// Crash-safe localStorage helpers. Corrupt or unavailable storage falls
// back to the supplied default instead of taking the whole app down.
//
// localStorage remains the synchronous working store. A durable mirror
// (src/state/durable-store.js) registers itself here so every write also
// schedules a flush to storage WebKit cannot evict.

/** @type {(() => void) | null} */
let onChange = null;

/** @param {() => void} cb */
export function setStorageChangeListener(cb) {
  onChange = cb;
}

export function safeParseJSON(key, fallback) {
  let raw;
  try {
    raw = localStorage.getItem(key);
  } catch (e) {
    console.warn(`[storage] read failed for ${key}`, e);
    return fallback;
  }
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (e) {
    console.warn(`[storage] parse failed for ${key}; using fallback`, e);
    try {
      localStorage.setItem(`${key}.corrupt-backup`, raw);
    } catch {}
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    onChange?.();
    return true;
  } catch (e) {
    console.warn(`[storage] write failed for ${key}`, e);
    return false;
  }
}

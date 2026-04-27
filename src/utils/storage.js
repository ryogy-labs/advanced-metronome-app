// Crash-safe localStorage helpers. Corrupt or unavailable storage falls
// back to the supplied default instead of taking the whole app down.

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
    return true;
  } catch (e) {
    console.warn(`[storage] write failed for ${key}`, e);
    return false;
  }
}

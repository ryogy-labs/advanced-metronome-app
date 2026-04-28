// String-IDs for setlists / songs / library entries.
// Ms-precision plus a small random suffix avoids collisions when rapid CRUD
// happens within the same millisecond.

let _lastTs = 0;
let _seq = 0;

export function nextId() {
  const now = Date.now();
  if (now === _lastTs) {
    _seq += 1;
  } else {
    _lastTs = now;
    _seq = 0;
  }
  return _seq === 0 ? String(now) : `${now}-${_seq}`;
}

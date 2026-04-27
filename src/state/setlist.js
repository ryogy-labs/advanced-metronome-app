// Setlist store.
//
// Owns the persisted list of setlists (`localStorage` key
// `metro-setlists`). Each setlist is `{ id, name, songs: [...] }` and
// the per-song shape is owned by the host (currently `src/main.js`) —
// the store treats songs as opaque objects and just keeps them in the
// right slot. Every mutation auto-persists.
//
// The store does NOT own `currentSlId` (which setlist detail view is
// open) or any form / selection state — those are UI concerns and stay
// with the host.
//
// `all()` returns the live array. Callers can read freely (e.g. the
// render path or the `propagateLibSongChange` cross-cut that walks
// every song looking for matching `libSongId`s) but MUST go through
// the helpers for mutations so persistence stays in sync.

export function createSetlistStore({
  initial = [],
  persist,        // (setlists) => void — called on every mutation
  generateId,     // () => string — used for both setlist ids and song ids when caller omits
}) {
  let setlists = Array.isArray(initial) ? [...initial] : [];

  function flush() { persist(setlists); }

  function all() { return setlists; }
  function count() { return setlists.length; }
  function findById(slId) { return setlists.find(sl => sl.id === slId); }
  function findSong(slId, songId) {
    const sl = findById(slId);
    return sl ? sl.songs.find(s => s.id === songId) ?? null : null;
  }

  function add({ name, songs = [] } = {}) {
    const next = { id: generateId(), name, songs: [...songs] };
    setlists.push(next);
    flush();
    return next;
  }

  function update(slId, patch) {
    const target = findById(slId);
    if (!target) return null;
    Object.assign(target, patch);
    flush();
    return target;
  }

  function remove(slId) {
    const idx = setlists.findIndex(sl => sl.id === slId);
    if (idx === -1) return false;
    setlists.splice(idx, 1);
    flush();
    return true;
  }

  function reorder(srcIdx, dstIdx) {
    if (srcIdx < 0 || srcIdx >= setlists.length) return false;
    const [item] = setlists.splice(srcIdx, 1);
    setlists.splice(dstIdx, 0, item);
    flush();
    return true;
  }

  function addSong(slId, song) {
    const sl = findById(slId);
    if (!sl) return null;
    const next = { ...song };
    if (next.id == null) next.id = generateId();
    sl.songs.push(next);
    flush();
    return next;
  }

  // Mutates the existing song record in place so external references
  // (e.g. snapshots taken before the edit) stay valid.
  function updateSong(slId, songId, patch) {
    const sl = findById(slId);
    if (!sl) return null;
    const target = sl.songs.find(s => s.id === songId);
    if (!target) return null;
    Object.assign(target, patch);
    flush();
    return target;
  }

  // Replace a song slot wholesale — used when applying a library song
  // to an existing setlist song slot, where the host wants to swap the
  // record (carrying a new identity in some fields) rather than merge.
  function replaceSong(slId, songId, nextSong) {
    const sl = findById(slId);
    if (!sl) return null;
    const idx = sl.songs.findIndex(s => s.id === songId);
    if (idx === -1) return null;
    sl.songs[idx] = nextSong;
    flush();
    return nextSong;
  }

  function removeSong(slId, songId) {
    const sl = findById(slId);
    if (!sl) return false;
    const idx = sl.songs.findIndex(s => s.id === songId);
    if (idx === -1) return false;
    sl.songs.splice(idx, 1);
    flush();
    return true;
  }

  function reorderSongs(slId, srcIdx, dstIdx) {
    const sl = findById(slId);
    if (!sl) return false;
    if (srcIdx < 0 || srcIdx >= sl.songs.length) return false;
    const [item] = sl.songs.splice(srcIdx, 1);
    sl.songs.splice(dstIdx, 0, item);
    flush();
    return true;
  }

  return {
    all, count, findById, findSong,
    add, update, remove, reorder,
    addSong, updateSong, replaceSong, removeSong, reorderSongs,
  };
}

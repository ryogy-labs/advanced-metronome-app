// Song-library store.
//
// Owns the persisted list of library songs (`localStorage` key
// `metro-song-lib`) and the current sort mode (`'manual' | 'name' |
// 'bpm'`). Exposes a small CRUD + query API; every mutation
// auto-persists. The store does NOT own UI selection state
// (`activeLibSongId`), form state (`editingLibId`,
// `libFormBeatVolumes`, `libFormBeatStates`), or DOM rendering — those
// live with the host (currently src/main.js).
//
// Songs are plain objects:
//   { id, name, bpm, tsNum, tsDen, beatVolumes, beatStates, swingMode, swingAmount }
// The `add()` helper assigns an `id` if one isn't supplied.
//
// `all()` returns the *live* array. Callers can iterate and `.find()`
// freely, but MUST go through `update` / `remove` / `reorder` for
// mutations so persistence stays in sync. `propagateLibSongChange`
// (cross-cuts the setlist store) intentionally stays out of scope here.

export function createSongLibraryStore({
  initial = [],
  persist,           // (songLibrary) => void — called on every mutation
  initialSortMode = 'manual',
  generateId,        // () => string — used by add() when caller omits id
}) {
  let songs = Array.isArray(initial) ? [...initial] : [];
  let sortMode = initialSortMode;

  function flush() { persist(songs); }

  function all() { return songs; }
  function count() { return songs.length; }
  function findById(id) { return songs.find(s => s.id === id); }

  function add(song) {
    const next = { ...song };
    if (next.id == null) next.id = generateId();
    songs.push(next);
    flush();
    return next;
  }

  // Mutates the existing record in place so external references
  // (e.g. `linkedLibSong` snapshots) stay valid; returns the merged
  // song or null if nothing matched.
  function update(id, patch) {
    const target = songs.find(s => s.id === id);
    if (!target) return null;
    Object.assign(target, patch);
    flush();
    return target;
  }

  function remove(id) {
    const idx = songs.findIndex(s => s.id === id);
    if (idx === -1) return false;
    songs.splice(idx, 1);
    flush();
    return true;
  }

  // Manual reorder. Caller is responsible for guarding against
  // sortMode !== 'manual' (the UI hides the drag handle in that case,
  // but defensive callers may want to double-check).
  function reorder(srcIdx, dstIdx) {
    if (srcIdx < 0 || srcIdx >= songs.length) return false;
    const [item] = songs.splice(srcIdx, 1);
    songs.splice(dstIdx, 0, item);
    flush();
    return true;
  }

  function sortedForDisplay() {
    if (sortMode === 'name') {
      return [...songs].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sortMode === 'bpm') {
      return [...songs].sort((a, b) => a.bpm - b.bpm || a.name.localeCompare(b.name));
    }
    return songs;
  }

  function getSortMode() { return sortMode; }
  function setSortMode(mode) {
    sortMode = mode;
    // Sort mode itself isn't persisted (matches prior behavior — it's
    // a session UI preference, not a library property).
  }

  return {
    all, count, findById,
    add, update, remove, reorder,
    sortedForDisplay,
    getSortMode, setSortMode,
  };
}

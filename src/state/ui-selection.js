// @ts-check

export function createUiSelection() {
  /** @type {{
   *   currentSetlistId: string | null,
   *   activeSongId: string | null,
   *   activeSetlistId: string | null,
   *   activeLibrarySongId: string | null,
   *   editingSetlistId: string | null,
   *   editingSongId: string | null,
   *   editingLibrarySongId: string | null,
   * }}
   */
  const state = {
    currentSetlistId: null,
    activeSongId: null,
    activeSetlistId: null,
    activeLibrarySongId: null,
    editingSetlistId: null,
    editingSongId: null,
    editingLibrarySongId: null,
  };

  return {
    get currentSetlistId() { return state.currentSetlistId; },
    /** @param {string} id */
    setCurrentSetlist(id) { state.currentSetlistId = id; },

    get activeSongId() { return state.activeSongId; },
    get activeSetlistId() { return state.activeSetlistId; },
    get activeLibrarySongId() { return state.activeLibrarySongId; },
    hasActiveSong() { return Boolean(state.activeSongId || state.activeLibrarySongId); },
    /** @param {string} setlistId @param {string} songId */
    activateSetlistSong(setlistId, songId) {
      state.activeSongId = songId;
      state.activeSetlistId = setlistId;
      state.activeLibrarySongId = null;
    },
    /** @param {string} songId */
    activateLibrarySong(songId) {
      state.activeLibrarySongId = songId;
      state.activeSongId = null;
      state.activeSetlistId = null;
    },
    /** @param {string} setlistId */
    clearActiveSetlist(setlistId) {
      if (state.activeSetlistId !== setlistId) return false;
      state.activeSongId = null;
      state.activeSetlistId = null;
      return true;
    },
    /** @param {string} songId */
    clearActiveSong(songId) {
      if (state.activeSongId !== songId) return false;
      state.activeSongId = null;
      return true;
    },
    /** @param {string} songId */
    clearActiveLibrarySong(songId) {
      if (state.activeLibrarySongId !== songId) return false;
      state.activeLibrarySongId = null;
      return true;
    },

    get editingSetlistId() { return state.editingSetlistId; },
    /** @param {string} id */
    startEditingSetlist(id) { state.editingSetlistId = id; },
    clearEditingSetlist() { state.editingSetlistId = null; },

    get editingSongId() { return state.editingSongId; },
    /** @param {string} id */
    startEditingSong(id) { state.editingSongId = id; },
    clearEditingSong() { state.editingSongId = null; },

    get editingLibrarySongId() { return state.editingLibrarySongId; },
    /** @param {string} id */
    startEditingLibrarySong(id) { state.editingLibrarySongId = id; },
    clearEditingLibrarySong() { state.editingLibrarySongId = null; },
  };
}

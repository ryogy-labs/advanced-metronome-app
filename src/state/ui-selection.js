export function createUiSelection() {
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
    setCurrentSetlist(id) { state.currentSetlistId = id; },

    get activeSongId() { return state.activeSongId; },
    get activeSetlistId() { return state.activeSetlistId; },
    get activeLibrarySongId() { return state.activeLibrarySongId; },
    hasActiveSong() { return Boolean(state.activeSongId || state.activeLibrarySongId); },
    activateSetlistSong(setlistId, songId) {
      state.activeSongId = songId;
      state.activeSetlistId = setlistId;
      state.activeLibrarySongId = null;
    },
    activateLibrarySong(songId) {
      state.activeLibrarySongId = songId;
      state.activeSongId = null;
      state.activeSetlistId = null;
    },
    clearActiveSetlist(setlistId) {
      if (state.activeSetlistId !== setlistId) return false;
      state.activeSongId = null;
      state.activeSetlistId = null;
      return true;
    },
    clearActiveSong(songId) {
      if (state.activeSongId !== songId) return false;
      state.activeSongId = null;
      return true;
    },
    clearActiveLibrarySong(songId) {
      if (state.activeLibrarySongId !== songId) return false;
      state.activeLibrarySongId = null;
      return true;
    },

    get editingSetlistId() { return state.editingSetlistId; },
    startEditingSetlist(id) { state.editingSetlistId = id; },
    clearEditingSetlist() { state.editingSetlistId = null; },

    get editingSongId() { return state.editingSongId; },
    startEditingSong(id) { state.editingSongId = id; },
    clearEditingSong() { state.editingSongId = null; },

    get editingLibrarySongId() { return state.editingLibrarySongId; },
    startEditingLibrarySong(id) { state.editingLibrarySongId = id; },
    clearEditingLibrarySong() { state.editingLibrarySongId = null; },
  };
}

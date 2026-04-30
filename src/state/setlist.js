// @ts-check

import { withSongDefaults } from './song-config.js';

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

/**
 * @typedef {import('./song-config.js').SongConfigInput} SongConfigInput
 * @typedef {import('./song-config.js').SongConfig} SongConfig
 * @typedef {SongConfigInput & { id?: string, name?: string, libSongId?: string | null }} SetlistSongInput
 * @typedef {SongConfig & { id: string, name: string, libSongId?: string | null }} SetlistSong
 * @typedef {{ id: string, name: string, songs: SetlistSong[] }} Setlist
 * @typedef {{ name?: string, songs?: SetlistSongInput[] }} SetlistInput
 * @typedef {{ name?: string, songs?: SetlistSong[] }} SetlistPatch
 * @typedef {Partial<SetlistSongInput>} SetlistSongPatch
 */

/**
 * @param {{
 *   initial?: Setlist[],
 *   persist: (setlists: Setlist[]) => void,
 *   generateId: () => string,
 * }} options
 */
export function createSetlistStore({
  initial = [],
  persist,        // (setlists) => void — called on every mutation
  generateId,     // () => string — used for both setlist ids and song ids when caller omits
}) {
  let setlists = Array.isArray(initial) ? [...initial] : [];

  function flush() { persist(setlists); }

  /** @returns {Setlist[]} */
  function all() { return setlists; }
  function count() { return setlists.length; }
  /** @param {string} slId */
  function findById(slId) { return setlists.find(sl => sl.id === slId); }
  /** @param {string} slId @param {string} songId */
  function findSong(slId, songId) {
    const sl = findById(slId);
    return sl ? sl.songs.find(s => s.id === songId) ?? null : null;
  }

  /** @param {SetlistInput} [input] */
  function add({ name, songs = [] } = {}) {
    /** @type {Setlist} */
    const next = { id: generateId(), name: name ?? '', songs: songs.map(song => normalizeSong(song)) };
    setlists.push(next);
    flush();
    return next;
  }

  /** @param {string} slId @param {SetlistPatch} patch */
  function update(slId, patch) {
    const target = findById(slId);
    if (!target) return null;
    Object.assign(target, patch);
    flush();
    return target;
  }

  /** @param {string} slId */
  function remove(slId) {
    const idx = setlists.findIndex(sl => sl.id === slId);
    if (idx === -1) return false;
    setlists.splice(idx, 1);
    flush();
    return true;
  }

  /** @param {number} srcIdx @param {number} dstIdx */
  function reorder(srcIdx, dstIdx) {
    if (srcIdx < 0 || srcIdx >= setlists.length) return false;
    const [item] = setlists.splice(srcIdx, 1);
    setlists.splice(dstIdx, 0, item);
    flush();
    return true;
  }

  /** @param {string} slId @param {SetlistSongInput} song */
  function addSong(slId, song) {
    const sl = findById(slId);
    if (!sl) return null;
    const next = normalizeSong(song);
    if (next.id == null) next.id = generateId();
    sl.songs.push(next);
    flush();
    return next;
  }

  // Mutates the existing song record in place so external references
  // (e.g. snapshots taken before the edit) stay valid.
  /** @param {string} slId @param {string} songId @param {SetlistSongPatch} patch */
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
  /** @param {string} slId @param {string} songId @param {SetlistSong} nextSong */
  function replaceSong(slId, songId, nextSong) {
    const sl = findById(slId);
    if (!sl) return null;
    const idx = sl.songs.findIndex(s => s.id === songId);
    if (idx === -1) return null;
    sl.songs[idx] = nextSong;
    flush();
    return nextSong;
  }

  /** @param {string} slId @param {string} songId */
  function removeSong(slId, songId) {
    const sl = findById(slId);
    if (!sl) return false;
    const idx = sl.songs.findIndex(s => s.id === songId);
    if (idx === -1) return false;
    sl.songs.splice(idx, 1);
    flush();
    return true;
  }

  /** @param {string} slId @param {number} srcIdx @param {number} dstIdx */
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

  /** @param {SetlistSongInput} song @returns {SetlistSong} */
  function normalizeSong(song) {
    return {
      ...song,
      ...withSongDefaults(song),
      id: song.id ?? generateId(),
      name: song.name ?? '',
    };
  }
}

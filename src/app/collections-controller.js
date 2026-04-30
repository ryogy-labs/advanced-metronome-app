// @ts-check

import {
  BPM_MIN, BPM_MAX,
  FREE_SETLIST_LIMIT, FREE_SONGS_PER_SETLIST, FREE_LIBRARY_LIMIT,
  LS_KEYS,
} from '../config.js';
import { safeParseJSON, writeJSON } from '../utils/storage.js';
import { nextId } from '../utils/id.js';
import { setupDnD } from '../ui/dnd.js';
import { renderSongRows, setActiveRow } from '../ui/song-row.js';
import { renderSetlistRows } from '../ui/setlist-row.js';
import { renderLibraryPicker } from '../ui/library-picker.js';
import { createNowPlaying } from '../ui/now-playing.js';
import { mountTsPicker, setTsPickerValues } from '../ui/ts-picker.js';
import { createSongForm } from '../ui/song-form.js';
import { createSongLibraryStore } from '../state/song-library.js';
import { createSetlistStore } from '../state/setlist.js';
import { withSongDefaults } from '../state/song-config.js';
import { createUiSelection } from '../state/ui-selection.js';

/**
 * @typedef {import('../state/song-config.js').SongConfig} SongConfig
 * @typedef {import('../state/setlist.js').SetlistSong} SetlistSong
 * @typedef {import('../state/song-library.js').LibrarySong} LibrarySong
 * @typedef {import('../ui/song-form.js').SongFormValues} SongFormValues
 */

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
function byId(id) {
  return /** @type {T} */ (document.getElementById(id));
}

/**
 * @param {{
 *   t: (key: string) => string,
 *   metronome: {
 *     bpm: number,
 *     tsNum: number,
 *     tsDen: number,
 *     swingMode: import('../state/song-config.js').SwingMode,
 *     swingAmount: number,
 *     running: boolean,
 *     startMetronome: () => void,
 *     stopMetronome: () => void,
 *     togglePlayback: () => void,
 *     applySongConfig: (songCfg: SongConfig) => void,
 *     currentBeatVolumes: () => import('../state/song-config.js').BeatVolumes,
 *     currentBeatStates: () => import('../state/song-config.js').BeatState[],
 *     currentSwing: () => { swingMode: import('../state/song-config.js').SwingMode, swingAmount: number },
 *     getSubdivisionVolumeLabels: (den: number) => { quarter: string, eighth: string, sixteenth: string },
 *   },
 *   paywall: {
 *     isPro: () => boolean,
 *     requirePro: (onGranted: () => void) => void,
 *   },
 * }} deps
 */
export function createCollectionsController({ t, metronome, paywall }) {
  const setlistStore = createSetlistStore({
    initial: safeParseJSON(LS_KEYS.setlists, []),
    persist: (setlists) => writeJSON(LS_KEYS.setlists, setlists),
    generateId: nextId,
  });
  const songLibraryStore = createSongLibraryStore({
    initial: safeParseJSON(LS_KEYS.songLib, []),
    persist: (songs) => writeJSON(LS_KEYS.songLib, songs),
    generateId: nextId,
  });
  const selection = createUiSelection();

  const slIndexEl = byId('slIndex');
  const slDetailEl = byId('slDetail');
  const slDetailTitle = byId('slDetailTitle');
  const slIndexList = byId('slIndexList');
  const slForm = byId('slForm');
  const slNameInput = /** @type {HTMLInputElement} */ (byId('slName'));
  const songList = byId('songList');
  const presetForm = byId('presetForm');
  const pfModeManual = byId('pfModeManual');
  const pfModeLib = byId('pfModeLib');
  const pfManual = byId('pfManual');
  const pfLibPicker = byId('pfLibPicker');
  const pfLibList = byId('pfLibList');
  const libSongList = byId('libSongList');
  const libForm = byId('libForm');
  const libSortManualBtn = byId('libSortManual');
  const libSortNameBtn = byId('libSortName');
  const libSortBpmBtn = byId('libSortBpm');

  const nowPlaying = createNowPlaying({
    els: [
      byId('nowPlaying'),
      byId('nowPlayingLib'),
    ].filter(Boolean),
    onTogglePlayback: () => {
      if (!selection.hasActiveSong()) return;
      metronome.togglePlayback();
    },
  });

  /** @type {ReturnType<typeof createSongForm>} */
  let pfSongForm;

  function currentSetlist() {
    const id = selection.currentSetlistId;
    return id ? setlistStore.findById(id) : null;
  }

  function updateNowPlayingState() {
    nowPlaying.setPlaybackState(metronome.running);
  }

  function getNowPlayingSong() {
    if (selection.activeSongId && selection.activeSetlistId) {
      const p = setlistStore.findSong(selection.activeSetlistId, selection.activeSongId);
      if (p) return { name: p.name || t('untitled'), bpm: p.bpm };
    }
    if (selection.activeLibrarySongId) {
      const s = songLibraryStore.findById(selection.activeLibrarySongId);
      if (s) return { name: s.name || t('untitled'), bpm: s.bpm };
    }
    return { name: '', bpm: null };
  }

  function updateNowPlaying() {
    nowPlaying.render({ ...getNowPlayingSong(), running: metronome.running });
  }

  function showSlIndex() {
    slIndexEl.classList.add('active');
    slDetailEl.classList.remove('active');
    closeSlForm();
    closeSongForm();
    renderSetlists();
  }

  function showSlDetail(slId) {
    const sl = setlistStore.findById(slId);
    if (!sl) return;
    selection.setCurrentSetlist(slId);
    slDetailTitle.textContent = sl.name;
    slIndexEl.classList.remove('active');
    slDetailEl.classList.add('active');
    closeSongForm();
    renderSongs();
  }

  function renderSetlists() {
    renderSetlistRows({
      listEl: slIndexList,
      setlists: setlistStore.all(),
      emptyText: t('empty.noSetlists'),
      songsCountText: t('label.songsCount'),
      editTitle: t('action.edit'),
      deleteTitle: t('action.delete'),
      onOpen: showSlDetail,
      onEdit: openEditSlForm,
      onDelete: deleteSetlist,
    });
  }

  function openAddSlForm() {
    selection.clearEditingSetlist();
    slNameInput.value = '';
    slForm.style.display = 'block';
    slNameInput.focus();
  }

  function openEditSlForm(id) {
    const sl = setlistStore.findById(id);
    if (!sl) return;
    selection.startEditingSetlist(id);
    slNameInput.value = sl.name;
    slForm.style.display = 'block';
    slNameInput.focus();
  }

  function closeSlForm() {
    selection.clearEditingSetlist();
    if (slForm) slForm.style.display = 'none';
  }

  function saveSlForm() {
    const name = slNameInput.value.trim();
    if (!name) { slNameInput.focus(); return; }
    const editingSetlistId = selection.editingSetlistId;
    if (editingSetlistId) {
      const sl = setlistStore.update(editingSetlistId, { name });
      if (sl && selection.currentSetlistId === editingSetlistId) {
        slDetailTitle.textContent = name;
      }
    } else {
      setlistStore.add({ name });
    }
    closeSlForm();
    renderSetlists();
  }

  function deleteSetlist(id) {
    if (!confirm(t('confirm.deleteSetlist'))) return;
    setlistStore.remove(id);
    if (selection.clearActiveSetlist(id)) updateNowPlaying();
    renderSetlists();
  }

  function renderSongs() {
    const sl = currentSetlist();
    if (!sl) return;
    renderSongRows({
      listEl: songList,
      items: sl.songs,
      activeId: selection.activeSongId,
      emptyText: t('empty.noSongs'),
      untitledText: t('untitled'),
      editTitle: t('action.edit'),
      deleteTitle: t('action.delete'),
      showTrackNumber: true,
      showDragHandle: true,
      editAction: 'edit',
      deleteAction: 'del',
      onApply: applySong,
      onEdit: openEditSongForm,
      onDelete: deleteSong,
    });
  }

  /** @param {SongConfig} songCfg */
  function restartOrStopSameSong(songCfg) {
    if (metronome.running) {
      metronome.stopMetronome();
      return;
    }
    metronome.applySongConfig(songCfg);
    metronome.startMetronome();
  }

  /** @param {string} id */
  function applySong(id) {
    const sl = currentSetlist();
    if (!sl) return;
    const p = sl.songs.find(s => s.id === id);
    if (!p) return;
    const linkedLibSongId = p.libSongId ?? null;
    const linkedLibSong = linkedLibSongId
      ? songLibraryStore.findById(linkedLibSongId)
      : null;
    const songCfg = withSongDefaults(p, linkedLibSong);
    if (selection.activeSongId === id) {
      restartOrStopSameSong(songCfg);
      return;
    }
    selection.activateSetlistSong(sl.id, id);
    metronome.applySongConfig(songCfg);
    setActiveRow(songList, id);
    updateNowPlaying();
    metronome.startMetronome();
  }

  /** @param {string} id */
  function applyLibrarySong(id) {
    const s = songLibraryStore.findById(id);
    if (!s) return;
    const songCfg = withSongDefaults(s);
    if (selection.activeLibrarySongId === id) {
      restartOrStopSameSong(songCfg);
      return;
    }
    selection.activateLibrarySong(id);
    metronome.applySongConfig(songCfg);
    setActiveRow(libSongList, id);
    updateNowPlaying();
    metronome.startMetronome();
  }

  function openAddSongForm() {
    selection.clearEditingSong();
    setFormMode('library');
    pfSongForm.open({ bpm: metronome.bpm });
    presetForm.style.display = 'block';
    pfSongForm.focusName();
  }

  /** @param {string} id */
  function openEditSongForm(id) {
    const sl = currentSetlist();
    if (!sl) return;
    const p = sl.songs.find(s => s.id === id);
    if (!p) return;
    selection.startEditingSong(id);
    setFormMode('manual');
    pfSongForm.open({
      name: p.name,
      ...withSongDefaults(p),
    });
    presetForm.style.display = 'block';
    pfSongForm.focusName();
  }

  function closeSongForm() {
    selection.clearEditingSong();
    pfSongForm?.close();
    if (presetForm) presetForm.style.display = 'none';
  }

  /** @param {SongFormValues} values */
  function commitSongForm(values) {
    const sl = currentSetlist();
    if (!sl) return;
    const editingSongId = selection.editingSongId;
    if (editingSongId) {
      const updated = setlistStore.updateSong(sl.id, editingSongId, {
        ...values,
        libSongId: null,
      });
      if (updated && selection.activeSongId === editingSongId) {
        metronome.applySongConfig(withSongDefaults(values));
        updateNowPlaying();
      }
    } else {
      // Route through withSongDefaults so the store always holds a
      // fully-populated song. The form's readValues() already defaults
      // swingMode/swingAmount today, but normalizing both store-write
      // paths the same way keeps the "store always holds normalized
      // records" invariant honest if a future field is added to the
      // schema before the form learns it.
      setlistStore.addSong(sl.id, { ...values, ...withSongDefaults(values), libSongId: null });
    }
    closeSongForm();
    renderSongs();
  }

  function deleteSong(id) {
    const sl = currentSetlist();
    if (!sl) return;
    if (!confirm(t('confirm.deleteSong'))) return;
    setlistStore.removeSong(sl.id, id);
    if (selection.clearActiveSong(id)) updateNowPlaying();
    renderSongs();
  }

  function setFormMode(mode) {
    const isManual = mode === 'manual';
    pfManual.style.display = isManual ? '' : 'none';
    pfLibPicker.style.display = isManual ? 'none' : '';
    pfModeManual.classList.toggle('active', isManual);
    pfModeLib.classList.toggle('active', !isManual);
    if (!isManual) renderLibPicker();
  }

  function renderLibPicker() {
    renderLibraryPicker({
      listEl: pfLibList,
      songs: songLibraryStore.sortedForDisplay(),
      emptyText: t('empty.noLibrarySongs'),
      onPick: pickFromLibrary,
    });
  }

  /** @param {string} libId */
  function pickFromLibrary(libId) {
    const libSong = songLibraryStore.findById(libId);
    if (!libSong) return;
    const sl = currentSetlist();
    if (!sl) return;
    const values = {
      name: libSong.name,
      ...withSongDefaults(libSong),
      libSongId: libSong.id,
    };
    const editingSongId = selection.editingSongId;
    if (editingSongId) {
      const updated = setlistStore.updateSong(sl.id, editingSongId, values);
      if (updated && selection.activeSongId === editingSongId) {
        metronome.applySongConfig(values);
        updateNowPlaying();
      }
    } else {
      setlistStore.addSong(sl.id, values);
    }
    closeSongForm();
    renderSongs();
  }

  /** @param {SongConfig} song */
  function applyPreset(song) {
    metronome.applySongConfig(withSongDefaults(song));
  }

  /** @param {LibrarySong} libSong */
  function propagateLibSongChange(libSong) {
    let changed = false;
    setlistStore.all().forEach(sl => {
      sl.songs.forEach(song => {
        if ((song.libSongId ?? null) !== libSong.id) return;
        const nextSong = {
          ...song,
          name: libSong.name,
          ...withSongDefaults(libSong),
        };
        setlistStore.replaceSong(sl.id, song.id, nextSong);
        if (selection.activeSongId === song.id) {
          applyPreset(nextSong);
          updateNowPlaying();
        }
        changed = true;
      });
    });
    if (changed && slDetailEl.classList.contains('active')) renderSongs();
  }

  function setLibrarySortMode(mode) {
    songLibraryStore.setSortMode(mode);
    libSortManualBtn.classList.toggle('active', mode === 'manual');
    libSortNameBtn.classList.toggle('active', mode === 'name');
    libSortBpmBtn.classList.toggle('active', mode === 'bpm');
    renderLibrary();
    if (pfModeLib.classList.contains('active')) renderLibPicker();
  }

  function renderLibrary() {
    renderSongRows({
      listEl: libSongList,
      items: songLibraryStore.sortedForDisplay(),
      activeId: selection.activeLibrarySongId,
      emptyText: t('empty.noSongs'),
      editTitle: t('action.edit'),
      deleteTitle: t('action.delete'),
      showTrackNumber: false,
      showDragHandle: songLibraryStore.getSortMode() === 'manual',
      editAction: 'edit-lib',
      deleteAction: 'del-lib',
      onApply: applyLibrarySong,
      onEdit: openEditLibForm,
      onDelete: deleteLibSong,
    });
  }

  const libSongForm = createSongForm({
    prefix: 'lib',
    t,
    mountTsPicker,
    setTsPickerValues,
    bpmRange: { min: BPM_MIN, max: BPM_MAX },
    getCurrentBpm: () => metronome.bpm,
    getSubdivisionVolumeLabels: metronome.getSubdivisionVolumeLabels,
    onSave: commitLibForm,
    onCancel: closeLibForm,
    onCaptureRequest: () => {
      paywall.requirePro(() => {
        libSongForm.applyCapture({
          bpm: metronome.bpm,
          tsNum: metronome.tsNum,
          tsDen: metronome.tsDen,
          beatVolumes: metronome.currentBeatVolumes(),
          beatStates: metronome.currentBeatStates(),
          ...metronome.currentSwing(),
        });
      });
    },
  });

  function openAddLibForm() {
    selection.clearEditingLibrarySong();
    libSongForm.open({ bpm: metronome.bpm, tsNum: 4, tsDen: 4 });
    libForm.style.display = 'block';
    libSongForm.focusName();
  }

  /** @param {string} id */
  function openEditLibForm(id) {
    const s = songLibraryStore.findById(id);
    if (!s) return;
    selection.startEditingLibrarySong(id);
    libSongForm.open({
      name: s.name,
      ...withSongDefaults(s),
    });
    libForm.style.display = 'block';
    libSongForm.focusName();
  }

  function closeLibForm() {
    selection.clearEditingLibrarySong();
    libSongForm.close();
    libForm.style.display = 'none';
  }

  /** @param {SongFormValues} values */
  function commitLibForm(values) {
    // Normalize on write so the library store mirrors the setlist
    // store invariant ("records are always fully populated") — see
    // commitSongForm above for the rationale.
    const normalized = { ...values, ...withSongDefaults(values) };
    let editedSong = null;
    const editingLibrarySongId = selection.editingLibrarySongId;
    if (editingLibrarySongId) {
      editedSong = songLibraryStore.update(editingLibrarySongId, normalized);
    } else {
      songLibraryStore.add(normalized);
    }
    if (editedSong) propagateLibSongChange(editedSong);
    closeLibForm();
    renderLibrary();
  }

  function deleteLibSong(id) {
    if (!confirm(t('confirm.deleteLibrarySong'))) return;
    const clearedActive = selection.clearActiveLibrarySong(id);
    songLibraryStore.remove(id);
    renderLibrary();
    if (clearedActive) updateNowPlaying();
  }

  pfSongForm = createSongForm({
    prefix: 'pf',
    t,
    mountTsPicker,
    setTsPickerValues,
    bpmRange: { min: BPM_MIN, max: BPM_MAX },
    getCurrentBpm: () => metronome.bpm,
    getSubdivisionVolumeLabels: metronome.getSubdivisionVolumeLabels,
    onSave: commitSongForm,
    onCancel: closeSongForm,
    onCaptureRequest: () => {
      paywall.requirePro(() => {
        pfSongForm.applyCapture({
          bpm: metronome.bpm,
          tsNum: metronome.tsNum,
          tsDen: metronome.tsDen,
          beatVolumes: metronome.currentBeatVolumes(),
          beatStates: metronome.currentBeatStates(),
          ...metronome.currentSwing(),
        });
      });
    },
  });

  byId('btnAddSetlist').addEventListener('click', () => {
    if (setlistStore.count() >= FREE_SETLIST_LIMIT && !paywall.isPro()) {
      paywall.requirePro(() => openAddSlForm());
    } else {
      openAddSlForm();
    }
  });
  byId('slSave').addEventListener('click', saveSlForm);
  byId('slCancel').addEventListener('click', closeSlForm);
  slNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveSlForm(); });
  byId('btnBack').addEventListener('click', showSlIndex);
  byId('btnAddSong').addEventListener('click', () => {
    const sl = currentSetlist();
    const currentSongs = sl ? sl.songs : [];
    if (currentSongs.length >= FREE_SONGS_PER_SETLIST && !paywall.isPro()) {
      paywall.requirePro(() => openAddSongForm());
    } else {
      openAddSongForm();
    }
  });
  pfModeManual.addEventListener('click', () => setFormMode('manual'));
  pfModeLib.addEventListener('click', () => setFormMode('library'));
  byId('pfLibPickerCancel').addEventListener('click', closeSongForm);
  byId('btnAddLibSong').addEventListener('click', () => {
    if (songLibraryStore.count() >= FREE_LIBRARY_LIMIT && !paywall.isPro()) {
      paywall.requirePro(() => openAddLibForm());
    } else {
      openAddLibForm();
    }
  });
  libSortManualBtn.addEventListener('click', () => setLibrarySortMode('manual'));
  libSortNameBtn.addEventListener('click', () => setLibrarySortMode('name'));
  libSortBpmBtn.addEventListener('click', () => setLibrarySortMode('bpm'));

  setupDnD(songList, '.preset-row', '.drag-handle', (srcIdx, at) => {
    const sl = currentSetlist();
    if (!sl) return;
    setlistStore.reorderSongs(sl.id, srcIdx, at);
    renderSongs();
  });
  setupDnD(slIndexList, '.sl-row', '.drag-handle', (srcIdx, at) => {
    setlistStore.reorder(srcIdx, at);
    renderSetlists();
  });
  setupDnD(libSongList, '.preset-row', '.drag-handle', (srcIdx, at) => {
    if (songLibraryStore.getSortMode() !== 'manual') return;
    songLibraryStore.reorder(srcIdx, at);
    renderLibrary();
  });

  function init() {
    showSlIndex();
    updateNowPlaying();
    renderLibrary();
  }

  function applyI18n() {
    renderSetlists();
    if (slDetailEl.classList.contains('active')) renderSongs();
    renderLibrary();
    if (pfModeLib.classList.contains('active')) renderLibPicker();
    updateNowPlaying();
  }

  function refreshForProChange() {
    renderLibrary();
    renderSetlists();
  }

  return {
    init,
    renderLibrary,
    updateNowPlayingState,
    applyI18n,
    refreshForProChange,
  };
}

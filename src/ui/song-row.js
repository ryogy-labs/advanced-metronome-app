// Shared row renderer for setlist songs and library songs.
//
// Both lists share the same visual structure (apply button, BPM, time
// signature, edit + delete icons) but differ in:
//   - whether to show a track number (setlist) or not (library)
//   - whether to show a drag handle (always for setlist; only in manual
//     sort mode for library)
//   - the click handlers and their data-action keys
//
// renderSongRows centralizes the markup + listener wiring; callers pass a
// description of the list and the per-action callbacks.

import { getSongTimeSignature } from '../state/song-config.js';

export function renderSongRows({
  listEl,
  items,
  activeId,
  emptyText,
  untitledText,
  editTitle,
  deleteTitle,
  showTrackNumber = false,
  showDragHandle = true,
  editAction,        // data-action attribute used for the edit button
  deleteAction,      // data-action attribute used for the delete button
  onApply,           // (id) => void
  onEdit,            // (id) => void
  onDelete,          // (id) => void
}) {
  if (!items.length) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'setlist-empty';
    emptyEl.textContent = emptyText;
    listEl.replaceChildren(emptyEl);
    return;
  }

  reconcileSongRows({
    listEl,
    items,
    activeId,
    untitledText,
    editTitle,
    deleteTitle,
    showTrackNumber,
    showDragHandle,
    editAction,
    deleteAction,
    onApply,
    onEdit,
    onDelete,
  });
}

function reconcileSongRows({
  listEl,
  items,
  activeId,
  untitledText,
  editTitle,
  deleteTitle,
  showTrackNumber,
  showDragHandle,
  editAction,
  deleteAction,
  onApply,
  onEdit,
  onDelete,
}) {
  const existingRows = new Map(
    Array.from(listEl.children)
      .filter(el => el.classList.contains('preset-row'))
      .map(row => [row.dataset.id, row])
  );

  items.forEach((item, idx) => {
    const id = String(item.id);
    let row = existingRows.get(id);
    if (!row) {
      row = document.createElement('div');
      row.className = 'preset-row';
      row.dataset.id = id;
    }
    existingRows.delete(id);
    updateSongRow(row, {
      item,
      idx,
      activeId,
      untitledText,
      editTitle,
      deleteTitle,
      showTrackNumber,
      showDragHandle,
      editAction,
      deleteAction,
      onApply,
      onEdit,
      onDelete,
    });
    listEl.appendChild(row);
  });

  existingRows.forEach(row => row.remove());
}

function updateSongRow(row, {
  item,
  idx,
  activeId,
  untitledText,
  editTitle,
  deleteTitle,
  showTrackNumber,
  showDragHandle,
  editAction,
  deleteAction,
  onApply,
  onEdit,
  onDelete,
}) {
  const id = String(item.id);
  const { tsNum, tsDen } = getSongTimeSignature(item);
  const nameText = item.name || untitledText || '';
  const rowSignature = JSON.stringify({
    id,
    idx,
    name: item.name,
    bpm: item.bpm,
    tsNum,
    tsDen,
    untitledText,
    editTitle,
    deleteTitle,
    showTrackNumber,
    showDragHandle,
    editAction,
    deleteAction,
  });

  row.dataset.id = id;
  row.dataset.idx = String(idx);
  row.classList.toggle('active', activeId === id);
  if (row.dataset.signature === rowSignature) {
    bindSongRowHandlers(row, { id, editAction, deleteAction, onApply, onEdit, onDelete });
    return;
  }
  row.dataset.signature = rowSignature;

  const children = [];
  if (showDragHandle) {
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.textContent = '⠿';
    children.push(handle);
  }

  const applyBtn = document.createElement('button');
  applyBtn.className = 'preset-apply';
  applyBtn.dataset.id = id;

  if (showTrackNumber) {
    const num = document.createElement('span');
    num.className = 'preset-num';
    num.textContent = String(idx + 1);
    applyBtn.appendChild(num);
  }

  const name = document.createElement('span');
  name.className = 'preset-name';
  name.textContent = nameText;
  applyBtn.appendChild(name);

  const bpm = document.createElement('span');
  bpm.className = 'preset-bpm';
  bpm.textContent = `${item.bpm} BPM`;
  applyBtn.appendChild(bpm);

  const ts = document.createElement('span');
  ts.className = 'preset-ts';
  ts.textContent = `${tsNum}/${tsDen}`;
  applyBtn.appendChild(ts);
  children.push(applyBtn);

  const editBtn = document.createElement('button');
  editBtn.className = 'preset-icon-btn';
  editBtn.dataset.id = id;
  editBtn.dataset.action = editAction;
  editBtn.title = editTitle;
  editBtn.setAttribute('aria-label', `${nameText} ${editTitle}`.trim());
  editBtn.textContent = '✏';
  children.push(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'preset-icon-btn del';
  deleteBtn.dataset.id = id;
  deleteBtn.dataset.action = deleteAction;
  deleteBtn.title = deleteTitle;
  deleteBtn.setAttribute('aria-label', `${nameText} ${deleteTitle}`.trim());
  deleteBtn.textContent = '✕';
  children.push(deleteBtn);

  row.replaceChildren(...children);
  bindSongRowHandlers(row, { id, editAction, deleteAction, onApply, onEdit, onDelete });
}

function bindSongRowHandlers(row, { id, editAction, deleteAction, onApply, onEdit, onDelete }) {
  const applyBtn = row.querySelector('.preset-apply');
  const editBtn = row.querySelector(`[data-action="${editAction}"]`);
  const deleteBtn = row.querySelector(`[data-action="${deleteAction}"]`);
  if (applyBtn) applyBtn.onclick = () => onApply(id);
  if (editBtn) editBtn.onclick = () => onEdit(id);
  if (deleteBtn) deleteBtn.onclick = () => onDelete(id);
}

// Selection-only update: toggles the `.active` class on rows in `listEl`
// without rebuilding markup or rebinding listeners. Use this when only
// the active selection changed and the row data is otherwise unchanged
// — e.g. tapping a song to activate it. Falls back gracefully if the
// list hasn't been rendered yet (no rows to toggle).
//
// `activeId === null` clears the active row. Matching is by the inner
// `.preset-apply` button's `data-id` (the same id `renderSongRows`
// stamps on it), so callers don't need to coordinate a separate lookup.
export function setActiveRow(listEl, activeId) {
  listEl.querySelectorAll('.preset-row').forEach(row => {
    const apply = row.querySelector('.preset-apply');
    const id = apply?.dataset.id ?? null;
    row.classList.toggle('active', id != null && id === activeId);
  });
}

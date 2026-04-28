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

import { escHtml } from '../utils/dom.js';

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
    listEl.innerHTML = `<div class="setlist-empty">${escHtml(emptyText)}</div>`;
    return;
  }

  listEl.innerHTML = items.map((item, idx) => {
    const isActive = activeId === item.id;
    const handleHtml = showDragHandle ? '<span class="drag-handle">⠿</span>' : '';
    const numHtml = showTrackNumber ? `<span class="preset-num">${idx + 1}</span>` : '';
    const nameHtml = escHtml(item.name) || (untitledText ? escHtml(untitledText) : '');
    const tsNum = item.tsNum ?? 4;
    const tsDen = item.tsDen ?? 4;
    return `
      <div class="preset-row${isActive ? ' active' : ''}" data-idx="${idx}">
        ${handleHtml}
        <button class="preset-apply" data-id="${escHtml(item.id)}">
          ${numHtml}
          <span class="preset-name">${nameHtml}</span>
          <span class="preset-bpm">${escHtml(item.bpm)} BPM</span>
          <span class="preset-ts">${escHtml(tsNum)}/${escHtml(tsDen)}</span>
        </button>
        <button class="preset-icon-btn" data-id="${escHtml(item.id)}" data-action="${editAction}" title="${escHtml(editTitle)}">✏</button>
        <button class="preset-icon-btn del" data-id="${escHtml(item.id)}" data-action="${deleteAction}" title="${escHtml(deleteTitle)}">✕</button>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.preset-apply').forEach(btn =>
    btn.addEventListener('click', () => onApply(btn.dataset.id)));
  listEl.querySelectorAll(`[data-action="${editAction}"]`).forEach(btn =>
    btn.addEventListener('click', () => onEdit(btn.dataset.id)));
  listEl.querySelectorAll(`[data-action="${deleteAction}"]`).forEach(btn =>
    btn.addEventListener('click', () => onDelete(btn.dataset.id)));
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

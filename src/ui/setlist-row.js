export function renderSetlistRows({
  listEl,
  setlists,
  emptyText,
  songsCountText,
  editTitle,
  deleteTitle,
  onOpen,
  onEdit,
  onDelete,
}) {
  if (!setlists.length) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'setlist-empty';
    emptyEl.textContent = emptyText;
    listEl.replaceChildren(emptyEl);
    return;
  }

  const existingRows = new Map(
    Array.from(listEl.children)
      .filter(el => el.classList.contains('sl-row'))
      .map(row => [row.dataset.id, row])
  );

  setlists.forEach((setlist, idx) => {
    const id = String(setlist.id);
    let row = existingRows.get(id);
    if (!row) {
      row = document.createElement('div');
      row.className = 'sl-row';
      row.dataset.id = id;
    }
    existingRows.delete(id);
    updateSetlistRow(row, {
      setlist,
      idx,
      songsCountText,
      editTitle,
      deleteTitle,
      onOpen,
      onEdit,
      onDelete,
    });
    listEl.appendChild(row);
  });

  existingRows.forEach(row => row.remove());
}

function updateSetlistRow(row, {
  setlist,
  idx,
  songsCountText,
  editTitle,
  deleteTitle,
  onOpen,
  onEdit,
  onDelete,
}) {
  const id = String(setlist.id);
  const signature = JSON.stringify({
    id,
    idx,
    name: setlist.name,
    songCount: setlist.songs.length,
    songsCountText,
    editTitle,
    deleteTitle,
  });

  row.dataset.id = id;
  row.dataset.idx = String(idx);
  if (row.dataset.signature === signature) {
    bindSetlistRowHandlers(row, { id, onOpen, onEdit, onDelete });
    return;
  }
  row.dataset.signature = signature;

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.setAttribute('aria-hidden', 'true');
  handle.textContent = '⠿';

  const openBtn = document.createElement('button');
  openBtn.className = 'sl-row-btn';
  openBtn.dataset.id = id;

  const title = document.createElement('span');
  title.className = 'sl-row-title';
  title.textContent = setlist.name;
  openBtn.appendChild(title);

  const count = document.createElement('span');
  count.className = 'sl-row-count';
  count.textContent = `${setlist.songs.length} ${songsCountText}`;
  openBtn.appendChild(count);

  const editBtn = document.createElement('button');
  editBtn.className = 'preset-icon-btn';
  editBtn.dataset.id = id;
  editBtn.dataset.action = 'edit-sl';
  editBtn.title = editTitle;
  editBtn.setAttribute('aria-label', `${setlist.name} ${editTitle}`.trim());
  editBtn.textContent = '✏';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'preset-icon-btn del';
  deleteBtn.dataset.id = id;
  deleteBtn.dataset.action = 'del-sl';
  deleteBtn.title = deleteTitle;
  deleteBtn.setAttribute('aria-label', `${setlist.name} ${deleteTitle}`.trim());
  deleteBtn.textContent = '✕';

  row.replaceChildren(handle, openBtn, editBtn, deleteBtn);
  bindSetlistRowHandlers(row, { id, onOpen, onEdit, onDelete });
}

function bindSetlistRowHandlers(row, { id, onOpen, onEdit, onDelete }) {
  const openBtn = row.querySelector('.sl-row-btn');
  const editBtn = row.querySelector('[data-action="edit-sl"]');
  const deleteBtn = row.querySelector('[data-action="del-sl"]');
  if (openBtn) openBtn.onclick = () => onOpen(id);
  if (editBtn) editBtn.onclick = () => onEdit(id);
  if (deleteBtn) deleteBtn.onclick = () => onDelete(id);
}

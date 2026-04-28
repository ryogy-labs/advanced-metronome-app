const renderCache = new WeakMap();

function buildRenderSignature({ songs, emptyText }) {
  return JSON.stringify({
    songs: songs.map(song => ({
      id: song.id,
      name: song.name,
      bpm: song.bpm,
      tsNum: song.tsNum ?? 4,
      tsDen: song.tsDen ?? 4,
    })),
    emptyText,
  });
}

export function renderLibraryPicker({
  listEl,
  songs,
  emptyText,
  onPick,
}) {
  const signature = buildRenderSignature({ songs, emptyText });
  if (renderCache.get(listEl) === signature) return;
  renderCache.set(listEl, signature);

  if (!songs.length) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'setlist-empty';
    emptyEl.textContent = emptyText;
    listEl.replaceChildren(emptyEl);
    return;
  }

  const existingRows = new Map(
    Array.from(listEl.children)
      .filter(el => el.classList.contains('preset-row'))
      .map(row => [row.dataset.id, row])
  );

  songs.forEach(song => {
    const id = String(song.id);
    let row = existingRows.get(id);
    if (!row) {
      row = document.createElement('div');
      row.className = 'preset-row';
      row.dataset.id = id;
    }
    existingRows.delete(id);
    updateLibraryPickerRow(row, { song, onPick });
    listEl.appendChild(row);
  });

  existingRows.forEach(row => row.remove());
}

function updateLibraryPickerRow(row, { song, onPick }) {
  const id = String(song.id);
  const tsNum = song.tsNum ?? 4;
  const tsDen = song.tsDen ?? 4;
  const signature = JSON.stringify({
    id,
    name: song.name,
    bpm: song.bpm,
    tsNum,
    tsDen,
  });

  row.dataset.id = id;
  if (row.dataset.signature === signature) return;
  row.dataset.signature = signature;

  const applyBtn = document.createElement('button');
  applyBtn.className = 'preset-apply';
  applyBtn.dataset.id = id;
  applyBtn.addEventListener('click', () => onPick(id));

  const name = document.createElement('span');
  name.className = 'preset-name';
  name.textContent = song.name;
  applyBtn.appendChild(name);

  const bpm = document.createElement('span');
  bpm.className = 'preset-bpm';
  bpm.textContent = `${song.bpm} BPM`;
  applyBtn.appendChild(bpm);

  const ts = document.createElement('span');
  ts.className = 'preset-ts';
  ts.textContent = `${tsNum}/${tsDen}`;
  applyBtn.appendChild(ts);

  row.replaceChildren(applyBtn);
}

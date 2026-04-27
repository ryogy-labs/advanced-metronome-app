// Generic touch/mouse drag-and-drop list reorder.
// Caller provides the row/handle selectors and an onReorder callback.
export function setupDnD(listEl, rowSel, handleSel, onReorder) {
  let src = null;
  let gapIdx = -1;
  let insertAt = null;
  let ghost = null;

  function shift(i) {
    const { srcIdx, srcHeight } = src;
    if (i === srcIdx) return 0;
    if (gapIdx > srcIdx + 1 && i > srcIdx && i < gapIdx) return -srcHeight;
    if (gapIdx <= srcIdx && i >= gapIdx && i < srcIdx) return srcHeight;
    return 0;
  }

  function start(clientX, clientY, handle) {
    const row = handle.closest('[data-idx]');
    if (!row) return;
    const srcIdx = parseInt(row.dataset.idx);
    const rect = row.getBoundingClientRect();

    row.classList.add('dnd-source');

    const g = row.cloneNode(true);
    g.classList.add('dnd-ghost');
    g.classList.remove('dnd-source');
    Object.assign(g.style, {
      position: 'fixed',
      width: rect.width + 'px',
      left: rect.left + 'px',
      top: rect.top + 'px',
      margin: '0',
      zIndex: '1000',
    });
    document.body.appendChild(g);

    const rows = Array.from(listEl.querySelectorAll(rowSel));
    const rowRects = rows.map(r => r.getBoundingClientRect());
    src = {
      srcIdx,
      srcEl: row,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
      rowTops: rowRects.map(r => r.top),
      rowBottoms: rowRects.map(r => r.bottom),
      srcHeight: rect.height,
    };
    ghost = g;
    gapIdx = srcIdx;
    insertAt = srcIdx;

    listEl.classList.add('dnd-active');
    document.addEventListener('touchmove', onTouchMove, { passive: false });
  }

  function move(clientX, clientY) {
    if (!src) return;

    Object.assign(ghost.style, {
      left: clientX - src.offsetX + 'px',
      top: clientY - src.offsetY + 'px',
    });

    const { rowTops, rowBottoms, srcIdx } = src;
    const n = rowTops.length;
    const midYs = rowTops.map((t, i) => (t + rowBottoms[i]) / 2);

    let newGapIdx;
    if (clientY < midYs[0]) newGapIdx = 0;
    else if (clientY >= midYs[n - 1]) newGapIdx = n;
    else {
      newGapIdx = n;
      for (let i = 0; i < n - 1; i++) {
        if (clientY >= midYs[i] && clientY < midYs[i + 1]) {
          newGapIdx = i + 1;
          break;
        }
      }
    }

    if (newGapIdx !== gapIdx) {
      gapIdx = newGapIdx;
      Array.from(listEl.querySelectorAll(rowSel)).forEach((row, i) => {
        if (i === srcIdx) return;
        const ty = shift(i);
        row.style.transform = ty !== 0 ? `translateY(${ty}px)` : '';
      });
    }

    insertAt = gapIdx >= n
      ? n - 1
      : gapIdx <= srcIdx ? gapIdx : gapIdx - 1;
  }

  function end() {
    if (!src) return;

    const { srcIdx, srcEl } = src;
    const finalInsertAt = insertAt;

    listEl.classList.remove('dnd-active');
    Array.from(listEl.querySelectorAll(rowSel)).forEach(r => { r.style.transform = ''; });

    ghost.remove();
    srcEl.classList.remove('dnd-source');
    ghost = null;
    src = null;
    insertAt = null;
    gapIdx = -1;
    document.removeEventListener('touchmove', onTouchMove);

    if (finalInsertAt !== null && finalInsertAt !== srcIdx) {
      onReorder(srcIdx, finalInsertAt);
    }
  }

  function onTouchMove(e) {
    e.preventDefault();
    move(e.touches[0].clientX, e.touches[0].clientY);
  }

  listEl.addEventListener('mousedown', e => {
    const handle = e.target.closest(handleSel);
    if (!handle) return;
    e.preventDefault();
    start(e.clientX, e.clientY, handle);
  });
  document.addEventListener('mousemove', e => { if (src) move(e.clientX, e.clientY); });
  document.addEventListener('mouseup', () => { if (src) end(); });

  listEl.addEventListener('touchstart', e => {
    const handle = e.target.closest(handleSel);
    if (!handle) return;
    start(e.touches[0].clientX, e.touches[0].clientY, handle);
  }, { passive: true });
  document.addEventListener('touchend', () => { if (src) end(); });
}

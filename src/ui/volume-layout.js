export function createVolumeLayout({ getTsCards, getVolumeSections }) {
  function syncHeight() {
    const tsCards = getTsCards();
    const targetH = tsCards.reduce((max, el) =>
      Math.max(max, Math.round(el.getBoundingClientRect().height)), 0);
    if (!targetH) return;

    getVolumeSections().forEach(el => {
      el.style.height = `${targetH}px`;
      const rows = Array.from(el.querySelectorAll('.vol-row'));
      if (rows.length === 0) return;
      const rowsTotal = rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
      const cs = getComputedStyle(el);
      const borderTop = parseFloat(cs.borderTopWidth) || 0;
      const borderBottom = parseFloat(cs.borderBottomWidth) || 0;
      const innerHeight = targetH - borderTop - borderBottom;
      const slot = Math.max(0, (innerHeight - rowsTotal) / (rows.length + 1));
      el.style.setProperty('--vol-vspace', `${slot}px`);
    });
  }

  return { syncHeight };
}

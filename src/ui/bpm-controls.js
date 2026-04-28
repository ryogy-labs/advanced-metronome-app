function updateSliderFill(slider, min, max) {
  const pct = ((slider.value - min) / (max - min)) * 100;
  slider.style.setProperty('--pct', `${pct}%`);
}

export function createBpmControls({
  slider,
  display,
  buttons,
  min,
  max,
  getBpm,
  setBpm,
}) {
  let isEditing = false;
  let bpmBeforeEdit = getBpm();

  function sync(value = getBpm()) {
    display.textContent = value;
    slider.value = value;
    updateSliderFill(slider, min, max);
  }

  function startEdit() {
    if (isEditing) return;
    isEditing = true;
    bpmBeforeEdit = getBpm();
    display.contentEditable = 'true';
    display.classList.add('bpm-editing');
    display.focus();

    const range = document.createRange();
    range.selectNodeContents(display);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function commitEdit() {
    if (!isEditing) return;
    const typed = Number(String(display.textContent || '').trim());
    setBpm(Number.isFinite(typed) ? typed : bpmBeforeEdit);
    isEditing = false;
    display.contentEditable = 'false';
    display.classList.remove('bpm-editing');
  }

  function cancelEdit() {
    if (!isEditing) return;
    setBpm(bpmBeforeEdit);
    isEditing = false;
    display.contentEditable = 'false';
    display.classList.remove('bpm-editing');
  }

  slider.addEventListener('input', () => setBpm(Number(slider.value)));
  display.addEventListener('click', startEdit);
  display.addEventListener('blur', commitEdit);
  display.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  });

  buttons.minus10.addEventListener('click', () => setBpm(getBpm() - 10));
  buttons.minus5.addEventListener('click', () => setBpm(getBpm() - 5));
  buttons.minus1.addEventListener('click', () => setBpm(getBpm() - 1));
  buttons.plus1.addEventListener('click', () => setBpm(getBpm() + 1));
  buttons.plus5.addEventListener('click', () => setBpm(getBpm() + 5));
  buttons.plus10.addEventListener('click', () => setBpm(getBpm() + 10));

  sync();

  return { sync };
}

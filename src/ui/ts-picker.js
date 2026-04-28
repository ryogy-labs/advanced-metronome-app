// Time-signature picker for the setlist song form and library form.
//
// Renders a row of numerator buttons + a row of denominator buttons,
// plus two hidden `<input>`s (`<prefix>Num` / `<prefix>Den`) that hold
// the current selection so callers can read them via the standard
// form-element lookup. Clicking a button toggles the `.active` class on
// the siblings sharing the same `data-target` and writes the value to
// the matching hidden input.
//
// The same picker mounts in two places (setlist add/edit form, library
// add/edit form), so callers pass a `prefix` (`'pfTs'` or `'libTs'`)
// that becomes the `id` suffix for the hidden inputs and the
// `data-target` value on the buttons.
//
// Translations: `t('page.timesig')` provides the row label. The caller
// owns its own i18n instance and passes it in.

import { TS_NUMS, TS_DENS } from '../config.js';

function createButton(value, target, isActive) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ts-btn';
  btn.classList.toggle('active', isActive);
  btn.dataset.target = target;
  btn.dataset.val = String(value);
  btn.textContent = String(value);
  return btn;
}

function createHiddenInput(id, value) {
  const input = document.createElement('input');
  input.type = 'hidden';
  input.id = id;
  input.value = String(value);
  return input;
}

function buildPickerFragment(tsNum, tsDen, prefix, label) {
  const row = document.createElement('div');
  row.className = 'ts-picker-row';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const group = document.createElement('div');
  group.className = 'ts-picker-group';

  const nums = document.createElement('div');
  nums.className = 'ts-picker-nums';
  nums.append(...TS_NUMS.map(n => createButton(n, `${prefix}Num`, tsNum === n)));
  group.appendChild(nums);

  const slash = document.createElement('span');
  slash.className = 'ts-slash';
  slash.textContent = '/';
  group.appendChild(slash);

  const dens = document.createElement('div');
  dens.className = 'ts-picker-dens';
  dens.append(...TS_DENS.map(d => createButton(d, `${prefix}Den`, tsDen === d)));
  group.appendChild(dens);

  row.appendChild(group);
  row.appendChild(createHiddenInput(`${prefix}Num`, tsNum));
  row.appendChild(createHiddenInput(`${prefix}Den`, tsDen));
  return row;
}

// Mount a fresh picker into `container`. Replaces any prior contents
// (used by both add and edit forms — the picker re-mounts on form open
// so the active-button state matches the editing target).
export function mountTsPicker({ container, tsNum, tsDen, prefix, t }) {
  if (!container) return;
  container.replaceChildren(buildPickerFragment(tsNum, tsDen, prefix, t('page.timesig')));
  container.onclick = e => {
    const btn = e.target.closest('.ts-btn');
    if (!btn || !container.contains(btn)) return;
    const target = btn.dataset.target;
    const val = Number(btn.dataset.val);
    const inputEl = container.querySelector(`#${target}`);
    if (!inputEl) return;
    inputEl.value = String(val);
    container.querySelectorAll(`.ts-btn[data-target="${target}"]`)
      .forEach(b => b.classList.toggle('active', Number(b.dataset.val) === val));
  };
}

// Update an already-mounted picker's selected values without re-rendering.
// Used when the metronome's current TS is "applied" to a form that is
// already open (e.g. capture-from-current-state buttons).
export function setTsPickerValues({ prefix, tsNum, tsDen }) {
  const numEl = document.getElementById(`${prefix}Num`);
  const denEl = document.getElementById(`${prefix}Den`);
  if (!numEl || !denEl) return;
  numEl.value = String(tsNum);
  denEl.value = String(tsDen);
  const container = numEl.closest('.form-ts-picker') || denEl.closest('.form-ts-picker');
  if (!container) return;
  container.querySelectorAll(`.ts-btn[data-target="${prefix}Num"]`)
    .forEach(b => b.classList.toggle('active', Number(b.dataset.val) === tsNum));
  container.querySelectorAll(`.ts-btn[data-target="${prefix}Den"]`)
    .forEach(b => b.classList.toggle('active', Number(b.dataset.val) === tsDen));
}

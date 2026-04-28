import { createModalFocusController } from './modal-a11y.js';

export function createSettingsPanel({
  els: {
    overlay,
    openBtns,
    closeBtn,
    langJaBtn,
    langEnBtn,
    wakelockOnBtn,
    wakelockOffBtn,
    modeVerticalBtn,
    modeHorizontalBtn,
    squashOnBtn,
    squashOffBtn,
  },
  getLang,
  setLang,
  getWakeLockEnabled,
  setWakeLockEnabled,
  getMode,
  setMode,
  getSquashEnabled,
  setSquashEnabled,
}) {
  const focusController = createModalFocusController({
    modalEl: overlay,
    getInitialFocusEl: () => closeBtn,
  });

  function syncActiveStates() {
    const lang = getLang();
    langJaBtn.classList.toggle('active', lang === 'ja');
    langEnBtn.classList.toggle('active', lang === 'en');

    const wakeLockEnabled = getWakeLockEnabled();
    wakelockOnBtn.classList.toggle('active', wakeLockEnabled);
    wakelockOffBtn.classList.toggle('active', !wakeLockEnabled);

    const mode = getMode();
    modeVerticalBtn.classList.toggle('active', mode === 'vertical');
    modeHorizontalBtn.classList.toggle('active', mode === 'horizontal');

    const squashEnabled = getSquashEnabled();
    squashOnBtn.classList.toggle('active', squashEnabled);
    squashOffBtn.classList.toggle('active', !squashEnabled);
  }

  function open() {
    syncActiveStates();
    overlay.hidden = false;
    focusController.open();
  }

  function close() {
    overlay.hidden = true;
    focusController.close();
  }

  openBtns.forEach(btn => btn.addEventListener('click', open));
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener('keydown', e => {
    focusController.handleKeydown(e, close);
  });

  langJaBtn.addEventListener('click', () => { setLang('ja'); syncActiveStates(); });
  langEnBtn.addEventListener('click', () => { setLang('en'); syncActiveStates(); });
  wakelockOnBtn.addEventListener('click', () => { setWakeLockEnabled(true); syncActiveStates(); });
  wakelockOffBtn.addEventListener('click', () => { setWakeLockEnabled(false); syncActiveStates(); });
  modeVerticalBtn.addEventListener('click', () => { setMode('vertical'); syncActiveStates(); });
  modeHorizontalBtn.addEventListener('click', () => { setMode('horizontal'); syncActiveStates(); });
  squashOnBtn.addEventListener('click', () => { setSquashEnabled(true); syncActiveStates(); });
  squashOffBtn.addEventListener('click', () => { setSquashEnabled(false); syncActiveStates(); });

  syncActiveStates();

  return { open, close, syncActiveStates };
}

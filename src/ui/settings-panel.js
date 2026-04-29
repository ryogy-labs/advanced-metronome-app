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
    visualDelaySlider,
    visualDelayNum,
    visualDelayCalibrateBtn,
    visualDelayCalibrateStatus,
    modeVerticalBtn,
    modeHorizontalBtn,
    squashOnBtn,
    squashOffBtn,
  },
  getLang,
  setLang,
  getWakeLockEnabled,
  setWakeLockEnabled,
  getVisualDelayMs,
  setVisualDelayMs,
  onVisualDelayCalibrateTap,
  getVisualDelayCalibrationHint,
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

    const delayMs = getVisualDelayMs();
    if (visualDelaySlider) {
      visualDelaySlider.value = String(delayMs);
      const min = Number(visualDelaySlider.min) || 0;
      const max = Number(visualDelaySlider.max) || 500;
      const pct = ((delayMs - min) / (max - min)) * 100;
      visualDelaySlider.style.setProperty('--pct', `${pct}%`);
    }
    if (visualDelayNum) visualDelayNum.value = String(delayMs);
    if (visualDelayCalibrateStatus && getVisualDelayCalibrationHint) {
      visualDelayCalibrateStatus.textContent = getVisualDelayCalibrationHint();
    }
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
  visualDelaySlider?.addEventListener('input', () => {
    setVisualDelayMs(Number(visualDelaySlider.value));
    syncActiveStates();
  });
  visualDelayNum?.addEventListener('change', () => {
    setVisualDelayMs(Number(visualDelayNum.value));
    syncActiveStates();
  });
  visualDelayNum?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setVisualDelayMs(Number(visualDelayNum.value));
      syncActiveStates();
      visualDelayNum.blur();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      syncActiveStates();
      visualDelayNum.blur();
    }
  });
  visualDelayCalibrateBtn?.addEventListener('click', () => {
    if (!onVisualDelayCalibrateTap || !visualDelayCalibrateStatus) return;
    visualDelayCalibrateStatus.textContent = onVisualDelayCalibrateTap();
    syncActiveStates();
  });
  modeVerticalBtn.addEventListener('click', () => { setMode('vertical'); syncActiveStates(); });
  modeHorizontalBtn.addEventListener('click', () => { setMode('horizontal'); syncActiveStates(); });
  squashOnBtn.addEventListener('click', () => { setSquashEnabled(true); syncActiveStates(); });
  squashOffBtn.addEventListener('click', () => { setSquashEnabled(false); syncActiveStates(); });

  syncActiveStates();

  return { open, close, syncActiveStates };
}

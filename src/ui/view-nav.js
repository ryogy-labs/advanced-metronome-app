export function createViewNav({
  buttons: { metronomeBtn, setlistBtn, libraryBtn },
  views: { metronomeView, setlistView, libraryView },
  onMetronomeEnter,
  onLibraryEnter,
}) {
  function setView(targetView, targetNav) {
    [metronomeView, setlistView, libraryView].forEach(view =>
      view.classList.toggle('active', view === targetView));
    [metronomeBtn, setlistBtn, libraryBtn].forEach(nav =>
      nav.classList.toggle('active', nav === targetNav));
    if (targetView === metronomeView) onMetronomeEnter?.();
  }

  metronomeBtn.addEventListener('click', () => setView(metronomeView, metronomeBtn));
  setlistBtn.addEventListener('click', () => setView(setlistView, setlistBtn));
  libraryBtn.addEventListener('click', () => {
    setView(libraryView, libraryBtn);
    onLibraryEnter?.();
  });

  return { setView };
}

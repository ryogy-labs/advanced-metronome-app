export function createViewNav({
  buttons: { metronomeBtn, setlistBtn, libraryBtn },
  views: { metronomeView, setlistView, libraryView },
  onMetronomeEnter,
  onSetlistEnter,
  onLibraryEnter,
}) {
  const enterCallbacks = new Map([
    [metronomeView, onMetronomeEnter],
    [setlistView, onSetlistEnter],
    [libraryView, onLibraryEnter],
  ]);

  function setView(targetView, targetNav) {
    [metronomeView, setlistView, libraryView].forEach(view =>
      view.classList.toggle('active', view === targetView));
    [metronomeBtn, setlistBtn, libraryBtn].forEach(nav =>
      nav.classList.toggle('active', nav === targetNav));
    enterCallbacks.get(targetView)?.();
  }

  metronomeBtn.addEventListener('click', () => setView(metronomeView, metronomeBtn));
  setlistBtn.addEventListener('click', () => setView(setlistView, setlistBtn));
  libraryBtn.addEventListener('click', () => setView(libraryView, libraryBtn));

  return { setView };
}

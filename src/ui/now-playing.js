export function createNowPlaying({ els, onTogglePlayback }) {
  function setPlaybackState(running) {
    els.forEach(el => {
      if (el.style.display === 'none') return;
      el.classList.toggle('paused', !running);
      const icon = el.querySelector('.np-icon');
      if (icon) icon.textContent = running ? '▶' : '■';
    });
  }

  function render({ name, bpm, running }) {
    els.forEach(el => {
      const nameEl = el.querySelector('.np-name');
      const bpmEl = el.querySelector('.np-bpm');
      if (name && bpm !== null) {
        if (nameEl) nameEl.textContent = name;
        if (bpmEl) bpmEl.textContent = `${bpm} BPM`;
        el.style.display = 'flex';
      } else {
        el.style.display = 'none';
      }
    });
    setPlaybackState(running);
  }

  els.forEach(el => el.addEventListener('click', onTogglePlayback));

  return { render, setPlaybackState };
}

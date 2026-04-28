export function createBeatDots({ rowEls, onCycleBeatState }) {
  const renderCache = new WeakMap();

  function render({ count, getBeatState }) {
    rowEls.forEach(rowEl => {
      const states = Array.from({ length: count }, (_, idx) => getBeatState(idx));
      const signature = JSON.stringify(states);
      if (renderCache.get(rowEl) === signature) return;
      renderCache.set(rowEl, signature);

      rowEl.replaceChildren();
      rowEl.dataset.count = String(count);
      for (let i = 0; i < count; i++) {
        const dot = document.createElement('button');
        dot.className = 'beat-dot';
        dot.type = 'button';
        dot.dataset.state = states[i];
        dot.dataset.beatIdx = String(i);
        dot.setAttribute('aria-label', `Beat ${i + 1}`);
        dot.textContent = i + 1;
        dot.addEventListener('click', () => onCycleBeatState(i));
        rowEl.appendChild(dot);
      }
    });
  }

  function update(activeIdx = null, getBeatState) {
    rowEls.forEach(rowEl => {
      const dots = rowEl.querySelectorAll('.beat-dot');
      dots.forEach((dot, idx) => {
        const state = getBeatState?.(idx) || dot.dataset.state || 'normal';
        dot.dataset.state = state;
        dot.classList.remove('active-1', 'active-n', 'active-muted', 'idle-accent', 'idle-normal', 'idle-muted');
        if (state === 'accent') dot.classList.add('idle-accent');
        else if (state === 'mute') dot.classList.add('idle-muted');
        else dot.classList.add('idle-normal');
        if (activeIdx !== null && idx === activeIdx) {
          dot.classList.remove('idle-accent', 'idle-normal', 'idle-muted');
          if (state === 'accent') dot.classList.add('active-1');
          else if (state === 'mute') dot.classList.add('active-muted');
          else dot.classList.add('active-n');
        }
      });
    });
  }

  return { render, update };
}

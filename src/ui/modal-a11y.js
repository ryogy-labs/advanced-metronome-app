const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableEls(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter(el => el instanceof HTMLElement && el.offsetParent !== null);
}

export function createModalFocusController({ modalEl, getInitialFocusEl }) {
  let lastFocusedEl = null;

  function focusInitial() {
    const target = getInitialFocusEl?.() || getFocusableEls(modalEl)[0] || modalEl;
    target?.focus?.();
  }

  function open() {
    lastFocusedEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAnimationFrame(focusInitial);
  }

  function close() {
    lastFocusedEl?.focus?.();
    lastFocusedEl = null;
  }

  function handleKeydown(e, onEscape) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape?.();
      return;
    }
    if (e.key !== 'Tab') return;

    const focusableEls = getFocusableEls(modalEl);
    if (!focusableEls.length) {
      e.preventDefault();
      return;
    }

    const first = focusableEls[0];
    const last = focusableEls[focusableEls.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return { open, close, handleKeydown };
}

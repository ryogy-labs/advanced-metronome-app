// 5-slot clone carousel for the metronome / setlist / library views.
//
// Slot layout (physicalIdx → logical page):
//   [clone-P2][P0][P1][P2][clone-P0]
//        0     1   2   3       4
//
// Logical pages are 0..(totalPages-1). The carousel always lives at slot
// 1..3; slots 0 and 4 are clone sentinels that the carousel briefly lands
// on after a wrap, then snaps (transition:none) back to the matching
// real slot. This gives the user a continuous "infinite" swipe in either
// direction without a visible jump.
//
// Inputs:
//   - pagesEl: the strip element that gets translated horizontally
//   - dotEls : NodeList of dot indicators (one per logical page)
//
// Hooks:
//   - onAfterClonesInserted(): runs synchronously after slot 0/4 clones
//     are appended. Use this to (re)scan the DOM for elements that the
//     clones duplicate (e.g. extra .ball-canvas nodes inside the cloned
//     metronome page).
//   - onPageEnter(logicalPage): runs every time the carousel finishes
//     navigating to a logical page (dot click, swipe, mouse drag). Use
//     this to refresh per-page state — e.g. re-measure the canvas when
//     the metronome page becomes visible again.
//
// The factory returns nothing externally callable: navigation is fully
// driven by the dot clicks and pointer events bound here.

export function createSwipePanel({
  pagesEl,
  dotEls,
  totalPages,
  slotStep,        // % per slot (e.g. 20 for 5 slots)
  thresholdPx,     // drag distance to trigger page change
  onAfterClonesInserted,
  onPageEnter,
}) {
  let currentPage = 0;
  let physicalIdx = 1; // start at slot 1 (real page 0)

  // Inject clone sentinels into the DOM
  const pages = Array.from(pagesEl.querySelectorAll('.swipe-page'));
  // slot 0: clone of last page (shows when dragging right past page 0)
  pagesEl.insertBefore(pages[totalPages - 1].cloneNode(true), pages[0]);
  // slot 4: clone of first page (shows when dragging left past last page)
  pagesEl.appendChild(pages[0].cloneNode(true));

  if (typeof onAfterClonesInserted === 'function') onAfterClonesInserted();

  // Set initial position instantly (no animation)
  pagesEl.style.transition = 'none';
  pagesEl.style.transform  = `translateX(-${physicalIdx * slotStep}%)`;
  // Re-enable transition after layout settles
  requestAnimationFrame(() => requestAnimationFrame(() => {
    pagesEl.style.transition = '';
  }));

  // After a wrap transition lands on a clone slot, silently jump to the real slot.
  // IMPORTANT: force a synchronous reflow (offsetWidth read) between setting
  // transition:none + transform and re-enabling the transition, so the browser
  // commits the instant jump before any future animated transition can start.
  pagesEl.addEventListener('transitionend', () => {
    if (physicalIdx === totalPages + 1) {
      // last clone (slot N+1) → real first page (slot 1)
      physicalIdx = 1;
      pagesEl.style.transition = 'none';
      pagesEl.style.transform  = `translateX(-${physicalIdx * slotStep}%)`;
      void pagesEl.offsetWidth; // flush styles / force reflow
      pagesEl.style.transition = '';
    } else if (physicalIdx === 0) {
      // first clone (slot 0) → real last page (slot N)
      physicalIdx = totalPages;
      pagesEl.style.transition = 'none';
      pagesEl.style.transform  = `translateX(-${physicalIdx * slotStep}%)`;
      void pagesEl.offsetWidth; // flush styles / force reflow
      pagesEl.style.transition = '';
    }
  });

  function updateDots() {
    dotEls.forEach((dot, i) => dot.classList.toggle('active', i === currentPage));
  }

  function emitPageEnter() {
    if (typeof onPageEnter === 'function') onPageEnter(currentPage);
  }

  // Direct navigation to a logical page (dot clicks)
  function goToPage(targetLogical) {
    currentPage = ((targetLogical % totalPages) + totalPages) % totalPages;
    physicalIdx = currentPage + 1; // 0→1, 1→2, ..., (N-1)→N
    pagesEl.style.transition = '';
    pagesEl.style.transform  = `translateX(-${physicalIdx * slotStep}%)`;
    updateDots();
    emitPageEnter();
  }

  // Navigate one step forward (swipe-left = next page; wraps via clone of page 0)
  function goForward() {
    currentPage = (currentPage + 1) % totalPages;
    physicalIdx = physicalIdx + 1; // may reach (N+1) clone slot; transitionend jumps back
    pagesEl.style.transition = '';
    pagesEl.style.transform  = `translateX(-${physicalIdx * slotStep}%)`;
    updateDots();
    emitPageEnter();
  }

  // Navigate one step backward (swipe-right = prev page; wraps via clone of last page)
  function goBackward() {
    currentPage = (currentPage + totalPages - 1) % totalPages;
    physicalIdx = physicalIdx - 1; // may reach slot 0 clone; transitionend jumps back
    pagesEl.style.transition = '';
    pagesEl.style.transform  = `translateX(-${physicalIdx * slotStep}%)`;
    updateDots();
    emitPageEnter();
  }

  // Dot tap-to-switch
  dotEls.forEach(dot =>
    dot.addEventListener('click', () => goToPage(parseInt(dot.dataset.page))));

  // Touch swipe gesture
  let swipeStartX    = null;
  let swipeStartY    = null;
  let swipeActive    = false;
  let swipeStartPhys = 0;  // physicalIdx at drag start

  pagesEl.addEventListener('touchstart', e => {
    const tgt = e.target;
    // Don't intercept touches that start on interactive elements
    if (tgt.tagName === 'INPUT' || tgt.tagName === 'BUTTON' || tgt.tagName === 'SELECT') return;
    swipeStartX    = e.touches[0].clientX;
    swipeStartY    = e.touches[0].clientY;
    swipeActive    = false;
    swipeStartPhys = physicalIdx;
  }, { passive: true });

  pagesEl.addEventListener('touchmove', e => {
    if (swipeStartX === null) return;
    const dx = e.touches[0].clientX - swipeStartX;
    const dy = e.touches[0].clientY - swipeStartY;

    if (!swipeActive) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        swipeActive = true;
        pagesEl.style.transition = 'none';
      } else {
        swipeStartX = null; // vertical scroll — don't hijack
        return;
      }
    }

    e.preventDefault();
    const containerW = pagesEl.parentElement.offsetWidth;
    const dragPct    = (dx / containerW) * slotStep;
    const basePct    = swipeStartPhys * slotStep;
    pagesEl.style.transform = `translateX(${-(basePct - dragPct)}%)`;
  }, { passive: false });

  pagesEl.addEventListener('touchend', e => {
    if (!swipeActive) { swipeStartX = null; return; }
    pagesEl.style.transition = '';
    const dx = e.changedTouches[0].clientX - swipeStartX;
    if      (dx < -thresholdPx) goForward();
    else if (dx >  thresholdPx) goBackward();
    else {
      // Snap back to where drag started
      physicalIdx = swipeStartPhys;
      pagesEl.style.transform = `translateX(-${physicalIdx * slotStep}%)`;
    }
    swipeStartX = null;
    swipeActive = false;
  });

  // Mouse drag (for desktop testing)
  let mouseSwipeX    = null;
  let mouseSwipePhys = 0;
  let mouseActive    = false;

  pagesEl.addEventListener('mousedown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    mouseSwipeX    = e.clientX;
    mouseSwipePhys = physicalIdx;
    mouseActive    = false;
  });
  document.addEventListener('mousemove', e => {
    if (mouseSwipeX === null) return;
    const dx = e.clientX - mouseSwipeX;
    if (!mouseActive && Math.abs(dx) > 8) {
      mouseActive = true;
      pagesEl.style.transition = 'none';
    }
    if (!mouseActive) return;
    const containerW = pagesEl.parentElement.offsetWidth;
    const dragPct    = (dx / containerW) * slotStep;
    const basePct    = mouseSwipePhys * slotStep;
    pagesEl.style.transform = `translateX(${-(basePct - dragPct)}%)`;
  });
  document.addEventListener('mouseup', e => {
    if (mouseSwipeX === null) return;
    pagesEl.style.transition = '';
    const dx = e.clientX - mouseSwipeX;
    if      (dx < -thresholdPx) goForward();
    else if (dx >  thresholdPx) goBackward();
    else {
      physicalIdx = mouseSwipePhys;
      pagesEl.style.transform = `translateX(-${physicalIdx * slotStep}%)`;
    }
    mouseSwipeX = null;
    mouseActive = false;
  });
}

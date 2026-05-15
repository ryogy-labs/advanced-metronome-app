import './style.css';
import {
  SWIPE_TOTAL_PAGES,
  SWIPE_SLOT_STEP,
  SWIPE_THRESHOLD_PX,
  LS_KEYS,
} from './config.js';
import { createI18n, readInitialLang } from './i18n.js';
import { createMetronomeController } from './app/metronome-controller.js';
import { getMetronomeElements } from './app/metronome-elements.js';
import { createCollectionsController } from './app/collections-controller.js';
import { createPaywall } from './ui/paywall.js';
import { createSwipePanel } from './ui/swipe-panel.js';
import { createViewNav } from './ui/view-nav.js';

(() => {
  const i18n = createI18n(readInitialLang());
  const t = (key) => i18n.t(key);

  let collections = null;

  const metronome = createMetronomeController({
    els: getMetronomeElements(),
    i18n,
    t,
    onPlaybackStateChange: () => {
      collections?.updateNowPlayingState();
    },
    onI18nChange: () => {
      applyI18n();
    },
  });

  const paywall = createPaywall({
    isNativeApp: metronome.isNativeApp,
    devForceProKey: LS_KEYS.devForcePro,
    els: {
      overlay: document.getElementById('proPaywall'),
      buyBtn: document.getElementById('paywallBuyBtn'),
      restoreBtn: document.getElementById('paywallRestoreBtn'),
      closeBtn: document.getElementById('paywallCloseBtn'),
    },
    onProChanged: () => {
      collections?.refreshForProChange();
    },
  });

  collections = createCollectionsController({
    t,
    metronome,
    paywall,
  });

  function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      const val = t(key);
      if (el.tagName === 'BUTTON' || el.tagName === 'SPAN' || el.tagName === 'DIV') {
        el.textContent = val;
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
    });

    const navLabels = {
      metronome: t('nav.metronome'),
      setlist: t('nav.setlist'),
      library: t('nav.library'),
    };
    Object.entries(navLabels).forEach(([key, label]) => {
      const el = document.querySelector(`[data-nav="${key}"] .nav-label`);
      if (el) el.textContent = label;
    });
  }

  function applyI18n() {
    applyStaticI18n();
    metronome.applyI18n();
    collections.applyI18n();
  }

  function mountSwipePanel() {
    createSwipePanel({
      pagesEl: document.getElementById('swipePages'),
      dotEls: document.querySelectorAll('.page-dot'),
      totalPages: SWIPE_TOTAL_PAGES,
      slotStep: SWIPE_SLOT_STEP,
      thresholdPx: SWIPE_THRESHOLD_PX,
      onAfterClonesInserted: () => {
        metronome.refreshBallCanvases();
        metronome.resizeBallCanvases();
        metronome.syncVolumeSectionHeight();
      },
      onPageEnter: (page) => {
        if (page === 0) metronome.resizeBallCanvases();
      },
    });
  }

  function mountViewNav() {
    createViewNav({
      buttons: {
        metronomeBtn: document.getElementById('navMetronome'),
        setlistBtn: document.getElementById('navSetlist'),
        libraryBtn: document.getElementById('navLibrary'),
      },
      views: {
        metronomeView: document.getElementById('viewMetronome'),
        setlistView: document.getElementById('viewSetlist'),
        libraryView: document.getElementById('viewLibrary'),
      },
      onMetronomeEnter: () => {
        requestAnimationFrame(() => {
          metronome.resizeBallCanvases();
          metronome.syncVolumeSectionHeight();
        });
      },
      onLibraryEnter: collections.renderLibrary,
    });
  }

  collections.init();
  mountSwipePanel();
  mountViewNav();
  applyI18n();
  void metronome.warmUp();
})();

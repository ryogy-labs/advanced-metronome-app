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
import { createIap } from './iap.js';
import { createBackup } from './state/backup.js';
import { createDurableStore } from './state/durable-store.js';
import { createPaywall } from './ui/paywall.js';
import { createSwipePanel } from './ui/swipe-panel.js';
import { createViewNav } from './ui/view-nav.js';
import { setStorageChangeListener } from './utils/storage.js';

const isNativeApp = Boolean(
  /** @type {any} */ (window).Capacitor?.isNativePlatform?.()
);

// The mirror has to be read before any store touches localStorage, so the
// whole app boots behind it. A failed hydrate resolves rather than throws,
// leaving localStorage as the only copy.
const durableStore = createDurableStore({ isNativeApp });
const backup = createBackup({ isNativeApp });

durableStore.hydrate().catch(e => {
  console.warn('[durable] hydrate failed', e);
}).then(() => {
  setStorageChangeListener(() => durableStore.markDirty());
  start();
});

function start() {
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
    iap: createIap({ isNativeApp: metronome.isNativeApp }),
    t,
    els: {
      overlay: document.getElementById('proPaywall'),
      buyBtn: document.getElementById('paywallBuyBtn'),
      restoreBtn: document.getElementById('paywallRestoreBtn'),
      closeBtn: document.getElementById('paywallCloseBtn'),
      statusEl: document.getElementById('paywallStatus'),
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

  function mountBackupControls() {
    const exportBtn = document.getElementById('backupExportBtn');
    const importBtn = document.getElementById('backupImportBtn');
    const statusEl = document.getElementById('backupStatus');
    if (!exportBtn || !importBtn) return;

    let statusTimer = null;
    function say(key) {
      if (!statusEl) return;
      statusEl.textContent = t(key);
      // Let the hint come back so the row does not read as stuck.
      if (statusTimer) clearTimeout(statusTimer);
      statusTimer = setTimeout(() => {
        statusEl.textContent = t('settings.backupHint');
      }, 4000);
    }

    exportBtn.addEventListener('click', async () => {
      const { ok } = await backup.save(durableStore.exportJson());
      say(ok ? 'settings.backupDone' : 'settings.backupFailed');
    });

    importBtn.addEventListener('click', async () => {
      const { cancelled, json } = await backup.load();
      if (cancelled || !json) return;
      // Import replaces everything, so the confirmation comes after the
      // file is chosen but before anything is written.
      if (!window.confirm(t('settings.backupConfirm'))) return;
      const result = durableStore.importJson(json);
      if (!result.ok) {
        say(result.reason === 'tooNew' ? 'settings.backupTooNew' : 'settings.backupInvalid');
        return;
      }
      say('settings.backupRestored');
      // Restored data has to reach the running stores, and they read
      // localStorage only at construction.
      window.location.reload();
    });
  }

  collections.init();
  mountBackupControls();
  mountSwipePanel();
  mountViewNav();
  applyI18n();
  void metronome.warmUp();
}

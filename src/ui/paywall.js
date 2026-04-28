// Pro paywall module.
//
// Owns:
//   - The mutable `isPro` flag (initial value reads the dev-force key on
//     web, defaults to false on native — production will eventually
//     replace that with a RevenueCat / StoreKit query).
//   - The paywall modal lifecycle: show on `requirePro` for free users,
//     hide on close button / overlay click / buy / restore.
//   - The dev-only "DEV: PRO ON/OFF" floating toggle (skipped on native).
//
// Does NOT own:
//   - Free-plan limit constants (host still reads `FREE_*` from
//     ./config.js when comparing counts).
//   - Re-render side effects after a pro state flip — the host wires
//     those via `onProChanged` (typical use: re-render setlist /
//     library lists so any pro-gated UI affordances pick up the change).
//
// Returned API:
//   - isPro():        () => boolean — current pro state
//   - requirePro(cb): runs `cb` if pro, else opens the paywall
//
// Buy / restore stubs only log placeholders and close the modal — the
// production hook-up will replace these handlers from inside this
// module without touching call sites.

import { createModalFocusController } from './modal-a11y.js';

export function createPaywall({
  isNativeApp,
  devForceProKey,         // e.g. LS_KEYS.devForcePro
  els: { overlay, buyBtn, restoreBtn, closeBtn },
  onProChanged,           // optional () => void, fired after dev-toggle flips
}) {
  const focusController = overlay
    ? createModalFocusController({
        modalEl: overlay,
        getInitialFocusEl: () => buyBtn,
      })
    : null;


  // Initial pro state.
  // - Web: respect the dev-force flag in localStorage so the dev toggle
  //   below can flip it without a reload.
  // - Native: default to free; production will replace this branch with
  //   a RevenueCat query.
  let isProState = (() => {
    if (!isNativeApp) {
      try { return localStorage.getItem(devForceProKey) === '1'; } catch { return false; }
    }
    return false;
  })();

  function isPro() { return isProState; }

  function show() {
    if (!overlay) return;
    overlay.style.display = 'flex';
    focusController?.open();
  }
  function hide() {
    if (!overlay) return;
    overlay.style.display = 'none';
    focusController?.close();
  }

  function requirePro(onGranted) {
    if (isProState) { onGranted(); return; }
    show();
  }

  // ── Modal wiring ──
  closeBtn?.addEventListener('click', hide);
  overlay?.addEventListener('click', e => {
    if (e.target === overlay) hide();
  });
  overlay?.addEventListener('keydown', e => {
    focusController?.handleKeydown(e, hide);
  });
  buyBtn?.addEventListener('click', () => {
    // Production: RevenueCat の購入フローを呼び出す
    console.log('[DEV] 購入フロー（未実装）');
    hide();
  });
  restoreBtn?.addEventListener('click', () => {
    // Production: RevenueCat の restorePurchases を呼び出す
    console.log('[DEV] 購入復元（未実装）');
    hide();
  });

  // ── Dev-only floating toggle (web build) ──
  // Lives here so flipping the flag and persisting it stay co-located
  // with the rest of the pro state machinery. On native we skip the
  // toggle entirely — production pro state will come from the store.
  if (!isNativeApp) {
    const devBtn = document.createElement('button');
    devBtn.id = 'devProToggle';
    devBtn.style.cssText =
      'position:fixed;bottom:76px;left:12px;z-index:10000;' +
      'padding:4px 10px;font-size:11px;border-radius:6px;' +
      'background:#333;color:#fff;border:1px solid #666;cursor:pointer;opacity:0.8;';
    const updateLabel = () => {
      devBtn.textContent = isProState ? 'DEV: PRO ON' : 'DEV: PRO OFF';
    };
    updateLabel();
    devBtn.addEventListener('click', () => {
      isProState = !isProState;
      try { localStorage.setItem(devForceProKey, isProState ? '1' : '0'); } catch {}
      updateLabel();
      onProChanged?.();
    });
    document.body.appendChild(devBtn);
  }

  return { isPro, requirePro };
}

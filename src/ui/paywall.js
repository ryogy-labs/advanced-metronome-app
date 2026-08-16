// Pro paywall module.
//
// Owns:
//   - The mutable `isPro` flag. On native this mirrors the StoreKit
//     entitlement; on web it reads the dev-force key.
//   - The paywall modal lifecycle: show on `requirePro` for free users,
//     hide on close button / overlay click, and drive buy / restore
//     through the native StoreKit plugin.
//   - The dev-only "DEV: PRO ON/OFF" floating toggle (skipped on native).
//
// Does NOT own:
//   - Free-plan limit constants (host still reads `FREE_*` from
//     ./config.js when comparing counts).
//   - Re-render side effects after a pro state flip — the host wires
//     those via `onProChanged`.
//
// Returned API:
//   - isPro():        () => boolean — current pro state (cached, sync)
//   - requirePro(cb): runs `cb` if pro, else opens the paywall
//
// Entitlement is queried asynchronously at startup and again whenever the
// app returns to the foreground, because a purchase can complete on
// another device or through an Ask to Buy approval.

import { createModalFocusController } from './modal-a11y.js';

export function createPaywall({
  isNativeApp,
  devForceProKey,         // e.g. LS_KEYS.devForcePro
  iap,                    // createIap(...) — store access, no-ops on web
  t,                      // (key: string) => string
  els: { overlay, buyBtn, restoreBtn, closeBtn, statusEl },
  onProChanged,           // optional () => void, fired after pro state flips
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
  // - Native: start closed and let the async entitlement check open it.
  let isProState = (() => {
    if (!isNativeApp) {
      try { return localStorage.getItem(devForceProKey) === '1'; } catch { return false; }
    }
    return false;
  })();

  let priceLabel = '';
  let busy = false;

  function isPro() { return isProState; }

  function setPro(next) {
    if (isProState === next) return;
    isProState = next;
    onProChanged?.();
  }

  function setStatus(key) {
    if (!statusEl) return;
    statusEl.textContent = key ? t(key) : '';
  }

  function setBusy(next) {
    busy = next;
    if (buyBtn) buyBtn.disabled = next;
    if (restoreBtn) restoreBtn.disabled = next;
  }

  function renderBuyLabel() {
    if (!buyBtn) return;
    buyBtn.textContent = priceLabel
      ? t('paywall.upgradePriced').replace('{price}', priceLabel)
      : t('paywall.upgrade');
  }

  function show() {
    if (!overlay) return;
    setStatus('');
    renderBuyLabel();
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
    if (e.target === overlay && !busy) hide();
  });
  overlay?.addEventListener('keydown', e => {
    focusController?.handleKeydown(e, () => { if (!busy) hide(); });
  });

  buyBtn?.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    setStatus('paywall.purchasing');
    const { status, entitled } = await iap.purchase();
    setBusy(false);
    if (entitled) {
      setPro(true);
      setStatus('paywall.thanks');
      hide();
      return;
    }
    if (status === 'pending') { setStatus('paywall.pending'); return; }
    if (status === 'cancelled') { setStatus(''); return; }
    setStatus(status === 'unavailable' ? 'paywall.unavailable' : 'paywall.failed');
  });

  restoreBtn?.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    setStatus('paywall.restoring');
    const entitled = await iap.restore();
    setBusy(false);
    if (entitled) {
      setPro(true);
      setStatus('paywall.thanks');
      hide();
      return;
    }
    setStatus('paywall.restoreNone');
  });

  // ── Store-backed state (native only; all calls no-op on web) ──
  async function refreshEntitlement() {
    const entitled = await iap.isEntitled();
    if (entitled) setPro(true);
  }

  async function loadPrice() {
    const product = await iap.getProduct();
    if (product.available && product.price) {
      priceLabel = product.price;
      renderBuyLabel();
    }
  }

  if (isNativeApp) {
    refreshEntitlement();
    loadPrice();
    iap.onEntitlementChanged(() => { setPro(true); hide(); });
    // A purchase can complete while the app is backgrounded (Ask to Buy,
    // another device), so re-check whenever it comes back.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !isProState) refreshEntitlement();
    });
  }

  // ── Dev-only floating toggle (web build) ──
  // Lives here so flipping the flag and persisting it stay co-located
  // with the rest of the pro state machinery. On native we skip the
  // toggle entirely — pro state comes from StoreKit.
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

// @ts-check

// Thin wrapper over the native StoreKit 2 plugin (ios/App/App/InAppPurchasePlugin.swift).
//
// Every method degrades to "no store, nothing owned" on web so the paywall
// module can call these unconditionally. Store failures resolve rather than
// throw: a metronome must keep working when the App Store is unreachable.

import { registerPlugin } from '@capacitor/core';

const InAppPurchase = /** @type {any} */ (registerPlugin('InAppPurchase'));

/**
 * @typedef {{ available: boolean, id?: string, displayName?: string, price?: string }} IapProduct
 * @typedef {'purchased' | 'cancelled' | 'pending' | 'unavailable' | 'failed'} PurchaseStatus
 */

/** @param {{ isNativeApp: boolean }} deps */
export function createIap({ isNativeApp }) {
  /** @returns {Promise<IapProduct>} */
  async function getProduct() {
    if (!isNativeApp) return { available: false };
    try {
      return await InAppPurchase.getProduct();
    } catch {
      return { available: false };
    }
  }

  /** @returns {Promise<boolean>} */
  async function isEntitled() {
    if (!isNativeApp) return false;
    try {
      const res = await InAppPurchase.isEntitled();
      return Boolean(res?.entitled);
    } catch {
      return false;
    }
  }

  /** @returns {Promise<{ status: PurchaseStatus, entitled: boolean }>} */
  async function purchase() {
    if (!isNativeApp) return { status: 'unavailable', entitled: false };
    try {
      const res = await InAppPurchase.purchase();
      return { status: res?.status ?? 'failed', entitled: Boolean(res?.entitled) };
    } catch {
      return { status: 'failed', entitled: false };
    }
  }

  /** @returns {Promise<boolean>} */
  async function restore() {
    if (!isNativeApp) return false;
    try {
      const res = await InAppPurchase.restore();
      return Boolean(res?.entitled);
    } catch {
      return false;
    }
  }

  /**
   * Fires when a transaction lands outside an explicit purchase() call
   * (Ask to Buy approval, purchase made on another device).
   * @param {() => void} cb
   */
  function onEntitlementChanged(cb) {
    if (!isNativeApp) return;
    try {
      InAppPurchase.addListener('entitlementChanged', cb);
    } catch { /* listener support is optional */ }
  }

  return { getProduct, isEntitled, purchase, restore, onEntitlementChanged };
}

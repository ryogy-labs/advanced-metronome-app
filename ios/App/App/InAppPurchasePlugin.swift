import Foundation
import StoreKit
import Capacitor

// StoreKit 2 bridge for the single non-consumable "Pro" unlock.
//
// The JS side owns the paywall UI; this plugin only answers four questions:
// what the product costs, whether the user owns it, buy it, restore it.
//
// StoreKit 2 requires iOS 15, which matches the app's deployment target, so
// no availability guards are needed.
@objc(InAppPurchasePlugin)
public class InAppPurchasePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InAppPurchasePlugin"
    public let jsName = "InAppPurchase"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProduct", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isEntitled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]

    // Must match the non-consumable product ID registered in App Store Connect
    // and the one in Products.storekit used for local testing.
    private static let productId = "jp.metrobeat.app.pro"

    private var updatesTask: Task<Void, Never>?

    // Transactions can also arrive outside an explicit purchase() call: an
    // Ask to Buy approval, a purchase made on another device, or a payment
    // that resolved after the app was killed. Unfinished transactions are
    // redelivered forever until finished, so this listener must exist.
    override public func load() {
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                guard case .verified(let transaction) = update else { continue }
                await transaction.finish()
                guard let self else { continue }
                self.notifyListeners("entitlementChanged", data: ["entitled": true])
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    private func currentEntitlement() async -> Bool {
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else { continue }
            if transaction.productID == Self.productId && transaction.revocationDate == nil {
                return true
            }
        }
        return false
    }

    @objc func getProduct(_ call: CAPPluginCall) {
        Task {
            do {
                guard let product = try await Product.products(for: [Self.productId]).first else {
                    // Product not configured yet, or the device cannot reach the
                    // store. Resolve rather than reject so the UI can fall back
                    // to a generic label instead of showing an error.
                    call.resolve(["available": false])
                    return
                }
                call.resolve([
                    "available": true,
                    "id": product.id,
                    "displayName": product.displayName,
                    "price": product.displayPrice
                ])
            } catch {
                call.resolve(["available": false])
            }
        }
    }

    @objc func isEntitled(_ call: CAPPluginCall) {
        Task {
            call.resolve(["entitled": await currentEntitlement()])
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        Task {
            do {
                guard let product = try await Product.products(for: [Self.productId]).first else {
                    call.reject("Product unavailable")
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    guard case .verified(let transaction) = verification else {
                        // Failed StoreKit's own signature check — treat as a
                        // failure rather than granting the entitlement.
                        call.reject("Purchase could not be verified")
                        return
                    }
                    await transaction.finish()
                    call.resolve(["status": "purchased", "entitled": true])
                case .userCancelled:
                    call.resolve(["status": "cancelled", "entitled": await currentEntitlement()])
                case .pending:
                    // Ask to Buy / SCA: the entitlement arrives later via the
                    // Transaction.updates listener above.
                    call.resolve(["status": "pending", "entitled": false])
                @unknown default:
                    call.resolve(["status": "unknown", "entitled": await currentEntitlement()])
                }
            } catch {
                call.reject("Purchase failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            // AppStore.sync() prompts for App Store credentials and throws if
            // the user backs out. Either way the honest answer is whatever
            // currentEntitlements reports afterwards.
            try? await AppStore.sync()
            call.resolve(["entitled": await currentEntitlement()])
        }
    }
}

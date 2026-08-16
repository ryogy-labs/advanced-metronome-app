import UIKit
import Capacitor

@objc(BridgeViewController)
class BridgeViewController: CAPBridgeViewController {
    // Plugins in this app are registered explicitly rather than discovered.
    // A plugin that compiles but is missing from this list is silently
    // unreachable from JS, so every plugin added under App/ belongs here.
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MetronomeAudioPlugin())
        bridge?.registerPluginInstance(InAppPurchasePlugin())
        bridge?.registerPluginInstance(DataStorePlugin())
    }
}

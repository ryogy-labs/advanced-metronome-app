#import <Capacitor/Capacitor.h>

CAP_PLUGIN(InAppPurchasePlugin, "InAppPurchase",
  CAP_PLUGIN_METHOD(getProduct, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(isEntitled, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(purchase, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(restore, CAPPluginReturnPromise);
)

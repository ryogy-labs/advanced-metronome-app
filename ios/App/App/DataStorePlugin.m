#import <Capacitor/Capacitor.h>

CAP_PLUGIN(DataStorePlugin, "DataStore",
  CAP_PLUGIN_METHOD(read, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(write, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(exportFile, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(importFile, CAPPluginReturnPromise);
)

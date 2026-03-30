#import <Capacitor/Capacitor.h>

CAP_PLUGIN(MetronomeAudioPlugin, "MetronomeAudio",
  CAP_PLUGIN_METHOD(prepareLoop, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(startLoop, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(stopLoop, CAPPluginReturnPromise);
)

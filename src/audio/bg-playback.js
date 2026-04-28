// Background-playback controller.
//
// Foreground playback runs through the Web Audio scheduler. When the page
// becomes hidden (or the app moves to the background on iOS), Safari is
// far more reliable about keeping an HTMLAudioElement alive than a Web
// Audio AudioContext, so we cross-fade to a pre-rendered WAV click loop:
//
//   - In a browser PWA: play a pre-rendered WAV through an `<audio>`
//     element (`_bgLoopEl`). The element is muted while foreground so it
//     doesn't double up with the live scheduler; we toggle muted on
//     visibilitychange.
//
//   - On native iOS (Capacitor): hand the same WAV to the native
//     MetronomeAudio plugin which loops it on the audio session that
//     keeps playing in the background.
//
// The HTMLAudioElement variant has a quirk: rebuilding the WAV from
// `bg-loop.js` blocks the main thread for tens of ms, long enough to
// starve the foreground scheduler's short look-ahead window during the
// first measure of playback. `refreshWhenSafe()` defers that rebuild
// until either visibility flips or the first measure has elapsed.
//
// Inputs:
//   - getCtx                : () => AudioContext (forwarded to bg-loop.js)
//   - isNative              : boolean — native iOS vs browser
//   - nativePlugin          : the registered MetronomeAudio plugin (only
//                             read on native)
//   - bgLoopBuilder         : output of createBgLoopBuilder({ getCtx, isNative })
//   - getQuarterBeatSound   : (idx) => 'accent'|'normal'|'mute' — same
//                             helper the scheduler uses
//   - getRunning            : () => bool   — playback active?
//   - getMuted              : () => bool   — user-toggled mute?
//   - getLoopParams         : () => bag of { bpm, beatsPerMeasure, tsDen,
//                             beatStates, masterVol, volBeat1, volQuarter,
//                             volEighth, volSixteenth }, used to render
//                             the loop WAV
//   - getMeasureMs          : () => number — `(60000/bpm) * beatsPerMeasure`
//   - onNativeStart         : () => void — fires once after the native
//                             plugin starts, so the host can anchor the
//                             ball animator's `nativeLoopAnchorMs`.

export function createBgPlayback({
  isNative,
  nativePlugin,
  bgLoopBuilder,
  arrayBufferToBase64,
  getQuarterBeatSound,
  getRunning,
  getMuted,
  getLoopParams,
  getMeasureMs,
  onNativeStart,
}) {
  let _bgLoopEl = null;
  let _bgLoopReloading = false;
  let _bgLoopRefreshTimer = null;
  let _nativeLoopPreparePromise = null;

  function buildClickLoopWav() {
    return bgLoopBuilder.build(getLoopParams(), getQuarterBeatSound);
  }

  function initBgLoopEl() {
    if (_bgLoopEl) return;
    _bgLoopEl = new Audio();
    _bgLoopEl.loop = true;
    _bgLoopEl.preload = 'auto';
    _bgLoopEl.muted = true;
    _bgLoopEl.playsInline = true;
    _bgLoopEl.setAttribute('playsinline', '');
    _bgLoopEl.setAttribute('webkit-playsinline', '');
    // If the OS pauses the element (e.g. interruptions) but we're still
    // running, claw it back. Skip the recovery while we're swapping the
    // src — the synchronous `load()` call fires `pause` immediately.
    _bgLoopEl.addEventListener('pause', () => {
      if (!getRunning() || _bgLoopReloading) return;
      _bgLoopEl.play().catch(() => {});
    });
  }

  function syncMuted() {
    // Foreground: always mute the bg loop (live scheduler is audible).
    // Hidden : honor the user's mute toggle.
    if (_bgLoopEl) _bgLoopEl.muted = !document.hidden ? true : getMuted();
  }

  async function refreshBgLoopTrack() {
    initBgLoopEl();
    const nextSrc = await buildClickLoopWav();
    if (_bgLoopEl.src !== nextSrc) {
      const wasPlaying = !_bgLoopEl.paused;
      _bgLoopReloading = true;
      _bgLoopEl.src = nextSrc;
      _bgLoopEl.load();
      _bgLoopReloading = false;
      if (wasPlaying) _bgLoopEl.play().catch(() => {});
    }
  }

  async function prepareNativeLoop() {
    const url = await buildClickLoopWav();
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);
    await nativePlugin.prepareLoop({ base64 }).catch(err => {
      console.error('[MetronomeAudio] prepareLoop failed', err);
      throw err;
    });
  }

  function syncNativeState() {
    if (!getRunning()) return Promise.resolve();
    return nativePlugin.startLoop({ muted: getMuted() }).catch(err => {
      console.error('[MetronomeAudio] startLoop failed', err);
    });
  }

  function refreshNow() {
    if (isNative) {
      _nativeLoopPreparePromise = prepareNativeLoop().then(() => syncNativeState());
      return _nativeLoopPreparePromise;
    }
    return refreshBgLoopTrack();
  }

  function cancelDeferredRefresh() {
    if (_bgLoopRefreshTimer !== null) {
      clearTimeout(_bgLoopRefreshTimer);
      _bgLoopRefreshTimer = null;
    }
  }

  function refreshWhenSafe() {
    if (isNative) return refreshNow();
    cancelDeferredRefresh();
    if (document.hidden || !getRunning()) return refreshNow();

    // Building the fallback WAV can occupy the main thread long enough to
    // starve the short foreground scheduler window, so let the first
    // beats settle first.
    const measureMs = getMeasureMs();
    const delayMs = Math.max(800, Math.min(measureMs + 100, 2500));
    _bgLoopRefreshTimer = setTimeout(() => {
      _bgLoopRefreshTimer = null;
      if (getRunning() && document.hidden) {
        void refreshNow().then(() => {
          if (!getRunning() || !_bgLoopEl) return;
          syncMuted();
          _bgLoopEl.play().catch(() => {});
        });
        return;
      }
      if (getRunning()) {
        const runWhenIdle = window.requestIdleCallback
          ? (cb) => window.requestIdleCallback(cb, { timeout: 1000 })
          : (cb) => setTimeout(cb, 0);
        runWhenIdle(() => {
          if (getRunning() && !document.hidden) {
            void refreshNow().then(() => {
              if (!getRunning() || !_bgLoopEl) return;
              syncMuted();
              _bgLoopEl.play().catch(() => {});
            });
          }
        });
      }
    }, delayMs);
    return Promise.resolve();
  }

  function start() {
    if (isNative) {
      _nativeLoopPreparePromise = prepareNativeLoop().then(() =>
        nativePlugin.startLoop({ muted: getMuted() }).then(() => {
          if (typeof onNativeStart === 'function') onNativeStart();
        }).catch(err => {
          console.error('[MetronomeAudio] startLoop failed', err);
        }));
    } else {
      initBgLoopEl();
      // ユーザージェスチャー内で即 play（iOS autoplay 制限を回避）
      syncMuted();
      if (_bgLoopEl.src) {
        _bgLoopEl.play().catch(() => {});
      }
      void refreshWhenSafe().then(() => {
        if (!getRunning()) return;
        syncMuted();
        _bgLoopEl.play().catch(() => {});
      });
    }
  }

  function stop() {
    cancelDeferredRefresh();
    if (isNative) {
      nativePlugin.stopLoop().catch(err => {
        console.error('[MetronomeAudio] stopLoop failed', err);
      });
    } else if (_bgLoopEl) {
      _bgLoopEl.pause();
      _bgLoopEl.currentTime = 0;
      _bgLoopEl.muted = true;
    }
  }

  // Pre-build the loop WAV at app startup so the first START doesn't pay
  // the OfflineAudioContext render cost. Safe before any user gesture
  // because OfflineAudioContext doesn't need an unlocked AudioContext.
  function warmUp() {
    return isNative ? prepareNativeLoop() : refreshBgLoopTrack();
  }

  function awaitNativePrepare() {
    return _nativeLoopPreparePromise ?? Promise.resolve();
  }

  // Helper used by callers that want to (a) push fresh audio onto the
  // hidden bg loop and (b) immediately play once it lands. Captures the
  // common "refresh + sync + play" pattern that appeared at every site
  // outside this module.
  function refreshAndResume() {
    return refreshNow().then(() => {
      if (!getRunning() || !_bgLoopEl) return;
      syncMuted();
      _bgLoopEl.play().catch(() => {});
    });
  }

  return {
    start,
    stop,
    refreshNow,
    refreshWhenSafe,
    refreshAndResume,
    cancelDeferredRefresh,
    syncMuted,
    syncNativeState,
    awaitNativePrepare,
    warmUp,
  };
}

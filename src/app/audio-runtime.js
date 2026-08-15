// @ts-check

import { registerPlugin } from '@capacitor/core';
import { createBgLoopBuilder, arrayBufferToBase64 } from '../audio/bg-loop.js';
import { createBgPlayback } from '../audio/bg-playback.js';
import { createMasterChain } from '../audio/master-chain.js';
import { createScheduler } from '../audio/scheduler.js';
import { getLoopDurationMs } from '../audio/timing.js';
import { LS_KEYS } from '../config.js';

const NativeMetronomeAudio = registerPlugin('MetronomeAudio');
const capacitor = /** @type {{ isNativePlatform?: () => boolean } | undefined} */ (
  /** @type {any} */ (window).Capacitor
);

/**
 * @typedef {import('../state/song-config.js').BeatState} BeatState
 */

/**
 * @param {{
 *   t: (key: string) => string,
 *   els: { playBtn: HTMLElement, muteBtnEls: HTMLElement[] },
 *   getSchedulerState: () => object,
 *   getLoopParams: () => { bpm: number, beatsPerMeasure: number, [key: string]: unknown },
 *   getQuarterBeatSound: (beatIdx: number) => { volume: number, freq: number, dur: number } | null,
 *   getVisualDelayMs: () => number,
 *   onBeatFlash: (beatIdx: number, scheduledTime?: number) => void,
 *   onVisualReset: (beatIdx?: number | null) => void,
 *   onPlaybackStateChange?: (running: boolean) => void,
 * }} deps
 */
export function createAudioRuntime({
  t,
  els: { playBtn, muteBtnEls },
  getSchedulerState,
  getLoopParams,
  getQuarterBeatSound,
  getVisualDelayMs,
  onBeatFlash,
  onVisualReset,
  onPlaybackStateChange,
}) {
  const isNative = Boolean(capacitor?.isNativePlatform?.());
  let running = false;
  let isMuted = false;
  /** @type {AudioContext | null} */
  let audioCtx = null;
  /** @type {GainNode | null} */
  let masterGainNode = null;
  let playbackRefreshSeq = 0;
  let nativeLoopAnchorMs = 0;
  let wakeLockEnabled = (() => {
    try { return localStorage.getItem(LS_KEYS.wakelock) !== '0'; } catch { return true; }
  })();
  /** @type {WakeLockSentinel | null} */
  let wakeLockSentinel = null;

  (function iosAudioUnlock() {
    // iOS can deliver only part of the gesture sequence depending on
    // Safari/PWA/native shell state, so listen to touchstart, touchend,
    // and click. Capture lets this run before UI handlers; each listener
    // removes itself once the AudioContext has had a chance to resume.
    const unlock = () => {
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      document.removeEventListener('touchstart', unlock, true);
      document.removeEventListener('touchend', unlock, true);
      document.removeEventListener('click', unlock, true);
    };
    document.addEventListener('touchstart', unlock, { capture: true, passive: true });
    document.addEventListener('touchend', unlock, { capture: true, passive: true });
    document.addEventListener('click', unlock, { capture: true, passive: true });
  })();

  function getCtx() {
    if (!audioCtx) {
      const AudioContextCtor = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
      audioCtx = new AudioContextCtor();
      masterGainNode = audioCtx.createGain();
      masterGainNode.gain.value = isMuted ? 0 : 1;
      masterGainNode.connect(createMasterChain(audioCtx, audioCtx.destination));
    }
    return audioCtx;
  }

  const scheduler = createScheduler({
    getCtx,
    getDestination: () => masterGainNode,
    isNative: () => isNative,
    getState: getSchedulerState,
    getQuarterBeatSound,
    onBeatFlash,
    getVisualDelayMs,
  });

  const bgLoopBuilder = createBgLoopBuilder({
    getCtx: () => audioCtx,
    isNative: () => isNative,
  });
  const bgPlayback = createBgPlayback({
    isNative,
    nativePlugin: NativeMetronomeAudio,
    bgLoopBuilder,
    arrayBufferToBase64,
    getQuarterBeatSound,
    getRunning: () => running,
    getMuted: () => isMuted,
    getLoopParams,
    getMeasureMs: () => getLoopDurationMs(getLoopParams()),
    onNativeStart: () => {
      nativeLoopAnchorMs = performance.now();
      onVisualReset(0);
    },
  });

  async function acquireWakeLock() {
    if (!wakeLockEnabled || !('wakeLock' in navigator)) return;
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
    } catch (e) {
      console.warn('[WakeLock] acquire failed:', e);
    }
  }

  function releaseWakeLock() {
    if (!wakeLockSentinel) return;
    wakeLockSentinel.release().catch(() => {});
    wakeLockSentinel = null;
  }

  async function isContextClockAdvancing(ctx) {
    const before = ctx.currentTime;
    await new Promise(resolve => setTimeout(resolve, 60));
    return ctx.currentTime > before + 0.001;
  }

  async function recreateSchedulerContext() {
    if (audioCtx) {
      try { await audioCtx.close(); } catch {}
    }
    audioCtx = null;
    masterGainNode = null;
    const ctx = getCtx();
    try { await ctx.resume(); } catch {}
    return ctx;
  }

  async function ensureSchedulerContextRunning() {
    let ctx = getCtx();
    if (ctx.state === 'running' && await isContextClockAdvancing(ctx)) return true;
    for (let attempt = 0; attempt < 6; attempt++) {
      try { await ctx.resume(); } catch {}
      if (ctx.state === 'running' && await isContextClockAdvancing(ctx)) return true;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!isNative) return false;
    ctx = await recreateSchedulerContext();
    return isContextClockAdvancing(ctx);
  }

  function startSchedulerFromNow() {
    scheduler.start();
    onVisualReset(0);
  }

  function startMetronome() {
    if (running) return;
    const boot = () => {
      running = true;
      startSchedulerFromNow();
      bgPlayback.start();
      playBtn.textContent = t('metro.stop');
      playBtn.classList.add('running');
      void acquireWakeLock();
      onPlaybackStateChange?.(running);
    };
    void ensureSchedulerContextRunning().then(boot);
  }

  function stopMetronome() {
    if (!running) return;
    running = false;
    scheduler.stop();
    nativeLoopAnchorMs = 0;
    bgPlayback.stop();
    playBtn.textContent = t('metro.start');
    playBtn.classList.remove('running');
    releaseWakeLock();
    onVisualReset();
    onPlaybackStateChange?.(running);
  }

  function togglePlayback() {
    if (running) stopMetronome();
    else startMetronome();
  }

  function setMute(m) {
    isMuted = m;
    if (masterGainNode && audioCtx) {
      masterGainNode.gain.setTargetAtTime(m ? 0 : 1, audioCtx.currentTime, 0.015);
    }
    if (isNative && running) {
      void bgPlayback.awaitNativePrepare().then(() => bgPlayback.syncNativeState());
    }
    bgPlayback.syncMuted();
    muteBtnEls.forEach(btn => {
      btn.classList.toggle('muted', m);
      btn.textContent = m ? '🔇' : '🔊';
    });
  }

  function refreshRunningPlayback({ realignVisuals = false } = {}) {
    if (!running) return;
    const refreshSeq = ++playbackRefreshSeq;
    if (!isNative) {
      if (realignVisuals) startSchedulerFromNow();
      bgPlayback.refreshWhenSafe();
      return;
    }
    void bgPlayback.refreshNow().then(() => {
      if (!running || refreshSeq !== playbackRefreshSeq) return;
      if (realignVisuals) {
        nativeLoopAnchorMs = performance.now();
        onVisualReset(0);
      }
    });
  }

  function refreshRunningLoopOnly() {
    refreshRunningPlayback({ realignVisuals: isNative });
  }

  function resumeForegroundScheduler() {
    if (!running || !audioCtx || document.hidden) return;
    if (isNative) {
      void bgPlayback.syncNativeState();
    } else {
      bgPlayback.syncMuted();
    }
    void ensureSchedulerContextRunning().then(isRunning => {
      if (running && isRunning) startSchedulerFromNow();
    });
  }

  function getAudioContextTimeForNow() {
    if (!audioCtx) return null;
    if (typeof audioCtx.getOutputTimestamp === 'function') {
      const timestamp = audioCtx.getOutputTimestamp();
      const { contextTime, performanceTime } = timestamp;
      if (
        typeof contextTime === 'number' &&
        typeof performanceTime === 'number' &&
        Number.isFinite(contextTime) &&
        Number.isFinite(performanceTime)
      ) {
        return contextTime + (performance.now() - performanceTime) / 1000;
      }
    }
    return audioCtx.currentTime;
  }

  function applyI18n() {
    playBtn.textContent = running ? t('metro.stop') : t('metro.start');
  }

  document.addEventListener('visibilitychange', () => {
    if (!running || !audioCtx) return;
    if (document.hidden) {
      scheduler.stop();
      if (isNative) {
        audioCtx.suspend().catch(() => {});
        void bgPlayback.awaitNativePrepare().then(() => bgPlayback.syncNativeState());
      } else {
        bgPlayback.cancelDeferredRefresh();
        void bgPlayback.refreshAndResume();
        bgPlayback.syncMuted();
      }
    } else {
      resumeForegroundScheduler();
      if (wakeLockEnabled) void acquireWakeLock();
    }
  });
  window.addEventListener('focus', resumeForegroundScheduler);
  window.addEventListener('pageshow', resumeForegroundScheduler);

  return {
    isNative,
    get running() { return running; },
    get muted() { return isMuted; },
    get nativeLoopAnchorMs() { return nativeLoopAnchorMs; },
    getAudioCtx: () => audioCtx,
    getScheduledBeatTimes: () => scheduler.getScheduledBeatTimes(),
    getAudioContextTimeForNow,
    startMetronome,
    stopMetronome,
    togglePlayback,
    setMute,
    toggleMute: () => setMute(!isMuted),
    refreshRunningPlayback,
    refreshRunningLoopOnly,
    getWakeLockEnabled: () => wakeLockEnabled,
    setWakeLockEnabled: (enabled) => {
      wakeLockEnabled = enabled;
      try { localStorage.setItem(LS_KEYS.wakelock, enabled ? '1' : '0'); } catch {}
      if (!enabled) releaseWakeLock();
      else if (running) void acquireWakeLock();
    },
    applyI18n,
    warmUp: () => bgPlayback.warmUp(),
  };
}

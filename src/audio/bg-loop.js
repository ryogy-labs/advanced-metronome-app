import {
  BG_LOOP_MEASURES,
  NATIVE_BG_LOOP_MEASURES,
  CLICK_EIGHTH,
  CLICK_SIXTEENTH,
} from '../config.js';
import { createMasterChain } from './master-chain.js';
import { renderClick, getSubdivisionsPerBeat } from './synth.js';
import { buildMeasureSubBeatEvents } from './timing.js';

// Builds a looping click WAV blob whose silent looping plays back even when
// the page is hidden. Cached by signature so identical state reuses the URL.
export function createBgLoopBuilder({ getCtx, isNative }) {
  let url = null;
  let sig = '';
  let pendingSig = '';
  let buildPromise = null;

  function computeSig(state) {
    return [
      state.bpm,
      state.beatsPerMeasure,
      state.tsDen,
      state.beatStates.join(','),
      state.masterVol,
      state.volBeat1,
      state.volQuarter,
      state.volEighth,
      state.volSixteenth,
      state.swingMode,
      state.swingAmount,
    ].join('|');
  }

  async function build(state, getQuarterBeatSound) {
    const nextSig = computeSig(state);
    if (url && sig === nextSig) return url;
    if (buildPromise && pendingSig === nextSig) return buildPromise;

    pendingSig = nextSig;
    buildPromise = (async () => {
      const liveCtx = getCtx();
      const rate = liveCtx ? liveCtx.sampleRate : 44100;
      const beatDur = 60 / state.bpm;
      const subdivisions = getSubdivisionsPerBeat(state.tsDen);
      const loopMeasures = isNative() ? NATIVE_BG_LOOP_MEASURES : BG_LOOP_MEASURES;
      const loopDuration = beatDur * state.beatsPerMeasure * loopMeasures;
      const frameCount = Math.max(1, Math.ceil(rate * loopDuration));
      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const offlineCtx = new OfflineCtx(1, frameCount, rate);
      const clickBus = createMasterChain(offlineCtx, offlineCtx.destination);

      const measureEvents = buildMeasureSubBeatEvents({
        bpm: state.bpm,
        beatsPerMeasure: state.beatsPerMeasure,
        tsDen: state.tsDen,
        swingMode: state.swingMode,
        swingAmount: state.swingAmount,
      });
      for (let measure = 0; measure < loopMeasures; measure++) {
        const measureBaseTime = measure * beatDur * state.beatsPerMeasure;
        for (const event of measureEvents) {
          const subBeat = event.subBeat;
          const time = measureBaseTime + event.offsetSec;
          const beatOffset = subBeat % subdivisions;
          const beatIdx = Math.floor(subBeat / subdivisions);
          if (beatOffset === 0) {
            const sound = getQuarterBeatSound(beatIdx);
            if (sound) renderClick(offlineCtx, clickBus, time, sound.volume, sound.freq, sound.dur);
          } else if (subdivisions === 2 || beatOffset === 2) {
            renderClick(offlineCtx, clickBus, time, state.volEighth * state.masterVol, CLICK_EIGHTH.freq, CLICK_EIGHTH.dur);
          } else {
            renderClick(offlineCtx, clickBus, time, state.volSixteenth * state.masterVol, CLICK_SIXTEENTH.freq, CLICK_SIXTEENTH.dur);
          }
        }
      }

      const rendered = await offlineCtx.startRendering();
      const nextUrl = encodeWavUrl(rendered, rate);
      if (url && sig !== nextSig) URL.revokeObjectURL(url);
      url = nextUrl;
      sig = nextSig;
      return nextUrl;
    })();

    try {
      return await buildPromise;
    } finally {
      if (pendingSig === nextSig) {
        buildPromise = null;
      }
    }
  }

  return { build };
}

function encodeWavUrl(rendered, rate) {
  const pcm = rendered.getChannelData(0);
  const ab = new ArrayBuffer(44 + pcm.length * 2);
  const dv = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };

  ws(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true);
  ws(8, 'WAVE'); ws(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ws(36, 'data'); dv.setUint32(40, pcm.length * 2, true);

  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    dv.setInt16(44 + i * 2, s * 32767, true);
  }

  return URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
}

export function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let b64 = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    b64 += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(b64);
}

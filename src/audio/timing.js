import { SWING_MAX, SWING_MIN, SWING_STRAIGHT_AMOUNT } from '../config.js';

export function getBeatDurationMs(bpm) {
  return 60000 / bpm;
}

export function getBeatDurationSec(bpm) {
  return 60 / bpm;
}

export function getLoopDurationMs({ bpm, beatsPerMeasure }) {
  return getBeatDurationMs(bpm) * beatsPerMeasure;
}

export function clampSwingAmount(amount) {
  const next = Number(amount);
  if (!Number.isFinite(next)) return SWING_STRAIGHT_AMOUNT;
  return Math.min(SWING_MAX, Math.max(SWING_MIN, next));
}

export function getSubBeatOffsetSec({
  subBeat,
  bpm,
  tsDen,
  swingMode = 'off',
  swingAmount = 50,
}) {
  const beatDurSec = getBeatDurationSec(bpm);
  const subdivisions = 16 / tsDen;
  const subdivisionDurSec = beatDurSec / subdivisions;
  const straightOffsetSec = subBeat * subdivisionDurSec;
  if (swingMode === 'off') return straightOffsetSec;

  const ratio = clampSwingAmount(swingAmount) / 100;

  if (swingMode === 'sixteenth' && subdivisions >= 2 && subBeat % 2 === 1) {
    const pairStart = (subBeat - 1) * subdivisionDurSec;
    return pairStart + subdivisionDurSec * 2 * ratio;
  }

  if (swingMode === 'eighth') {
    if (tsDen === 4 && subBeat % 4 === 2) {
      const beatStart = Math.floor(subBeat / 4) * beatDurSec;
      return beatStart + beatDurSec * ratio;
    }
    if (tsDen === 8 && subBeat % 4 === 2) {
      const pairStart = Math.floor(subBeat / 4) * beatDurSec * 2;
      return pairStart + beatDurSec * 2 * ratio;
    }
  }

  return straightOffsetSec;
}

export function buildMeasureSubBeatEvents({
  bpm,
  beatsPerMeasure,
  tsDen,
  swingMode = 'off',
  swingAmount = 50,
}) {
  const subdivisions = 16 / tsDen;
  const total = beatsPerMeasure * subdivisions;
  return Array.from({ length: total }, (_, subBeat) => ({
    subBeat,
    offsetSec: getSubBeatOffsetSec({ subBeat, bpm, tsDen, swingMode, swingAmount }),
  })).sort((a, b) => a.offsetSec - b.offsetSec || a.subBeat - b.subBeat);
}

export function getLoopPositionMs({ nowMs, anchorMs, bpm, beatsPerMeasure }) {
  const elapsedMs = Math.max(0, nowMs - anchorMs);
  return elapsedMs % getLoopDurationMs({ bpm, beatsPerMeasure });
}

export function getBeatPositionFromLoopMs({
  loopMs,
  bpm,
  beatsPerMeasure,
  tsDen = 4,
  swingMode = 'off',
  swingAmount = 50,
}) {
  const beatDurMs = getBeatDurationMs(bpm);
  const subdivisions = 16 / tsDen;
  const measureDurMs = beatDurMs * beatsPerMeasure;
  const beatOffsets = Array.from({ length: beatsPerMeasure }, (_, beatIdx) =>
    getSubBeatOffsetSec({
      subBeat: beatIdx * subdivisions,
      bpm,
      tsDen,
      swingMode,
      swingAmount,
    }) * 1000
  );

  for (let i = 0; i < beatOffsets.length; i++) {
    const start = beatOffsets[i];
    const next = i < beatOffsets.length - 1 ? beatOffsets[i + 1] : measureDurMs + beatOffsets[0];
    if (loopMs >= start && loopMs < next) {
      return {
        beatIdx: i,
        phase: Math.min(Math.max((loopMs - start) / (next - start), 0), 1),
      };
    }
  }

  return { beatIdx: 0, phase: 0 };
}

export function getNativeBeatPosition({
  nowMs,
  anchorMs,
  bpm,
  beatsPerMeasure,
  tsDen = 4,
  swingMode = 'off',
  swingAmount = 50,
}) {
  return getBeatPositionFromLoopMs({
    loopMs: getLoopPositionMs({ nowMs, anchorMs, bpm, beatsPerMeasure }),
    bpm,
    beatsPerMeasure,
    tsDen,
    swingMode,
    swingAmount,
  });
}

export function findLastScheduledBeat({ scheduledBeatTimes, nowSec }) {
  for (let i = scheduledBeatTimes.length - 1; i >= 0; i--) {
    if (scheduledBeatTimes[i].time <= nowSec) return scheduledBeatTimes[i];
  }
  return null;
}

export function getScheduledBeatPosition({ scheduledBeatTimes, nowSec, bpm }) {
  const lastBeat = findLastScheduledBeat({ scheduledBeatTimes, nowSec });
  if (!lastBeat) return null;
  const nextBeat = scheduledBeatTimes.find(beat => beat.time > lastBeat.time);
  const beatDurSec = getBeatDurationSec(bpm);
  const beatSpanSec = nextBeat ? nextBeat.time - lastBeat.time : beatDurSec;
  return {
    beatIdx: lastBeat.beatIdx,
    phase: Math.min((nowSec - lastBeat.time) / beatSpanSec, 1),
  };
}

export function getBeatDurationMs(bpm) {
  return 60000 / bpm;
}

export function getBeatDurationSec(bpm) {
  return 60 / bpm;
}

export function getLoopDurationMs({ bpm, beatsPerMeasure }) {
  return getBeatDurationMs(bpm) * beatsPerMeasure;
}

export function getLoopPositionMs({ nowMs, anchorMs, bpm, beatsPerMeasure }) {
  const elapsedMs = Math.max(0, nowMs - anchorMs);
  return elapsedMs % getLoopDurationMs({ bpm, beatsPerMeasure });
}

export function getBeatPositionFromLoopMs({ loopMs, bpm, beatsPerMeasure }) {
  const beatDurMs = getBeatDurationMs(bpm);
  return {
    beatIdx: Math.floor(loopMs / beatDurMs) % beatsPerMeasure,
    phase: (loopMs % beatDurMs) / beatDurMs,
  };
}

export function getNativeBeatPosition({ nowMs, anchorMs, bpm, beatsPerMeasure }) {
  return getBeatPositionFromLoopMs({
    loopMs: getLoopPositionMs({ nowMs, anchorMs, bpm, beatsPerMeasure }),
    bpm,
    beatsPerMeasure,
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
  const beatDurSec = getBeatDurationSec(bpm);
  return {
    beatIdx: lastBeat.beatIdx,
    phase: Math.min((nowSec - lastBeat.time) / beatDurSec, 1),
  };
}

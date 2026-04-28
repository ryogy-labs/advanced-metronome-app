// 16th-note resolution metronome scheduler.
//
// Owns its own loop timer (`setTimeout` driven), the running sub-beat counter,
// the next-note audio-clock timestamp, and a short ring of recently scheduled
// beat times that visualizers (ball animation, beat indicator) read back.
//
// Behavior is identical to the previous inline scheduler in main.js:
//   - On x/4 the first subdivision is an 8th note, the second is a 16th.
//   - On x/8 there is only one subdivision (an 8th); 16th rendering is skipped.
//   - On native (Capacitor) live `playClick` is suppressed because the native
//     plugin owns the audible loop, but the scheduler still runs to drive
//     visual flashes.

import {
  CLICK_EIGHTH,
  CLICK_SIXTEENTH,
  SCHEDULER_LOOKAHEAD_MS,
  SCHEDULER_AHEAD_SEC,
} from '../config.js';
import { renderClick, getSubdivisionsPerBeat } from './synth.js';
import { getBeatDurationSec } from './timing.js';

export function createScheduler({
  getCtx,
  getDestination,
  isNative,
  getState,
  getQuarterBeatSound,
  onBeatFlash,
}) {
  let nextNoteTime = 0;
  let subBeatCount = 0;
  let timerID = null;
  let scheduledBeatTimes = [];

  function playClickInternal(time, vol, freq, dur) {
    if (isNative()) return;
    if (vol <= 0) return;
    renderClick(getCtx(), getDestination(), time, vol, freq, dur);
  }

  function scheduleNote(time, subBeat) {
    const { tsDen, masterVol, volEighth, volSixteenth } = getState();
    const subdivisions = getSubdivisionsPerBeat(tsDen);
    const beatOffset = subBeat % subdivisions;
    const beatIdx = Math.floor(subBeat / subdivisions);

    if (beatOffset === 0) {
      scheduledBeatTimes.push({ time, beatIdx });
      if (scheduledBeatTimes.length > 8) scheduledBeatTimes.shift();
      const delay = (time - getCtx().currentTime) * 1000;
      setTimeout(() => onBeatFlash(beatIdx, time), Math.max(0, delay));
      const beatSound = getQuarterBeatSound(beatIdx);
      if (beatSound) {
        playClickInternal(time, beatSound.volume, beatSound.freq, beatSound.dur);
      }
    } else if (subdivisions === 2 || beatOffset === 2) {
      // First subdivision: 8ths in x/4, 16ths in x/8.
      playClickInternal(time, volEighth * masterVol, CLICK_EIGHTH.freq, CLICK_EIGHTH.dur);
    } else {
      // Second subdivision in x/4 only: 16ths.
      playClickInternal(time, volSixteenth * masterVol, CLICK_SIXTEENTH.freq, CLICK_SIXTEENTH.dur);
    }
  }

  function tick() {
    const ctx = getCtx();
    const { bpm, beatsPerMeasure, tsDen } = getState();
    const subdivisions = getSubdivisionsPerBeat(tsDen);
    const beatIntervalSec = getBeatDurationSec(bpm);
    const subdivisionInterval = beatIntervalSec / subdivisions;
    const measureSubdivisionCount = beatsPerMeasure * subdivisions;

    while (nextNoteTime < ctx.currentTime + SCHEDULER_AHEAD_SEC) {
      scheduleNote(nextNoteTime, subBeatCount);
      subBeatCount = (subBeatCount + 1) % measureSubdivisionCount;
      nextNoteTime += subdivisionInterval;
    }
    timerID = setTimeout(tick, SCHEDULER_LOOKAHEAD_MS);
  }

  function start() {
    const ctx = getCtx();
    if (timerID) {
      clearTimeout(timerID);
      timerID = null;
    }
    subBeatCount = 0;
    nextNoteTime = ctx.currentTime + (isNative() ? 0.005 : 0.05);
    scheduledBeatTimes = [];
    tick();
  }

  function stop() {
    if (timerID) {
      clearTimeout(timerID);
      timerID = null;
    }
    scheduledBeatTimes = [];
  }

  function getScheduledBeatTimes() {
    return scheduledBeatTimes;
  }

  return { start, stop, getScheduledBeatTimes };
}

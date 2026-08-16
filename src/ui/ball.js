// Bouncing-ball metronome visual.
//
// The animator owns:
//   - the list of `.ball-canvas` elements + their 2D contexts
//   - the requestAnimationFrame loop
//   - the per-frame phase/beat-index calculation (Web Audio path or native
//     loop path, fallback when stopped)
//   - the ball + shadow + ground line draw routine
//
// It does NOT own:
//   - which beats are accent/normal/mute (read via getBeatIndicatorState)
//   - the visual flash on the beat dots (driven by the scheduler's flashBeat;
//     when the audible loop is the native plugin or while stopped, the
//     animator drives it via onNativeBeat / onIdle so the dots stay in sync
//     with the ball position).

import { BALL_R, BALL_RANGE_SCALE, BALL_TOP_MARGIN } from '../config.js';
import { getNativeBeatPosition, getScheduledBeatPosition } from '../audio/timing.js';

const COLOR_ACCENT = '#fc5c7d';
const COLOR_MUTE   = '#a8a8b8';
const COLOR_NORMAL = '#7c5cfc';

function getBallColorForBeatState(state) {
  if (state === 'accent') return COLOR_ACCENT;
  if (state === 'mute')   return COLOR_MUTE;
  return COLOR_NORMAL;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function drawBallFrame(ctx, w, h, phase, beatIdx, topMargin, opts) {
  const { running, animMode, squashEnabled, beatsPerMeasure, beatState } = opts;

  ctx.clearRect(0, 0, w, h);

  const groundYBase = h - 10;
  const ballColor = running ? getBallColorForBeatState(beatState) : getBallColorForBeatState('normal');
  const ballRgb = hexToRgb(ballColor);
  const margin = BALL_R + 4;
  const cx = animMode === 'horizontal'
    ? margin + ((beatIdx + phase) / beatsPerMeasure) * (w - 2 * margin)
    : w / 2;

  // Asymmetric free-fall height fraction (0 at ground, 1 at apex)
  // Rising (0→alpha): easeOutQuad — fast launch, decelerates to zero at apex
  // Falling (alpha→1): easeInCubic — starts near-zero at apex, accelerates to ground
  const alpha = 0.35;
  let heightFrac;
  if (phase <= alpha) {
    const t = phase / alpha;
    heightFrac = t * (2 - t);           // easeOutQuad: 0→1
  } else {
    const t = (phase - alpha) / (1 - alpha);
    heightFrac = 1 - t * t * t;         // easeInCubic: 1→0
  }

  // isGrounding: true only in the first half of each beat (just after landing).
  // Prevents false impact detection at phase≈1 end-of-beat where heightFrac
  // also approaches 0 but lastBeat still points to the previous beat.
  const isGrounding = phase < 0.5;

  const squash = (running && squashEnabled && isGrounding) ? Math.max(0, 1 - heightFrac * 8) : 0;
  const rx = BALL_R * (1 + 0.5 * squash);
  const ry = BALL_R * (1 - 0.3 * squash);

  // Fit jump height to canvas so apex sits near the top instead of leaving large blank space.
  const fullRange = Math.max(60, groundYBase - (BALL_R * 2) - topMargin);
  const ballMaxH = Math.max(60, fullRange * BALL_RANGE_SCALE);
  const groundY = ballMaxH + (BALL_R * 2) + topMargin;
  const ballY = groundY - ry - heightFrac * ballMaxH;

  // Shadow (grows darker/larger as ball approaches ground)
  const shadowAlpha = 0.08 + 0.22 * (1 - heightFrac);
  const shadowRx    = BALL_R * (0.5 + 0.9 * (1 - heightFrac));
  ctx.save();
  ctx.fillStyle = `rgba(${ballRgb.r}, ${ballRgb.g}, ${ballRgb.b}, ${shadowAlpha})`;
  ctx.beginPath();
  ctx.ellipse(cx, groundY, shadowRx, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Ground line
  ctx.save();
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(w, groundY);
  ctx.stroke();
  ctx.restore();

  // Ball
  const isImpact = phase < 0.15 && running;
  ctx.save();
  ctx.shadowColor = ballColor;
  ctx.shadowBlur  = isImpact && beatState === 'accent' ? 24 : 14;
  ctx.fillStyle   = ballColor;
  ctx.beginPath();
  ctx.ellipse(cx, ballY, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function createBallAnimator({
  canvasSelector = '.ball-canvas',
  getState,                  // () => { running, bpm, beatsPerMeasure, tsDen, swingMode, swingAmount, animMode, squashEnabled }
  getAudioCtx,               // () => AudioContext | null
  getScheduledBeatTimes,     // () => [{ time, beatIdx }]
  isNative,                  // () => bool
  getNativeLoopAnchorMs,     // () => number (0 means inactive)
  getBeatIndicatorState,     // (beatIdx) => 'accent' | 'normal' | 'mute'
  getVisualDelayMs = () => 0,
  onNativeBeat,              // (beatIdx) => void  — called per frame on native path
  onIdle,                    // () => void — called per frame when not running
}) {
  let canvases = [];

  function refresh() {
    canvases = Array.from(document.querySelectorAll(canvasSelector))
      .map(canvas => ({ canvas, ctx: canvas.getContext('2d') }))
      .filter(v => !!v.ctx);
    observeSizes();
  }

  function resize() {
    canvases.forEach(({ canvas }) => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width  = w;
        canvas.height = h;
      }
    });
  }

  // The canvas is flex-sized, so its box can change without a window resize
  // (keyboard, rotation, page enter). A stale bitmap gets stretched to fit,
  // which distorts the bounce and misplaces the ground line.
  const sizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => resize())
    : null;

  function observeSizes() {
    if (!sizeObserver) return;
    sizeObserver.disconnect();
    canvases.forEach(({ canvas }) => sizeObserver.observe(canvas));
  }

  function frame() {
    const { running, bpm, beatsPerMeasure, tsDen, swingMode, swingAmount, animMode, squashEnabled } = getState();
    const visualDelayMs = Math.max(0, Number(getVisualDelayMs()) || 0);

    let phase   = 0;
    let beatIdx = 0;
    if (isNative() && running && getNativeLoopAnchorMs() > 0) {
      ({ beatIdx, phase } = getNativeBeatPosition({
        nowMs: performance.now() - visualDelayMs,
        anchorMs: getNativeLoopAnchorMs(),
        bpm,
        beatsPerMeasure,
        tsDen,
        swingMode,
        swingAmount,
      }));
      onNativeBeat(beatIdx);
    } else if (running && getAudioCtx()) {
      const now = getAudioCtx().currentTime - (visualDelayMs / 1000);
      const position = getScheduledBeatPosition({
        scheduledBeatTimes: getScheduledBeatTimes(),
        nowSec: now,
        bpm,
      });
      if (position) {
        ({ beatIdx, phase } = position);
      }
    } else {
      onIdle();
    }

    canvases.forEach(({ canvas, ctx }) => {
      if (canvas.width === 0 || canvas.height === 0) return;
      let topMargin = BALL_TOP_MARGIN;
      const pageEl = canvas.closest('.swipe-page');
      const titleEl = pageEl ? pageEl.querySelector('.swipe-page-title') : null;
      if (titleEl) {
        const titleRect = titleEl.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        topMargin = Math.max(0, (titleRect.bottom + BALL_TOP_MARGIN) - canvasRect.top);
      }
      const beatState = getBeatIndicatorState(beatIdx);
      drawBallFrame(ctx, canvas.width, canvas.height, phase, beatIdx, topMargin, {
        running, animMode, squashEnabled, beatsPerMeasure, beatState,
      });
    });

    requestAnimationFrame(frame);
  }

  function start() {
    requestAnimationFrame(frame);
  }

  return { refresh, resize, start };
}

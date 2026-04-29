// Centralized constants. Keep this list authoritative — SPEC.md defers to it.

export const BPM_MIN = 20;
export const BPM_MAX = 300;
export const BPM_DEFAULT = 120;

export const TAP_RESET_MS = 2500;

// Scheduler timing
export const SCHEDULER_LOOKAHEAD_MS = 25;
export const SCHEDULER_AHEAD_SEC = 0.1;

// Time signature picker options
export const TS_NUMS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const TS_DENS = [4, 8];

// Swing timing
export const SWING_MODES = ['off', 'eighth', 'sixteenth'];
export const SWING_DEFAULT_MODE = 'off';
export const SWING_DEFAULT_AMOUNT = 66.7;
export const SWING_MIN = 0.1;
export const SWING_MAX = 99.9;
export const SWING_STRAIGHT_AMOUNT = 50;
export const SWING_PRESETS = [
  { label: '0', value: SWING_MIN },
  { label: '50', value: SWING_STRAIGHT_AMOUNT },
  { label: '66.7', value: SWING_DEFAULT_AMOUNT },
  { label: '100', value: SWING_MAX },
];

// Background WAV loop length (in measures)
export const BG_LOOP_MEASURES = 32;
export const NATIVE_BG_LOOP_MEASURES = 2;

// Ball animation
export const BALL_TOP_MARGIN = 15;
export const BALL_RANGE_SCALE = 0.8;
export const BALL_R = 30;
export const VISUAL_DELAY_DEFAULT_MS = 0;
export const VISUAL_DELAY_MIN_MS = 0;
export const VISUAL_DELAY_MAX_MS = 500;
export const VISUAL_DELAY_STEP_MS = 5;

// Swipe carousel
export const SWIPE_TOTAL_PAGES = 4;
export const SWIPE_SLOT_STEP = 100 / (SWIPE_TOTAL_PAGES + 2); // % per slot, including clone sentinels
export const SWIPE_THRESHOLD_PX = 50;

// Free-tier limits before paywall
export const FREE_SETLIST_LIMIT = 1;
export const FREE_SONGS_PER_SETLIST = 10;
export const FREE_LIBRARY_LIMIT = 10;

// Click sound parameters (frequencies / durations)
export const CLICK_ACCENT = { freq: 1200, dur: 0.030 };
export const CLICK_QUARTER = { freq: 900, dur: 0.025 };
export const CLICK_EIGHTH = { freq: 700, dur: 0.022 };
export const CLICK_SIXTEENTH = { freq: 550, dur: 0.018 };

// localStorage keys
export const LS_KEYS = {
  setlists: 'metro-setlists',
  songLib: 'metro-song-lib',
  lang: 'metro-lang',
  wakelock: 'metro-wakelock',
  visualDelayMs: 'metro-visual-delay-ms',
  devForcePro: 'metro-dev-force-pro',
};

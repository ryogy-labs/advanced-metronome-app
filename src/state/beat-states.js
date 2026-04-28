export function buildDefaultBeatStates(count, tsDen) {
  return Array.from({ length: count }, (_, idx) => {
    const isCompoundAccent = tsDen === 8 && count >= 6 && count % 3 === 0 && idx % 3 === 0;
    return idx === 0 || isCompoundAccent ? 'accent' : 'normal';
  });
}

export function normalizeBeatStates(states, count, tsDen) {
  const fallback = buildDefaultBeatStates(count, tsDen);
  if (!Array.isArray(states)) return fallback;
  return fallback.map((state, idx) => {
    const next = states[idx];
    return next === 'accent' || next === 'normal' || next === 'mute' ? next : state;
  });
}

export function getNextBeatState(state) {
  if (state === 'accent') return 'normal';
  if (state === 'normal') return 'mute';
  return 'accent';
}

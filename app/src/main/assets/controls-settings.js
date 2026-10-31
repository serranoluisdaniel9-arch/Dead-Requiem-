export const DEFAULT_CONTROLS = Object.freeze({ look: 100, aim: 65 });
export const CONTROLS_KEY = 'distrito09.controls.v1';

export function normalizeControls(value) {
  const input = value && typeof value === 'object' ? value : {};
  const percent = (n, min, max, fallback) =>
    Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n)) / 5) * 5 : fallback;
  return {
    look: percent(input.look, 30, 180, DEFAULT_CONTROLS.look),
    aim: percent(input.aim, 20, 150, DEFAULT_CONTROLS.aim),
  };
}

export function loadControls() {
  try {
    return normalizeControls(JSON.parse(globalThis.localStorage.getItem(CONTROLS_KEY)));
  } catch (_) {
    return { ...DEFAULT_CONTROLS };
  }
}

export function saveControls(value) {
  try {
    globalThis.localStorage.setItem(CONTROLS_KEY, JSON.stringify(normalizeControls(value)));
    return true;
  } catch (_) {
    // Private/blocked storage must not prevent playing or adjusting this session.
    return false;
  }
}

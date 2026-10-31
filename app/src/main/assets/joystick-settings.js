export const DEFAULT_JOYSTICK = Object.freeze({ size: 122, x: .025, y: .96 });
export const JOYSTICK_KEY = 'distrito09.joystick.v1';

export function normalizeJoystick(value) {
  const input = value && typeof value === 'object' ? value : {};
  const bounded = (number, min, max, fallback) =>
    Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  return {
    size: Math.round(bounded(input.size, 76, 180, DEFAULT_JOYSTICK.size)),
    x: bounded(input.x, 0, 1, DEFAULT_JOYSTICK.x),
    y: bounded(input.y, 0, 1, DEFAULT_JOYSTICK.y),
  };
}

export function loadJoystick() {
  try {
    return normalizeJoystick(JSON.parse(globalThis.localStorage.getItem(JOYSTICK_KEY)));
  } catch (_) {
    return { ...DEFAULT_JOYSTICK };
  }
}

export function saveJoystick(value) {
  try {
    globalThis.localStorage.setItem(JOYSTICK_KEY, JSON.stringify(normalizeJoystick(value)));
    return true;
  } catch (_) {
    // Denied storage must never prevent using this session's controls.
    return false;
  }
}

/**
 * x/y describe the available top-left travel, not the viewport or stick center.
 * Normal viewports have 12px padding. Tiny ones reduce padding and displayed
 * size without modifying the saved preference, so rotating restores its size.
 */
export function joystickLayout(value, width, height) {
  const settings = normalizeJoystick(value);
  const w = Number.isFinite(width) ? Math.max(0, width) : 0;
  const h = Number.isFinite(height) ? Math.max(0, height) : 0;
  const padding = Math.min(12, w / 4, h / 4);
  const size = Math.min(settings.size, w - padding * 2, h - padding * 2);
  return {
    left: padding + Math.max(0, w - padding * 2 - size) * settings.x,
    top: padding + Math.max(0, h - padding * 2 - size) * settings.y,
    size,
  };
}

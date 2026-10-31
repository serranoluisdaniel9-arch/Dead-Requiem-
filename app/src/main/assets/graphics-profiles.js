/**
 * Graphics profiles and frame pacing.
 *
 * v1.3 shipped three presets that changed counts but had no Ultra tier and no
 * way to cap the frame rate. On a phone the frame rate is the setting that
 * matters most: a 120 Hz panel rendering an uncapped scene burns battery and
 * thermal headroom for frames nobody sees, while a 30 fps cap on a weak device
 * is the difference between playable and a slideshow.
 *
 * Every field here is consumed by the renderer, so a preset is a real change in
 * cost, not a label:
 *   fogLayers   number of drifting haze sheets
 *   dust        motes in the floating dust cloud
 *   shadowMap   directional shadow map resolution (0 = no shadow map)
 *   shadows     whether the moon casts at all
 *   pixelRatio  renderer pixel ratio cap
 *   anisotropy  texture anisotropy
 *   textureSize procedural texture resolution
 *   debris      destroyed-city prop density
 *   rain        rain streak count
 *   smoke       ambient smoke plume count
 *   wet         wet-surface sheen (lower roughness on road and pavement)
 *   lodDistance metres at which a zombie collapses to its single-draw body
 *   grade       vignette + split-tone pass
 */

export const GRAPHICS_PROFILES = Object.freeze({
  low: {
    id: 'low', label: 'Bajo',
    fogLayers: 3, dust: 90, shadowMap: 0, shadows: false, pixelRatio: 1,
    anisotropy: 1, textureSize: 128, debris: 'low', rain: 0, smoke: 0,
    wet: false, lodDistance: 9, grade: true,
  },
  medium: {
    id: 'medium', label: 'Medio',
    fogLayers: 5, dust: 220, shadowMap: 1024, shadows: true, pixelRatio: 1.25,
    anisotropy: 2, textureSize: 256, debris: 'medium', rain: 260, smoke: 3,
    wet: true, lodDistance: 12, grade: true,
  },
  high: {
    id: 'high', label: 'Alto',
    fogLayers: 7, dust: 420, shadowMap: 2048, shadows: true, pixelRatio: 1.6,
    anisotropy: 4, textureSize: 256, debris: 'high', rain: 520, smoke: 5,
    wet: true, lodDistance: 13, grade: true,
  },
  ultra: {
    id: 'ultra', label: 'Ultra',
    fogLayers: 10, dust: 760, shadowMap: 4096, shadows: true, pixelRatio: 2,
    anisotropy: 8, textureSize: 512, debris: 'ultra', rain: 900, smoke: 8,
    wet: true, lodDistance: 16, grade: true,
  },
});

export const PROFILE_ORDER = Object.freeze(['low', 'medium', 'high', 'ultra']);

/** Frame-rate caps offered in the settings panel. */
export const FPS_OPTIONS = Object.freeze([30, 60, 120]);

/**
 * Picks a profile from a stored preference, falling back to a device guess.
 * A touch device with a high pixel ratio is the case that most often ships a
 * preset it cannot hold, so it starts one tier lower.
 */
export function resolveProfile(stored, { touch = false, devicePixelRatio: dpr = 1 } = {}) {
  if (stored && GRAPHICS_PROFILES[stored]) return stored;
  if (touch) return dpr > 2.5 ? 'low' : 'medium';
  return 'high';
}

/** Picks a frame cap from a stored preference, falling back to the panel rate. */
export function resolveFps(stored, { touch = false } = {}) {
  const value = Number(stored);
  if (FPS_OPTIONS.includes(value)) return value;
  return touch ? 60 : 60;
}

/** Milliseconds a frame may take at a given cap. */
export function frameBudget(fps) {
  const value = FPS_OPTIONS.includes(Number(fps)) ? Number(fps) : 60;
  return 1000 / value;
}

/**
 * Frame limiter. `shouldRender` is called once per animation frame with the
 * real elapsed time; it returns true when the accumulated time has paid for a
 * frame. Simulation keeps ticking every frame — only the draw is throttled, so
 * a 30 fps cap does not make the game run in slow motion.
 */
export function createFrameLimiter(fps = 60) {
  let cap = FPS_OPTIONS.includes(Number(fps)) ? Number(fps) : 60;
  let accumulated = 0;
  let rendered = 0;
  let skipped = 0;

  function shouldRender(dtMs) {
    const step = Number.isFinite(dtMs) ? Math.max(0, Math.min(dtMs, 250)) : 16.7;
    accumulated += step;
    const budget = 1000 / cap;
    if (accumulated + 0.5 < budget) { skipped++; return false; }
    // Keep the remainder instead of zeroing it, so a 60 Hz display capped at
    // 30 fps alternates 2/2/2 frames rather than drifting to 3.
    accumulated = Math.max(0, accumulated - budget);
    if (accumulated > budget * 3) accumulated = 0;
    rendered++;
    return true;
  }

  return {
    shouldRender,
    setFps(next) {
      if (FPS_OPTIONS.includes(Number(next))) { cap = Number(next); accumulated = 0; }
    },
    get fps() { return cap; },
    get rendered() { return rendered; },
    get skipped() { return skipped; },
    reset() { accumulated = 0; rendered = 0; skipped = 0; },
  };
}

/**
 * Rolling frame-time meter. Reports the average over the last `window` frames
 * and the 1% low, which is the number that actually describes stutter.
 */
export function createFrameMeter(window = 90) {
  const samples = [];
  let cursor = 0;

  function push(dtMs) {
    const value = Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0;
    if (samples.length < window) samples.push(value);
    else { samples[cursor] = value; cursor = (cursor + 1) % window; }
  }

  function stats() {
    if (!samples.length) return { fps: 0, avgMs: 0, lowMs: 0, samples: 0 };
    const sorted = [...samples].sort((a, b) => a - b);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
    return {
      fps: avg > 0 ? Number((1000 / avg).toFixed(1)) : 0,
      avgMs: Number(avg.toFixed(2)),
      lowMs: Number(p99.toFixed(2)),
      samples: samples.length,
    };
  }

  return { push, stats, reset() { samples.length = 0; cursor = 0; } };
}

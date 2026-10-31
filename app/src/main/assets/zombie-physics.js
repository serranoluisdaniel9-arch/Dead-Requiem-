/**
 * Zombie physics: falls, ground contact and the state/collision contract.
 *
 * The v1.3 bug this module exists to kill: `landFalling()` set the outcome but
 * never cleared `group.rotation.z`, which the fall had been spinning. A zombie
 * that fell from a roof therefore stood up and *walked while lying on its side*
 * — the pose solver was correct, the root transform was not. The same class of
 * bug let a prone crawler keep its full standing collision radius and its
 * standing walk speed, so it slid through gaps it should not fit through.
 *
 * Everything here is pure: no THREE, no scene, no timers. The game loop applies
 * the returned numbers to the rig, and the tests can assert them directly.
 */

const GRAVITY = 9.81;

/** Terminal-ish speed for a body falling `height` metres, with drag. */
export function impactSpeed(height) {
  const h = Number.isFinite(height) ? Math.max(0, height) : 0;
  return Math.sqrt(2 * GRAVITY * h) * 0.94;
}

/** Fall time for a height, matching the quadratic the renderer integrates. */
export function fallTime(height) {
  const h = Number.isFinite(height) ? Math.max(0, height) : 0;
  return Math.sqrt((2 * h) / GRAVITY) * 1.06 + 0.12;
}

/**
 * What a fall does to a body, from the physics rather than from a dice roll.
 *
 * A 5 m drop onto concrete is survivable; a 15 m one is not. The roll only
 * decides the *middle* band, where both outcomes are plausible — that is what
 * keeps the street varied without letting a 15 m fall produce a crawler.
 *
 *   height < 6 m   → almost always survives: crawler or enraged
 *   6–11 m         → the roll decides
 *   > 11 m         → dead, unless the roll is very lucky
 */
export function impactOutcome({ height = 10, roll = 0.5 } = {}) {
  const h = Number.isFinite(height) ? Math.max(0, height) : 0;
  const r = Math.max(0, Math.min(0.999999, Number.isFinite(roll) ? roll : 0.5));
  if (h >= 11) return r < 0.12 ? 'crawler' : 'dead';
  if (h >= 6) {
    if (r < 0.34) return 'dead';
    if (r < 0.75) return 'enraged';
    return 'crawler';
  }
  return r < 0.55 ? 'crawler' : 'enraged';
}

/**
 * The root transform a state requires. This is the single source of truth for
 * "is this body upright, prone, or on its side", and it always returns an
 * explicit `rotationZ` so a spin left over from a fall cannot survive a state
 * change.
 *
 * `rootPitch` is the X rotation: 0 upright, -PI/2 face-down prone.
 */
export function rootTransform({ state = 'walk', progress = 0, spin = 0 } = {}) {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (state === 'fall') {
    // Airborne: the spin is real, and it is the only state allowed to keep it.
    return { rootY: 0, rootPitch: -0.35 * t, rotationZ: spin * t, upright: false };
  }
  if (state === 'crawl') {
    return { rootY: 0.16, rootPitch: -1.42, rotationZ: 0, upright: false };
  }
  if (state === 'getup') {
    // Rising from prone: pitch and height interpolate, spin is already gone.
    return {
      rootY: 0.16 * (1 - t),
      rootPitch: -1.42 * (1 - t),
      rotationZ: 0,
      upright: t > 0.85,
    };
  }
  if (state === 'dead') {
    // Collapsed on its side. The caller may keep this rotationZ; it is a corpse.
    return { rootY: 0, rootPitch: 0, rotationZ: 1.55, upright: false };
  }
  // walk / run / attack / hit: upright, and any leftover spin is cleared.
  return { rootY: 0, rootPitch: 0, rotationZ: 0, upright: true };
}

/**
 * Whether a state is allowed to translate across the ground under its own
 * power. A prone body crawls (slowly, with a smaller footprint); a corpse, a
 * falling body and a body mid-get-up do not move at all.
 */
export function locomotionFor(state) {
  switch (state) {
    case 'walk': return { moves: true, speedMul: 1, radius: 0.34, height: 2.0 };
    case 'run': return { moves: true, speedMul: 1, radius: 0.34, height: 2.0 };
    case 'crawl': return { moves: true, speedMul: 0.34, radius: 0.30, height: 0.45 };
    case 'attack': return { moves: false, speedMul: 0, radius: 0.34, height: 2.0 };
    case 'hit': return { moves: false, speedMul: 0, radius: 0.34, height: 2.0 };
    case 'getup': return { moves: false, speedMul: 0, radius: 0.34, height: 1.2 };
    case 'fall': return { moves: false, speedMul: 0, radius: 0.34, height: 2.0 };
    case 'dead': return { moves: false, speedMul: 0, radius: 0.34, height: 0.4 };
    default: return { moves: true, speedMul: 1, radius: 0.34, height: 2.0 };
  }
}

/**
 * Ground height under a point. The avenue is flat, the pavements are a kerb
 * higher, and a prone body sits on whichever it is on. Returning a number
 * instead of a constant is what stops a crawler from sinking into the kerb.
 */
export function groundHeightAt(x) {
  const ax = Math.abs(Number.isFinite(x) ? x : 0);
  if (ax > 9.0) return 0.10;
  return 0;
}

/**
 * Resolves a body against the ground: no floating, no sinking. `y` is the
 * desired root height above the surface; the result is the absolute Y the group
 * should carry.
 */
export function settleOnGround({ x = 0, rootY = 0, state = 'walk' } = {}) {
  const ground = groundHeightAt(x);
  const lift = Number.isFinite(rootY) ? rootY : 0;
  return Number((ground + lift).toFixed(4));
}

/**
 * Axis-aligned separation against a list of box colliders, in the same shape
 * the game already uses: `{x, z, rx, rz}`. Returns the corrected position.
 *
 * This is the "no zombie inside a car" guarantee. It is deliberately a
 * push-out rather than a swept test: a body that has already ended up inside a
 * collider (a spawn, a shove, a fall) is the case that matters, and a push-out
 * fixes it in one step.
 */
export function separateFromColliders(position, colliders, radius = 0.34) {
  let { x, z } = position;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const c of colliders) {
      const halfX = (c.rx || 0) + radius;
      const halfZ = (c.rz || 0) + radius;
      const dx = x - c.x;
      const dz = z - c.z;
      if (Math.abs(dx) >= halfX || Math.abs(dz) >= halfZ) continue;
      // Push out along the axis of least penetration: the shortest way out.
      const penX = halfX - Math.abs(dx);
      const penZ = halfZ - Math.abs(dz);
      if (penX < penZ) x += (dx >= 0 ? 1 : -1) * penX;
      else z += (dz >= 0 ? 1 : -1) * penZ;
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}

/** True when a point is inside any collider, expanded by `radius`. */
export function insideCollider(x, z, colliders, radius = 0.34) {
  for (const c of colliders) {
    if (Math.abs(x - c.x) < (c.rx || 0) + radius &&
        Math.abs(z - c.z) < (c.rz || 0) + radius) return true;
  }
  return false;
}

/**
 * A body that has just landed must not be left mid-spin, mid-air or prone
 * without a pose. This is the landing contract, in one place, so the renderer
 * cannot forget a field again.
 */
export function landingState({ outcome = 'dead', height = 10, x = 0 } = {}) {
  const state = outcome === 'dead' ? 'dead' : outcome === 'crawler' ? 'crawl' : 'getup';
  const root = rootTransform({ state, progress: 0 });
  return {
    state,
    dead: outcome === 'dead',
    prone: outcome === 'crawler',
    gettingUp: outcome === 'enraged',
    falling: false,
    rotationZ: root.rotationZ,
    rootPitch: root.rootPitch,
    y: settleOnGround({ x, rootY: root.rootY, state }),
    // A hard landing staggers even a survivor: it cannot sprint immediately.
    stagger: outcome === 'enraged' ? 0.55 : 0,
    impactSpeed: Number(impactSpeed(height).toFixed(2)),
  };
}

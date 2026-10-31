/**
 * Zombie perception and behaviour.
 *
 * v1.3 had one line of AI: `dist < 17 && dot(facing, toPlayer) > .15`. That is a
 * 160° cone with no occlusion test, no hearing, no memory and no notion of
 * alertness — a zombie facing a wall "saw" you through it, and a gunshot 30 m
 * away did nothing unless it happened to be looking at you.
 *
 * This module is the whole decision layer, pure and testable:
 *
 *   perception  — a real vision cone with a distance falloff, an occlusion
 *                 callback, and a hearing radius driven by the noise a shot
 *                 makes (a suppressed weapon is quiet, a shotgun is not).
 *   memory      — a zombie that loses sight of you keeps the last position it
 *                 knew and searches there, then gives up and goes home.
 *   states      — idle → suspicious → investigate → chase → search → idle, with
 *                 an explicit `alert` level so the HUD and the tests agree.
 *   roles       — ambusher (waits inside a building, bursts out), flanker
 *                 (circles to the side), coward (runs, then comes back).
 *
 * No THREE, no scene: the caller passes positions and gets decisions back.
 */

export const PERCEPTION = Object.freeze({
  /** Full cone half-angle in radians. 0.62 rad ≈ 35°, so a 70° cone. */
  halfAngle: 0.62,
  /** Beyond this a zombie cannot see at all, however well lit. */
  sightRange: 22,
  /** Inside this it notices you regardless of facing (you are on top of it). */
  proximityRange: 2.6,
  /** Hearing: a noise of strength 1 is audible at this radius. */
  hearingRange: 34,
  /** How long a memory of your position survives, in seconds. */
  memoryTime: 9,
  /** Alert level at which a zombie commits to a chase. */
  chaseThreshold: 0.55,
  /** Alert decay per second with nothing to go on. */
  decay: 0.22,
  /** Alert gained per second of clear sight at close range. */
  gain: 1.9,
});

export const ROLES = Object.freeze({
  shambler: { id: 'shambler', label: 'Errante', ambush: false, flank: 0, flee: false },
  runner: { id: 'runner', label: 'Corredor', ambush: false, flank: 0.35, flee: false },
  resistant: { id: 'resistant', label: 'Resistente', ambush: true, flank: 0, flee: false },
  brute: { id: 'brute', label: 'Bruto', ambush: false, flank: 0, flee: false },
  ambusher: { id: 'ambusher', label: 'Acechador', ambush: true, flank: 0, flee: false },
  coward: { id: 'coward', label: 'Cobarde', ambush: false, flank: 0, flee: true },
});

const clamp01 = v => Math.max(0, Math.min(1, v));

/**
 * Vision test. `occluded` is a callback the caller supplies (it owns the
 * collider list); when it returns true the zombie cannot see through.
 *
 * Returns a 0..1 confidence, not a boolean, so a zombie at the edge of its cone
 * in the fog takes longer to commit than one standing in front of it.
 */
export function visionConfidence({
  from, facing, to, occluded = () => false, range = PERCEPTION.sightRange,
} = {}) {
  if (!from || !to) return 0;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance > range) return 0;
  if (distance <= PERCEPTION.proximityRange) return 1;
  const length = distance || 1;
  const dot = (dx / length) * Math.sin(facing) + (dz / length) * Math.cos(facing);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  if (angle > PERCEPTION.halfAngle) return 0;
  if (occluded(from, to)) return 0;
  // Falloff: full confidence in the near half of the cone, tapering to 0.35 at
  // the rim, and a mild distance term so a far silhouette is less certain.
  const angleFactor = 1 - 0.65 * (angle / PERCEPTION.halfAngle);
  const distanceFactor = 1 - 0.5 * clamp01((distance - range * 0.45) / (range * 0.55));
  return clamp01(angleFactor * distanceFactor);
}

/**
 * Hearing test. `strength` is the noise a weapon makes (0..1); a suppressed
 * pistol is ~0.3, a shotgun ~1. The radius scales with the square root so a
 * quiet shot is still heard nearby rather than not at all.
 */
export function hearingConfidence({ from, to, strength = 1, range = PERCEPTION.hearingRange } = {}) {
  if (!from || !to) return 0;
  const s = clamp01(Number.isFinite(strength) ? strength : 1);
  if (s <= 0) return 0;
  const radius = range * Math.sqrt(s);
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  if (distance > radius) return 0;
  return clamp01(1 - distance / radius);
}

/**
 * Advances one zombie's alert level and returns its next mode.
 *
 * `alert` is the persistent 0..1 value the caller stores on the enemy. The
 * return value is the mode string the renderer and the HUD use.
 */
export function stepAlert({
  alert = 0, seen = 0, heard = 0, dt = 1 / 60, memoryAge = Infinity,
  chaseThreshold = PERCEPTION.chaseThreshold,
} = {}) {
  const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.25)) : 1 / 60;
  let next = alert;
  if (seen > 0) next += PERCEPTION.gain * seen * step;
  else if (heard > 0) next += PERCEPTION.gain * 0.55 * heard * step;
  else next -= PERCEPTION.decay * step;
  next = clamp01(next);

  let mode;
  if (next >= chaseThreshold && seen > 0) mode = 'chase';
  else if (next >= chaseThreshold) mode = memoryAge < PERCEPTION.memoryTime ? 'search' : 'investigate';
  else if (next > 0.12) mode = 'suspicious';
  else mode = 'idle';
  return { alert: next, mode };
}

/**
 * Where a zombie should walk, given its mode. Returns a target point and the
 * speed multiplier to use getting there.
 */
export function behaviourTarget({
  mode = 'idle', position, lastKnown, home, wander, flank = 0, time = 0,
} = {}) {
  const p = position || { x: 0, z: 0 };
  if (mode === 'chase' && lastKnown) return { x: lastKnown.x, z: lastKnown.z, speedMul: 1 };
  if (mode === 'search' && lastKnown) {
    // Circle the last known position instead of standing on it: a search that
    // converges to a point looks like a bug, a search that orbits looks alive.
    const radius = 2.4;
    const angle = time * 0.9;
    return {
      x: lastKnown.x + Math.cos(angle) * radius,
      z: lastKnown.z + Math.sin(angle) * radius,
      speedMul: 0.55,
    };
  }
  if (mode === 'investigate' && lastKnown) {
    return { x: lastKnown.x, z: lastKnown.z, speedMul: 0.7 };
  }
  if (mode === 'suspicious' && lastKnown) {
    return { x: lastKnown.x, z: lastKnown.z, speedMul: 0.45 };
  }
  // Idle: drift around home, with an optional flanking bias so a group spreads
  // out instead of walking in a single file line.
  const base = wander || home || p;
  if (flank > 0) {
    const side = Math.sin(time * 0.4) * flank * 4;
    return { x: base.x + side, z: base.z, speedMul: 0.3 };
  }
  return { x: base.x, z: base.z, speedMul: 0.3 };
}

/**
 * Ambush staging. An ambusher waits inside a building until the player is
 * within `triggerRange` and roughly in front of the doorway, then bursts out.
 * Returns null while it is still waiting.
 */
export function ambushTrigger({
  role = 'shambler', waiting = true, position, player, facing = 0,
  triggerRange = 7, time = 0, cooldown = 0,
} = {}) {
  const spec = ROLES[role] || ROLES.shambler;
  if (!spec.ambush || !waiting || cooldown > 0) return null;
  if (!position || !player) return null;
  const distance = Math.hypot(player.x - position.x, player.z - position.z);
  if (distance > triggerRange) return null;
  // It has to be roughly facing the street, or it would burst out backwards.
  const dx = player.x - position.x;
  const dz = player.z - position.z;
  const length = Math.hypot(dx, dz) || 1;
  const dot = (dx / length) * Math.sin(facing) + (dz / length) * Math.cos(facing);
  if (dot < 0.1) return null;
  return { burst: true, at: time, distance, speedMul: 1.35 };
}

/**
 * Coward behaviour: a zombie that runs away when hurt, then comes back once it
 * has recovered. Returns the mode it should be in.
 */
export function cowardMode({ role = 'shambler', hp = 1, maxHp = 1, fleeing = false, fleeUntil = 0, time = 0 } = {}) {
  const spec = ROLES[role] || ROLES.shambler;
  if (!spec.flee) return null;
  const hurt = maxHp > 0 && hp / maxHp < 0.45;
  if (fleeing && time < fleeUntil) return 'flee';
  if (hurt && !fleeing) return 'flee';
  return null;
}

/**
 * A group's shared alert: when one zombie sees you, the ones near it get a
 * fraction of the alert. This is what makes a pack react as a pack instead of
 * four independent animals.
 */
export function shareAlert({ alert = 0, neighbours = [], shareRadius = 9, factor = 0.45 } = {}) {
  if (alert < PERCEPTION.chaseThreshold) return 0;
  let best = 0;
  for (const n of neighbours) {
    if (!n || n.distance > shareRadius) continue;
    const contribution = alert * factor * (1 - n.distance / shareRadius);
    if (contribution > best) best = contribution;
  }
  return clamp01(best);
}

// Pure combat timings and horizontal, single-target shove selection.
export const COMBAT = Object.freeze({
  shoveRange: 1.65,
  shoveHalfAngle: Math.PI / 3,
  shoveCooldown: 3.2,
  shoveAnimation: .32,
});

export function reloadDuration(baseSeconds, ammo) {
  const base = Number.isFinite(baseSeconds) && baseSeconds > 0 ? baseSeconds : 1.6;
  // Manual reload with rounds remaining takes half the time; empty reload takes 35% longer.
  return Number.isInteger(ammo) && ammo > 0 ? base * 0.5 : base * 1.35;
}

// Pistol taps bypass cooldown so you can shoot as fast as you tap/click
export function tapBypassesCooldown(weaponId, isTap) {
  return (weaponId === 'pistol' || weaponId === 'revolver') && isTap === true;
}

export function chooseShoveTarget(position, targets) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z) ||
      !Number.isFinite(position.yaw) || !Array.isArray(targets)) return null;
  const forwardX = Math.sin(position.yaw);
  const forwardZ = -Math.cos(position.yaw);
  let nearest = null;
  for (const target of targets) {
    if (!target || typeof target.id !== 'string' || target.id.length === 0 ||
        !Number.isFinite(target.x) || !Number.isFinite(target.z) ||
        !Number.isFinite(target.hp) || target.hp <= 0 || target.dead) continue;
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > COMBAT.shoveRange) continue;
    // Overlapping targets have no meaningful bearing. A tiny tolerance also
    // keeps targets exactly on the cone boundary eligible after trig rounding.
    if (distance > 1e-12) {
      const angle = Math.atan2(Math.abs(forwardX * dz - forwardZ * dx),
        forwardX * dx + forwardZ * dz);
      if (angle > COMBAT.shoveHalfAngle + 1e-12) continue;
    }
    if (!nearest || distance < nearest.distance) nearest = { id: target.id, distance };
  }
  return nearest;
}

const SHOVE_EFFECTS = Object.freeze({
  shambler: Object.freeze({ distance: 1.05, stagger: .9 }),
  runner: Object.freeze({ distance: 1.15, stagger: 1.05 }),
  resistant: Object.freeze({ distance: .7, stagger: .7 }),
  brute: Object.freeze({ distance: .38, stagger: .5 }),
});

// Effects contain displacement/recovery only: no damage, ammo or kill rewards.
export function shoveEffect(kind) {
  switch (kind) {
    case 'runner':
    case 'resistant':
    case 'brute':
      return SHOVE_EFFECTS[kind];
    default:
      return SHOVE_EFFECTS.shambler;
  }
}

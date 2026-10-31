/**
 * Zombie animation states.
 *
 * v1.1 drove every zombie with one walk cycle plus a couple of ad-hoc overrides
 * for the prone case. That meant a falling body, a corpse, a crawler and a
 * sprinting runner all shared the same leg swing, and the "gets up furious"
 * moment had no pose of its own.
 *
 * This module is a pure pose solver: given a state and a phase it returns the
 * rotations to apply. It never touches THREE objects, so it can be unit-tested
 * without a renderer, and the game loop stays the only thing that mutates the
 * rig.
 *
 * States:
 *   walk     — slow shamble, arms forward, slight torso sway
 *   run      — fast, longer stride, arms pumping, forward lean
 *   fall     — airborne: limbs splayed, no ground contact
 *   getup    — pushing off the ground, one knee up, then upright
 *   crawl    — prone, dragging with the arms, legs trailing
 *   dead     — collapsed, no motion
 *   attack   — lunge: both arms swing down and forward, torso pitches in
 *   hit      — struck: torso recoils, head snaps back, arms fly out
 */

export const ZOMBIE_STATES = Object.freeze(['walk', 'run', 'fall', 'getup', 'crawl', 'dead', 'attack', 'hit']);

const clamp01 = value => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * @param {object} input
 * @param {string} input.state      one of ZOMBIE_STATES
 * @param {number} input.phase      accumulated animation phase (radians)
 * @param {number} input.progress   0..1 within a one-shot state (fall, getup)
 * @param {number} input.speedScale 0..1.5, how fast it is actually moving
 * @returns {{legs:number[], knees:number[], arms:number[], torso:{x:number,z:number}, head:{x:number,y:number}, rootY:number, rootPitch:number}}
 */
export function zombiePose({ state = 'walk', phase = 0, progress = 0, speedScale = 1 } = {}) {
  const p = Number.isFinite(phase) ? phase : 0;
  const t = clamp01(Number.isFinite(progress) ? progress : 0);
  const s = Number.isFinite(speedScale) ? Math.max(0, Math.min(1.5, speedScale)) : 1;

  const pose = {
    legs: [0, 0],
    knees: [0, 0],
    arms: [0, 0],
    torso: { x: 0, z: 0 },
    head: { x: 0, y: 0 },
    rootY: 0,
    rootPitch: 0,
  };

  if (state === 'dead') {
    // Collapsed on its side: the caller owns the root rotation, this is the
    // limp limb arrangement that goes with it.
    pose.legs = [-.35, .22];
    pose.knees = [.55, .18];
    pose.arms = [-.5, -.9];
    pose.torso.z = .12;
    pose.head.y = .4;
    return pose;
  }

  if (state === 'crawl') {
    // Prone and dragging: legs dead weight, arms pulling alternately.
    const pull = Math.sin(p * 1.6);
    pose.legs = [-.08, -.04];
    pose.knees = [.12, .08];
    pose.arms = [-1.5 + pull * .5, -1.5 - pull * .5];
    pose.torso.z = pull * .08;
    pose.head.x = -.35;
    pose.rootY = .16 + Math.abs(pull) * .02;
    pose.rootPitch = -1.42;
    return pose;
  }

  if (state === 'fall') {
    // Airborne: splayed, spinning limbs, no ground contact.
    const flail = Math.sin(p * 9);
    pose.legs = [-.55 + flail * .3, -.3 - flail * .3];
    pose.knees = [.7, .45];
    pose.arms = [-2.1 + flail * .45, -1.9 - flail * .45];
    pose.torso.x = -.2;
    pose.head.x = -.25;
    pose.rootY = 0;
    return pose;
  }

  if (state === 'getup') {
    // Push off the ground: knee under the body, then straighten.
    const rise = t;
    pose.legs = [lerp(-1.1, 0, rise), lerp(.5, 0, rise)];
    pose.knees = [lerp(1.5, 0, rise), lerp(.9, 0, rise)];
    pose.arms = [lerp(-1.9, -.9, rise), lerp(-1.7, -1.0, rise)];
    pose.torso.x = lerp(-.9, 0, rise);
    pose.head.x = lerp(-.5, 0, rise);
    pose.rootY = lerp(.16, 0, rise);
    pose.rootPitch = lerp(-1.42, 0, rise);
    return pose;
  }

  if (state === 'attack') {
    // A lunge, not a punch: both arms come down and forward together, the torso
    // pitches in, and the head drops. `progress` runs 0..1 across the swing.
    const swing = Math.sin(clamp01(t) * Math.PI);
    pose.arms = [-2.35 + swing * 1.5, -2.2 + swing * 1.45];
    pose.legs = [-.28 * swing, .2 * swing];
    pose.knees = [.3 * swing, .12 * swing];
    pose.torso.x = -.34 * swing;
    pose.head.x = .22 * swing;
    pose.rootY = -.03 * swing;
    return pose;
  }

  if (state === 'hit') {
    // Struck: the body folds around the impact and the head snaps back. The
    // decay is driven by `progress` so a single hit reads as a flinch, not a
    // permanent pose.
    const recoil = Math.sin(clamp01(t) * Math.PI);
    pose.torso.x = .3 * recoil;
    pose.torso.z = .12 * recoil;
    pose.head.x = -.42 * recoil;
    pose.head.y = .18 * recoil;
    pose.arms = [-.7 - recoil * .5, -.55 - recoil * .45];
    pose.legs = [.12 * recoil, -.1 * recoil];
    pose.knees = [.22 * recoil, .1 * recoil];
    return pose;
  }

  // walk / run share the cycle, with different amplitude and lean.
  const running = state === 'run';
  const amplitude = running ? .62 : .33;
  const armBase = running ? -1.35 : -1.12;
  const armSwing = running ? .55 : .12;
  const lean = running ? -.16 : -.04;

  for (let i = 0; i < 2; i++) {
    const swing = Math.sin(p + i * Math.PI);
    pose.legs[i] = swing * amplitude * s;
    pose.knees[i] = Math.max(0, -swing) * (running ? .85 : .52) * s;
    pose.arms[i] = armBase + (i ? -1 : 1) * swing * armSwing;
  }
  pose.torso.x = lean;
  pose.torso.z = Math.sin(p * .5) * (running ? .05 : .035);
  pose.head.y = Math.sin(p * .31) * .026;
  pose.head.x = running ? .1 : 0;
  return pose;
}

/**
 * Picks the state a zombie should be in from its simulation flags. Kept here so
 * the game loop and the tests agree on precedence: airborne beats everything,
 * then a one-shot get-up, then prone, then dead, then movement.
 */
export function resolveZombieState({ falling = false, gettingUp = false, prone = false, dead = false, moving = false, running = false, attacking = false, hit = false } = {}) {
  if (falling) return 'fall';
  if (gettingUp) return 'getup';
  if (dead) return 'dead';
  if (prone) return 'crawl';
  // A hit interrupts a lunge: being shot mid-swing should read as a flinch.
  if (hit) return 'hit';
  if (attacking) return 'attack';
  return moving ? (running ? 'run' : 'walk') : 'walk';
}

/**
 * First-person weapon animation: reload and weapon-swap.
 *
 * Returns the offsets the game applies to the gun rig. `reload` is a two-beat
 * motion (drop the magazine, seat the new one); `swap` is a lower-and-raise.
 */
export function weaponPose({ reloadProgress = 0, swapProgress = 0, recoil = 0, aiming = false } = {}) {
  const r = clamp01(reloadProgress);
  const w = clamp01(swapProgress);
  // Reload: 0 → down, 0.45 → magazine out, 0.75 → seated, 1 → back up.
  const reloadDrop = r > 0 ? Math.sin(Math.min(1, r * 1.15) * Math.PI) : 0;
  const magOut = r > 0 && r < .55 ? Math.sin((r / .55) * Math.PI) : 0;
  // Swap: dip out and back, with a small roll.
  const swapDrop = w > 0 ? Math.sin(w * Math.PI) : 0;
  return {
    gunPitch: -reloadDrop * .62 - swapDrop * .85 - recoil * 1.3,
    gunRoll: -reloadDrop * .45 + swapDrop * .3,
    gunY: -reloadDrop * .05 - swapDrop * .22,
    gunZ: -swapDrop * .12,
    magDrop: magOut * .16,
    armPitch: -reloadDrop * .65 - swapDrop * .5,
    armRoll: reloadDrop * .12,
    aiming: Boolean(aiming),
  };
}

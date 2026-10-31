/**
 * Falling zombies: where they drop from, when, and what happens on impact.
 *
 * The director is pure and deterministic given its random source, so the test
 * harness can force each of the three outcomes instead of waiting for luck.
 * The renderer owns the actual mesh, gravity integration and dust; this module
 * only decides the drop point, the fall time and the outcome.
 *
 * Three outcomes, resolved once at impact:
 *   dead    — the fall kills it; the body stays on the ground as a corpse.
 *   enraged — it gets up furious: faster and harder for a few seconds, with a
 *             scream and a visual aura.
 *   crawler — it survives broken: prone, slow, dragging itself along.
 */

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
}

/**
 * Ledges along the avenue. `height` is the drop in metres and drives the fall
 * time; `side` is which pavement it lands on, so the dust and the sound pan
 * correctly. `z` values sit between the mission waypoints, never on top of a
 * pickup or the extraction.
 */
export const FALL_ZONES = deepFreeze([
  { id: 'roof-north-a', x: -8.6, z: 34, height: 12.5, side: -1, kind: 'roof' },
  { id: 'window-north-b', x: 8.4, z: 26, height: 6.2, side: 1, kind: 'window' },
  { id: 'roof-mid-a', x: 8.7, z: 12, height: 14, side: 1, kind: 'roof' },
  { id: 'window-mid-b', x: -8.5, z: 2, height: 5.4, side: -1, kind: 'window' },
  { id: 'roof-mid-c', x: -8.8, z: -14, height: 11, side: -1, kind: 'roof' },
  { id: 'window-south-a', x: 8.6, z: -26, height: 7.1, side: 1, kind: 'window' },
  { id: 'roof-south-b', x: 8.5, z: -44, height: 13.2, side: 1, kind: 'roof' },
  { id: 'window-south-c', x: -8.4, z: -56, height: 6.8, side: -1, kind: 'window' },
  { id: 'roof-far-a', x: -8.7, z: -70, height: 15, side: -1, kind: 'roof' },
]);

/** Probabilities must sum to 1; the resolver clamps the last bucket. */
export const OUTCOMES = deepFreeze({
  dead: { id: 'dead', weight: .34, label: 'Muere con el impacto' },
  enraged: { id: 'enraged', weight: .41, label: 'Se levanta furioso' },
  crawler: { id: 'crawler', weight: .25, label: 'Queda arrastrándose' },
});

/** Tuning for the two surviving outcomes. */
export const OUTCOME_TUNING = deepFreeze({
  enraged: { speedMul: 1.55, damageMul: 1.6, duration: 7, aura: true, scream: true },
  crawler: { speedMul: .34, damageMul: .7, duration: Infinity, prone: true, scream: false },
  dead: { speedMul: 0, damageMul: 0, duration: 0, corpse: true },
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Fall time from a height under gravity, with a small drag term. */
export function fallDuration(height) {
  const h = Number.isFinite(height) ? Math.max(0, height) : 0;
  return Number(Math.sqrt((2 * h) / 9.81) * 1.06 + .12).toFixed(3) * 1;
}

/** Maps a 0..1 roll onto an outcome id. */
export function resolveOutcome(roll) {
  const value = clamp(Number.isFinite(roll) ? roll : 0, 0, .999999);
  let cursor = 0;
  for (const outcome of Object.values(OUTCOMES)) {
    cursor += outcome.weight;
    if (value < cursor) return outcome.id;
  }
  return 'crawler';
}

/**
 * A drop is only worth staging when the player is close enough to see it but
 * not so close that it lands on their head. `minGap`/`maxGap` are metres of
 * distance along the street.
 */
export const DIRECTOR = deepFreeze({
  minGap: 9,
  maxGap: 26,
  cooldown: 11,
  firstDelay: 6,
  maxAlive: 3,
});

export function createFallDirector({ random = Math.random } = {}) {
  const used = new Set();
  let cooldown = DIRECTOR.firstDelay;
  let fired = 0;

  /**
   * @param {{playerZ:number, time:number, active:boolean, alive:number}} frame
   * @returns {null|{zone:object, outcome:string, fallTime:number, at:number}}
   */
  function update(frame = {}) {
    const { playerZ, time, active = true, alive = 0 } = frame;
    if (active !== true || !Number.isFinite(playerZ) || !Number.isFinite(time)) return null;
    if (alive >= DIRECTOR.maxAlive) return null;
    cooldown -= 1 / 60;
    if (cooldown > 0) return null;

    const candidates = FALL_ZONES.filter(zone => {
      if (used.has(zone.id)) return false;
      const gap = Math.abs(zone.z - playerZ);
      return gap >= DIRECTOR.minGap && gap <= DIRECTOR.maxGap;
    });
    if (!candidates.length) {
      cooldown = 2;
      return null;
    }
    const zone = candidates[Math.floor(clamp(random(), 0, .999999) * candidates.length)];
    used.add(zone.id);
    fired++;
    cooldown = DIRECTOR.cooldown;
    return {
      zone,
      outcome: resolveOutcome(random()),
      fallTime: fallDuration(zone.height),
      at: time,
      index: fired,
    };
  }

  function reset() {
    used.clear();
    cooldown = DIRECTOR.firstDelay;
    fired = 0;
  }

  return {
    update,
    reset,
    get fired() { return fired; },
    get usedZones() { return [...used]; },
    get cooldown() { return cooldown; },
  };
}

/**
 * Applies an outcome to an enemy descriptor. Returns the fields the renderer
 * needs: whether it is a corpse, prone, or buffed, and for how long.
 */
export function applyOutcome(enemy, outcomeId) {
  const tuning = OUTCOME_TUNING[outcomeId] || OUTCOME_TUNING.dead;
  const base = { ...enemy };
  if (outcomeId === 'dead') {
    return { ...base, dead: true, corpse: true, hp: 0, prone: false, buff: null };
  }
  if (outcomeId === 'crawler') {
    return {
      ...base, dead: false, corpse: false, prone: true,
      speed: Number((base.speed * tuning.speedMul).toFixed(2)),
      damageMul: tuning.damageMul,
      buff: { kind: 'crawler', until: Infinity },
    };
  }
  return {
    ...base, dead: false, corpse: false, prone: false,
    speed: Number((base.speed * tuning.speedMul).toFixed(2)),
    damageMul: tuning.damageMul,
    buff: { kind: 'enraged', until: (base.time || 0) + tuning.duration, aura: true },
  };
}

/** True while an enraged buff is still running. */
export function buffActive(buff, time) {
  if (!buff) return false;
  if (buff.kind === 'crawler') return true;
  return Number.isFinite(buff.until) && time < buff.until;
}

// Pure reinforcement rules. The renderer owns the game clock, enemy stats and cover.
function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
}

/**
 * Escalation, not a random mix. Each wave introduces exactly one new archetype
 * and keeps the previous ones as filler, so the player learns the roster in
 * order: shamblers → runners → resistant → the brute as the closing beat.
 *
 * `triggerZ` is the player's z when the warning fires; `delay` is the warning
 * window before the spawns actually appear.
 */
export const WAVES = deepFreeze([
  {
    id: 'wave-1', triggerZ: 20, delay: 3, introduces: 'shambler',
    members: ['shambler', 'shambler', 'shambler', 'shambler'],
  },
  {
    id: 'wave-2', triggerZ: -8, delay: 3, introduces: 'runner',
    members: ['shambler', 'runner', 'shambler', 'runner'],
  },
  {
    id: 'wave-3', triggerZ: -38, delay: 3, introduces: 'resistant',
    members: ['runner', 'resistant', 'shambler', 'resistant'],
  },
  {
    id: 'wave-4', triggerZ: -64, delay: 3, introduces: 'brute',
    members: ['resistant', 'brute', 'runner', 'resistant'],
  },
]);

/** Human-readable escalation ladder, used by the HUD and the README. */
export const ESCALATION = deepFreeze([
  { wave: 1, adds: 'Errante', note: 'Lentos, uno a uno. Aprende el ritmo.' },
  { wave: 2, adds: 'Corredor', note: 'Rápidos y directos. No te dejes rodear.' },
  { wave: 3, adds: 'Resistente', note: 'Aguanta varios impactos. Apunta a la cabeza.' },
  { wave: 4, adds: 'Bruto blindado', note: 'Cierre. Apenas retrocede al empujar.' },
]);

export function createWaveState() {
  return { next: 0, pending: null, arrived: [] };
}

// Only a prefix of the finite schedule can have arrived, with at most one warning.
// Reject corrupt saves rather than accidentally replaying or inventing a wave.
function validState(state) {
  if (!state || !Number.isInteger(state.next) || state.next < 0 ||
    state.next > WAVES.length || !Array.isArray(state.arrived)) return false;
  const pendingCount = state.pending === null ? 0 : 1;
  if (state.arrived.length + pendingCount !== state.next) return false;
  for (let index = 0; index < state.arrived.length; index++) {
    if (state.arrived[index] !== WAVES[index].id) return false;
  }
  return state.pending === null || (
    state.pending && state.pending.id === WAVES[state.next - 1]?.id &&
    Number.isFinite(state.pending.dueAt)
  );
}

export function advanceWaves(state, frame = {}) {
  const { z, time, active = true, complete = false } = frame ?? {};
  const unchanged = { state, announced: null, arriving: null };
  if (active !== true || complete !== false || !Number.isFinite(z) ||
    !Number.isFinite(time) || !validState(state)) return unchanged;

  let next = state.next;
  let pending = state.pending;
  let arrived = state.arrived;
  let arriving = null;
  let announced = null;

  if (pending && time >= pending.dueAt) {
    arriving = WAVES[next - 1];
    arrived = [...arrived, arriving.id];
    pending = null;
  }
  if (!pending && next < WAVES.length && z <= WAVES[next].triggerZ) {
    const dueAt = time + WAVES[next].delay;
    // An unrepresentably large clock cannot provide a real warning interval.
    if (Number.isFinite(dueAt) && dueAt > time) {
      announced = WAVES[next];
      pending = { id: announced.id, dueAt };
      next++;
    }
  }
  if (!arriving && !announced) return unchanged;
  return {
    state: { ...state, next, pending, arrived: [...arrived] },
    announced,
    arriving,
  };
}

const LANES = [3.4, 5.2, 7.8, 9];
const MIN_PLAYER_DISTANCE = 22;
const MIN_ENEMY_DISTANCE = 1.8;
const EXIT = { x: 5.8, z: -82 };

// Descriptors deliberately contain no health/speed: the shared catalog owns them.
// Known ids always use their canonical roster, never a caller-supplied member list.
export function planWaveSpawns(wave, player, options = {}) {
  const config = WAVES.find(candidate => candidate.id === wave?.id);
  if (!config || !Number.isFinite(player?.x) || !Number.isFinite(player?.z) ||
    !options || typeof options !== 'object') return [];
  const { occupied = [], blocked = () => false } = options;
  if (!Array.isArray(occupied) || typeof blocked !== 'function') return [];
  const positions = occupied.filter(position =>
    Number.isFinite(position?.x) && Number.isFinite(position?.z));
  const chosen = [];

  const clear = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || x < -9 || x > 9 ||
      z < -89 || z > 70 ||
      Math.hypot(x - player.x, z - player.z) < MIN_PLAYER_DISTANCE ||
      Math.hypot(x - EXIT.x, z - EXIT.z) < 6 ||
      positions.some(position =>
        Math.hypot(x - position.x, z - position.z) < MIN_ENEMY_DISTANCE) ||
      chosen.some(position =>
        Math.hypot(x - position.x, z - position.z) < MIN_ENEMY_DISTANCE)) return false;
    try {
      return !blocked(x, z);
    } catch {
      // A failed cover query never authorizes a spawn at that candidate.
      return false;
    }
  };

  for (const [index, kind] of config.members.entries()) {
    const preferredDirection = index < 2 ? -1 : 1;
    const preferredSide = index % 2 === 0 ? -1 : 1;
    let selected = null;
    // Bounded search: 2 directions × 2 sides × 11 distances × 4 lanes.
    // Search the opposite direction at street ends; never clamp into cover.
    search: for (const direction of [preferredDirection, -preferredDirection]) {
      for (const side of [preferredSide, -preferredSide]) {
        for (let offset = 22; offset <= 32; offset++) {
          for (const lane of LANES) {
            const x = side * lane;
            const z = player.z + direction * offset;
            if (!clear(x, z)) continue;
            selected = {
              id: `${config.id}-${index + 1}`, kind, x, z,
              // Enemy geometry faces local +z, unlike the player's camera.
              yaw: Math.atan2(player.x - x, player.z - z),
            };
            break search;
          }
        }
      }
    }
    if (selected) chosen.push(selected);
  }
  return chosen;
}

/**
 * Weapon attachments: pure catalogue + stat resolution.
 *
 * An attachment occupies one slot on one weapon. `compatible` lists the weapon
 * ids that can mount it, so the shop can hide what a gun cannot take and the
 * game can refuse an illegal loadout. Nothing here mutates the weapon table:
 * `resolveWeapon` returns a new object, which keeps the base catalogue the
 * single source of truth for prices and shop copy.
 *
 * Effects are expressed as multipliers (`mul`) and additive deltas (`add`) so
 * two attachments on the same gun compose predictably instead of overwriting
 * each other.
 *
 * v1.2 balance note: the suppressor now *raises* damage slightly. A suppressed
 * weapon fires a heavier subsonic round, so it trades muzzle energy for a
 * quieter report — the trade is noise and aggro against a small damage gain,
 * which is what the design brief asked for.
 */

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
}

/** Slot order is also the order the shop renders them in. */
export const SLOTS = deepFreeze([
  { id: 'muzzle', name: 'Bocacha' },
  { id: 'sight', name: 'Mira' },
  { id: 'mag', name: 'Cargador' },
  { id: 'stock', name: 'Culata' },
]);

export const ATTACHMENTS = deepFreeze({
  suppressor: {
    id: 'suppressor', name: 'Silenciador', slot: 'muzzle', price: 420,
    compatible: ['pistol', 'smg', 'rifle', 'carbine', 'burst', 'magnum'],
    summary: 'Reporte apagado y munición subsónica más pesada. Los infectados tardan en oírte.',
    effects: { noise: { mul: .3 }, damage: { mul: 1.06 }, aggro: { mul: .4 } },
    tension: 'Ruido −70%, daño +6%, atracción −60%.',
  },
  heavyBarrel: {
    id: 'heavyBarrel', name: 'Cañón pesado', slot: 'muzzle', price: 520,
    compatible: ['pistol', 'revolver', 'rifle', 'marksman', 'magnum', 'lmg'],
    summary: 'Más daño por disparo, pero la empuñadura pesa y el arma se levanta.',
    effects: { damage: { mul: 1.22 }, moveScale: { mul: .9 }, recoil: { mul: 1.15 } },
    tension: 'Daño +22%, movilidad −10%, retroceso +15%.',
  },
  optic: {
    id: 'optic', name: 'Óptica 2×', slot: 'sight', price: 460,
    compatible: ['pistol', 'revolver', 'smg', 'rifle', 'carbine', 'marksman', 'burst', 'magnum', 'lmg'],
    summary: 'Más zoom al apuntar y menos dispersión.',
    effects: { aimZoom: { add: 7 }, spread: { mul: .5 }, aimRange: { mul: 1.25 } },
    tension: 'Zoom +7°, dispersión −50%, alcance apuntado +25%.',
  },
  laser: {
    id: 'laser', name: 'Puntero láser', slot: 'sight', price: 380,
    compatible: ['pistol', 'smg', 'shotgun', 'compact', 'carbine', 'burst'],
    summary: 'Punto rojo sobre el blanco: disparas antes y más centrado.',
    effects: { spread: { mul: .62 }, aimZoom: { add: 2 }, noise: { mul: 1.04 } },
    tension: 'Dispersión −38%, zoom +2°, ruido +4%.',
  },
  extendedMag: {
    id: 'extendedMag', name: 'Cargador extendido', slot: 'mag', price: 340,
    compatible: ['pistol', 'smg', 'rifle', 'carbine', 'marksman', 'burst', 'lmg'],
    summary: 'Más balas por cargador antes de recargar.',
    effects: { magazine: { mul: 1.5 }, reload: { mul: 1.14 } },
    tension: 'Cargador +50%, recarga +14% más lenta.',
  },
  drum: {
    id: 'drum', name: 'Tambor de 60', slot: 'mag', price: 560,
    compatible: ['smg', 'carbine', 'lmg', 'burst'],
    summary: 'Capacidad de ametralladora a cambio de una recarga interminable.',
    effects: { magazine: { mul: 2.1 }, reload: { mul: 1.55 }, moveScale: { mul: .95 } },
    tension: 'Cargador +110%, recarga +55%, movilidad −5%.',
  },
  stock: {
    id: 'stock', name: 'Culata de apoyo', slot: 'stock', price: 360,
    compatible: ['smg', 'shotgun', 'rifle', 'carbine', 'marksman', 'burst', 'lmg', 'pump'],
    summary: 'Menos retroceso y más estabilidad al apuntar.',
    effects: { recoil: { mul: .55 }, spread: { mul: .68 } },
    tension: 'Retroceso −45%, dispersión −32%.',
  },
});

const hasOwn = (object, key) =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(object, key);

/** Attachments a given weapon can mount, in slot order. */
export function attachmentsFor(weaponId) {
  return Object.values(ATTACHMENTS)
    .filter(item => item.compatible.includes(weaponId))
    .sort((a, b) => SLOTS.findIndex(s => s.id === a.slot) - SLOTS.findIndex(s => s.id === b.slot));
}

/** True when `attachmentId` may be mounted on `weaponId`. */
export function isCompatible(weaponId, attachmentId) {
  const item = ATTACHMENTS[attachmentId];
  return Boolean(item && item.compatible.includes(weaponId));
}

/**
 * Applies every equipped attachment to a base weapon and returns a new object.
 * Unknown or incompatible ids are ignored rather than throwing: a profile can
 * outlive a catalogue change, and a stale id must not break a run.
 */
export function resolveWeapon(weapon, equippedIds = []) {
  if (!weapon) return null;
  const stats = { ...weapon };
  const applied = [];
  for (const id of Array.isArray(equippedIds) ? equippedIds : []) {
    const item = ATTACHMENTS[id];
    if (!item || !item.compatible.includes(weapon.id)) continue;
    applied.push(id);
    for (const [key, effect] of Object.entries(item.effects)) {
      if (effect.mul !== undefined) stats[key] = (stats[key] ?? 0) * effect.mul;
      if (effect.add !== undefined) stats[key] = (stats[key] ?? 0) + effect.add;
    }
  }
  // Round the values the HUD and the shop print, keep the rest exact.
  stats.magazine = Math.max(1, Math.round(stats.magazine));
  stats.damage = Math.max(1, Math.round(stats.damage));
  stats.noise = Math.max(1, Math.round(stats.noise));
  stats.aimRange = Math.max(1, Math.round(stats.aimRange));
  stats.recoil = Number(stats.recoil.toFixed(4));
  stats.spread = Number((stats.spread || 0).toFixed(4));
  stats.moveScale = Number(stats.moveScale.toFixed(3));
  stats.reload = Number(stats.reload.toFixed(2));
  stats.attachments = applied;
  return stats;
}

/**
 * One attachment per slot. Equipping a second item in an occupied slot swaps
 * it out, which is what a player expects from a slot-based system.
 */
export function equipAttachment(equippedIds, attachmentId) {
  const item = ATTACHMENTS[attachmentId];
  const current = Array.isArray(equippedIds) ? [...equippedIds] : [];
  if (!item) return current;
  const kept = current.filter(id => ATTACHMENTS[id] && ATTACHMENTS[id].slot !== item.slot);
  return [...kept, attachmentId];
}

export function unequipAttachment(equippedIds, attachmentId) {
  const item = ATTACHMENTS[attachmentId];
  if (!item) return Array.isArray(equippedIds) ? [...equippedIds] : [];
  return (Array.isArray(equippedIds) ? equippedIds : []).filter(id => id !== attachmentId);
}

/** Sanitises a stored per-weapon map: only owned, compatible ids survive. */
export function normalizeLoadout(input, ownedIds = [], weaponIds = []) {
  const result = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  for (const weaponId of weaponIds) {
    const list = input[weaponId];
    if (!Array.isArray(list)) continue;
    const seen = new Set();
    const kept = [];
    for (const id of list) {
      const item = ATTACHMENTS[id];
      if (!item || !item.compatible.includes(weaponId)) continue;
      if (!ownedIds.includes(id)) continue;
      if (seen.has(item.slot)) continue;
      seen.add(item.slot);
      kept.push(id);
    }
    if (kept.length) result[weaponId] = kept;
  }
  return result;
}

/** Human-readable effect lines for the shop card. */
export function effectLines(attachmentId) {
  const item = ATTACHMENTS[attachmentId];
  if (!item) return [];
  return Object.entries(item.effects).map(([key, effect]) => {
    const label = {
      noise: 'Ruido', damage: 'Daño', aggro: 'Atracción', moveScale: 'Movilidad',
      recoil: 'Retroceso', aimZoom: 'Zoom', spread: 'Dispersión', aimRange: 'Alcance',
      magazine: 'Cargador', reload: 'Recarga',
    }[key] || key;
    if (effect.mul !== undefined) {
      const percent = Math.round((effect.mul - 1) * 100);
      return `${label} ${percent > 0 ? '+' : ''}${percent}%`;
    }
    return `${label} ${effect.add > 0 ? '+' : ''}${effect.add}`;
  });
}

export { hasOwn };

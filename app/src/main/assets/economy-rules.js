// Fictional, local-only credits: no real money, server verification or cheating protection.
// The game owns extraction eligibility; these pure helpers only settle local progress.
import { ATTACHMENTS, resolveWeapon, normalizeLoadout, equipAttachment, unequipAttachment } from './attachments-rules.js';

export const ECONOMY_KEY = 'distrito09.profile.v4';
export const LEGACY_ECONOMY_KEY = 'distrito09.profile.v3';
export const LEGACY_ECONOMY_KEY_V2 = 'distrito09.profile.v2';
export const LEGACY_ECONOMY_KEY_V1 = 'distrito09.profile.v1';
export const PROFILE_VERSION = 4;

// v1.2 balance pass: escaping pays less than v1.1 and the whole catalogue moved
// up, so a full loadout is a long grind. A clean escape is 28 cr; the long
// route's supplies add 12. The cheapest new gun costs 1,050 — roughly 26 clean
// escapes — and the top of the line is 2,400.
export const EXTRACTION_REWARD = 28;
export const SUPPLIES_BONUS = 12;

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
}

/**
 * `moveScale` is the tension on movement speed while carrying the weapon, and
 * `pellets` > 1 turns a single trigger pull into a spread of independent rays.
 * `burst` > 1 fires that many rounds per trigger pull, spaced by `burstDelay`.
 * `ammo` describes the only way to buy rounds for that weapon.
 */
export const WEAPONS = deepFreeze({
  pistol: {
    id: 'pistol', name: 'Pistola 9 mm', price: 0, magazine: 12, damage: 45,
    cooldown: .29, reload: 1.6, range: 30, aimRange: 36, noise: 32, recoil: .065,
    moveScale: 1, pellets: 1, spread: 0, startReserve: 18,
    ammo: { price: 18, amount: 12, maxPacks: 3, label: 'Caja 9 mm · 12 balas' },
  },
  revolver: {
    id: 'revolver', name: 'Revólver R-6', price: 420, magazine: 6, damage: 90,
    cooldown: .6, reload: 2.2, range: 25, aimRange: 34, noise: 40, recoil: .105,
    moveScale: .97, pellets: 1, spread: 0, startReserve: 0,
    ammo: { price: 28, amount: 12, maxPacks: 3, label: 'Caja .357 · 12 balas' },
  },
  smg: {
    id: 'smg', name: 'Vípera MP-9', price: 640, magazine: 24, damage: 28,
    cooldown: .11, reload: 1.9, range: 24, aimRange: 30, noise: 38, recoil: .042,
    moveScale: .95, pellets: 1, spread: .012, startReserve: 0,
    ammo: { price: 32, amount: 36, maxPacks: 3, label: 'Cargador MP-9 · 36 balas' },
  },
  shotgun: {
    id: 'shotgun', name: 'Quiebra-12', price: 820, magazine: 5, damage: 26,
    cooldown: .78, reload: 2.8, range: 16, aimRange: 20, noise: 48, recoil: .16,
    moveScale: .88, pellets: 6, spread: .055, startReserve: 0,
    ammo: { price: 38, amount: 15, maxPacks: 3, label: 'Caja del 12 · 15 cartuchos' },
  },
  rifle: {
    id: 'rifle', name: 'Cerraja-7', price: 1050, magazine: 8, damage: 120,
    cooldown: .85, reload: 2.6, range: 46, aimRange: 60, noise: 46, recoil: .13,
    moveScale: .82, pellets: 1, spread: 0, startReserve: 0,
    ammo: { price: 44, amount: 16, maxPacks: 3, label: 'Peine 7,62 · 16 balas' },
  },
  compact: {
    id: 'compact', name: 'Recortada C-2', price: 900, magazine: 2, damage: 34,
    cooldown: .55, reload: 2.4, range: 12, aimRange: 15, noise: 52, recoil: .19,
    moveScale: .95, pellets: 8, spread: .075, startReserve: 0,
    ammo: { price: 32, amount: 12, maxPacks: 3, label: 'Cartuchos cortos · 12' },
  },
  carbine: {
    id: 'carbine', name: 'Carabina V-9', price: 1200, magazine: 20, damage: 52,
    cooldown: .16, reload: 2, range: 34, aimRange: 44, noise: 40, recoil: .05,
    moveScale: .93, pellets: 1, spread: .008, startReserve: 0,
    ammo: { price: 36, amount: 30, maxPacks: 3, label: 'Peine 5,56 · 30 balas' },
  },
  marksman: {
    id: 'marksman', name: 'Tiradora Larga', price: 1500, magazine: 5, damage: 165,
    cooldown: 1.05, reload: 2.9, range: 60, aimRange: 78, noise: 50, recoil: .17,
    moveScale: .78, pellets: 1, spread: 0, startReserve: 0,
    ammo: { price: 52, amount: 10, maxPacks: 3, label: 'Caja de precisión · 10' },
  },
  // --- v1.2 additions -------------------------------------------------------
  burst: {
    id: 'burst', name: 'Ráfaga B-3', price: 1350, magazine: 30, damage: 34,
    cooldown: .42, reload: 2.1, range: 32, aimRange: 40, noise: 42, recoil: .055,
    moveScale: .92, pellets: 1, spread: .01, startReserve: 0, burst: 3, burstDelay: .07,
    ammo: { price: 40, amount: 30, maxPacks: 3, label: 'Peine 4,6 · 30 balas' },
  },
  magnum: {
    id: 'magnum', name: 'Cazador .44', price: 1750, magazine: 6, damage: 210,
    cooldown: .95, reload: 2.7, range: 40, aimRange: 52, noise: 56, recoil: .21,
    moveScale: .9, pellets: 1, spread: 0, startReserve: 0,
    ammo: { price: 58, amount: 12, maxPacks: 3, label: 'Caja .44 Magnum · 12' },
  },
  pump: {
    id: 'pump', name: 'Corredera P-8', price: 1950, magazine: 8, damage: 30,
    cooldown: .62, reload: 3.1, range: 18, aimRange: 22, noise: 50, recoil: .14,
    moveScale: .86, pellets: 7, spread: .048, startReserve: 0,
    ammo: { price: 46, amount: 16, maxPacks: 3, label: 'Caja del 12 · 16 cartuchos' },
  },
  lmg: {
    id: 'lmg', name: 'Mula-60', price: 2400, magazine: 60, damage: 40,
    cooldown: .085, reload: 4.2, range: 38, aimRange: 46, noise: 60, recoil: .075,
    moveScale: .7, pellets: 1, spread: .022, startReserve: 0,
    ammo: { price: 64, amount: 60, maxPacks: 3, label: 'Cinta 7,62 · 60 balas' },
  },
});

/**
 * Skins are no longer cosmetic-only: each one trades something away. The
 * `modifiers` are additive deltas applied at run start.
 */
export const SKINS = deepFreeze({
  survivor: {
    id: 'survivor', name: 'Superviviente', price: 0, jacket: '#405c68',
    pants: '#493d39', hair: '#302c29', backpack: '#6e5b43',
    modifiers: { health: 0, speed: 0, damage: 0 },
    tension: 'Sin modificadores. La referencia.',
  },
  crimson: {
    id: 'crimson', name: 'Guardia carmesí', price: 480, jacket: '#743f46',
    pants: '#303740', hair: '#302c29', backpack: '#50483c',
    modifiers: { health: 20, speed: -.04, damage: 0 },
    tension: '+20 vitales, −4% velocidad.',
  },
  olive: {
    id: 'olive', name: 'Exploradora', price: 620, jacket: '#626b43',
    pants: '#383b36', hair: '#6a4934', backpack: '#4b443b',
    modifiers: { health: -10, speed: .09, damage: 0 },
    tension: '+9% velocidad, −10 vitales.',
  },
  ash: {
    id: 'ash', name: 'Chatarrera', price: 780, jacket: '#4a4a44',
    pants: '#2f3330', hair: '#8a7a5e', backpack: '#5c5344',
    modifiers: { health: 0, speed: -.06, damage: .12 },
    tension: '+12% daño, −6% velocidad.',
  },
  reborn: {
    id: 'reborn', name: 'Renacida', price: 1100, jacket: '#25282a',
    pants: '#293b50', hair: '#bda36c', backpack: '#4b4236',
    modifiers: { health: -25, speed: .15, damage: 0 },
    tension: '+15% velocidad, −25 vitales. Frágil y rápida.',
  },
});

const MAX_CREDITS = 999999;
const MAX_COMPLETED_RUNS = 128;
const hasOwn = (object, key) =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(object, key);
const integer = (value, max) =>
  Number.isFinite(value) ? Math.max(0, Math.min(max, Math.trunc(value))) : 0;
const validRunId = value =>
  typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);

const emptyAmmo = () => Object.fromEntries(Object.keys(WEAPONS).map(id => [id, 0]));
const weaponIds = () => Object.keys(WEAPONS);

export function defaultProfile() {
  return {
    version: PROFILE_VERSION,
    credits: 0,
    ownedWeapons: ['pistol'],
    ownedSkins: ['survivor'],
    ownedAttachments: [],
    attachments: {},
    weapon: 'pistol',
    skin: 'survivor',
    ammo: emptyAmmo(),
    completedRuns: [],
    firstRunDone: false,
  };
}

/** v1 had a single `ammoPacks` counter; v2 had no attachments; v3 predates v1.2. */
function migrate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (input.version === PROFILE_VERSION) return input;
  if (input.version === 3) {
    // Same shape, new catalogue: normalizeProfile re-validates every id.
    return { ...input, version: PROFILE_VERSION };
  }
  if (input.version === 2) {
    return { ...input, version: PROFILE_VERSION, ownedAttachments: [], attachments: {} };
  }
  if (input.version !== 1) return null;
  const packs = integer(input.ammoPacks, 2);
  return {
    ...input,
    version: PROFILE_VERSION,
    ammo: { ...emptyAmmo(), pistol: packs * 6 },
    ownedAttachments: [],
    attachments: {},
    firstRunDone: Array.isArray(input.completedRuns) && input.completedRuns.length > 0,
  };
}

export function normalizeProfile(input) {
  const source = migrate(input);
  if (!source) return defaultProfile();
  const ownedIds = (ids, catalog, fallback) => [...new Set([
    fallback, ...(Array.isArray(ids) ? ids.filter(id => hasOwn(catalog, id)) : []),
  ])];
  const ownedWeapons = ownedIds(source.ownedWeapons, WEAPONS, 'pistol');
  const ownedSkins = ownedIds(source.ownedSkins, SKINS, 'survivor');
  const ownedAttachments = [...new Set(
    Array.isArray(source.ownedAttachments)
      ? source.ownedAttachments.filter(id => hasOwn(ATTACHMENTS, id))
      : [],
  )];
  const ammo = emptyAmmo();
  if (source.ammo && typeof source.ammo === 'object' && !Array.isArray(source.ammo)) {
    for (const id of weaponIds()) {
      const cap = WEAPONS[id].ammo.amount * WEAPONS[id].ammo.maxPacks;
      ammo[id] = integer(source.ammo[id], cap);
    }
  }
  return {
    version: PROFILE_VERSION,
    credits: integer(source.credits, MAX_CREDITS),
    ownedWeapons,
    ownedSkins,
    ownedAttachments,
    attachments: normalizeLoadout(source.attachments, ownedAttachments, weaponIds()),
    weapon: ownedWeapons.includes(source.weapon) ? source.weapon : 'pistol',
    skin: ownedSkins.includes(source.skin) ? source.skin : 'survivor',
    ammo,
    completedRuns: [...new Set(
      Array.isArray(source.completedRuns) ? source.completedRuns.filter(validRunId) : [],
    )].slice(-MAX_COMPLETED_RUNS),
    firstRunDone: source.firstRunDone === true,
  };
}

/**
 * `kind` is 'weapon' | 'skin' | 'ammo' | 'attachment'. For ammo, `id` is the
 * weapon whose rounds are being bought, and the stock cap is per weapon.
 */
export function purchase(profile, kind, id) {
  const next = normalizeProfile(profile);
  const fail = message => ({ profile: next, ok: false, message });
  let item;
  let ownedKey;
  if (kind === 'weapon' || kind === 'skin' || kind === 'attachment') {
    const catalog = kind === 'weapon' ? WEAPONS : kind === 'skin' ? SKINS : ATTACHMENTS;
    if (!hasOwn(catalog, id)) return fail('Artículo desconocido.');
    item = catalog[id];
    ownedKey = kind === 'weapon' ? 'ownedWeapons'
      : kind === 'skin' ? 'ownedSkins' : 'ownedAttachments';
    if (next[ownedKey].includes(id)) return fail('Ya tienes este artículo.');
  } else if (kind === 'ammo' && hasOwn(WEAPONS, id)) {
    const weapon = WEAPONS[id];
    if (!next.ownedWeapons.includes(id)) return fail('Primero necesitas esa arma.');
    item = weapon.ammo;
    const cap = item.amount * item.maxPacks;
    if (next.ammo[id] >= cap) return fail(`Munición al máximo para ${weapon.name}.`);
  } else {
    return fail('Artículo desconocido.');
  }
  if (next.credits < item.price) return fail('Créditos insuficientes.');
  next.credits -= item.price;
  if (kind === 'ammo') {
    const cap = item.amount * item.maxPacks;
    next.ammo[id] = Math.min(cap, next.ammo[id] + item.amount);
  } else {
    next[ownedKey].push(id);
    if (kind !== 'attachment') next[kind] = id;
  }
  return { profile: next, ok: true, message: `${item.name || item.label}: compra realizada.` };
}

export function equip(profile, kind, id) {
  const next = normalizeProfile(profile);
  const catalog = kind === 'weapon' ? WEAPONS : kind === 'skin' ? SKINS : null;
  if (!catalog || !hasOwn(catalog, id)) {
    return { profile: next, ok: false, message: 'Artículo desconocido.' };
  }
  const owned = kind === 'weapon' ? next.ownedWeapons : next.ownedSkins;
  if (!owned.includes(id)) {
    return { profile: next, ok: false, message: 'Primero debes comprar este artículo.' };
  }
  next[kind] = id;
  return { profile: next, ok: true, message: `${catalog[id].name}: equipado.` };
}

/**
 * Mounts an attachment on the currently equipped weapon. One item per slot:
 * mounting a second muzzle device swaps the first one out.
 */
export function equipAttachmentOn(profile, attachmentId) {
  const next = normalizeProfile(profile);
  const item = ATTACHMENTS[attachmentId];
  if (!item) return { profile: next, ok: false, message: 'Acople desconocido.' };
  if (!next.ownedAttachments.includes(attachmentId)) {
    return { profile: next, ok: false, message: 'Primero debes comprar este acople.' };
  }
  const weapon = WEAPONS[next.weapon];
  if (!item.compatible.includes(weapon.id)) {
    return { profile: next, ok: false, message: `${item.name} no encaja en ${weapon.name}.` };
  }
  const current = next.attachments[weapon.id] || [];
  if (current.includes(attachmentId)) {
    return { profile: next, ok: false, message: `${item.name}: ya está montado.` };
  }
  next.attachments = {
    ...next.attachments,
    [weapon.id]: equipAttachment(current, attachmentId),
  };
  return { profile: next, ok: true, message: `${item.name}: montado en ${weapon.name}.` };
}

export function unequipAttachmentFrom(profile, attachmentId) {
  const next = normalizeProfile(profile);
  const item = ATTACHMENTS[attachmentId];
  if (!item) return { profile: next, ok: false, message: 'Acople desconocido.' };
  const weapon = WEAPONS[next.weapon];
  const current = next.attachments[weapon.id] || [];
  if (!current.includes(attachmentId)) {
    return { profile: next, ok: false, message: `${item.name}: no está montado.` };
  }
  const remaining = unequipAttachment(current, attachmentId);
  const attachments = { ...next.attachments };
  if (remaining.length) attachments[weapon.id] = remaining;
  else delete attachments[weapon.id];
  next.attachments = attachments;
  return { profile: next, ok: true, message: `${item.name}: desmontado.` };
}

/** Effective run stats: weapon + attachments, then skin modifiers, clamped. */
export function runStats(weaponId, skinId, attachmentIds = []) {
  const base = WEAPONS[weaponId] || WEAPONS.pistol;
  const weapon = resolveWeapon(base, attachmentIds) || base;
  const skin = SKINS[skinId] || SKINS.survivor;
  const modifiers = skin.modifiers || { health: 0, speed: 0, damage: 0 };
  return {
    weapon,
    skin,
    maxHealth: Math.max(40, Math.round(100 + (modifiers.health || 0))),
    speedScale: Math.max(.6, weapon.moveScale * (1 + (modifiers.speed || 0))),
    damageScale: Math.max(.5, 1 + (modifiers.damage || 0)),
  };
}

/**
 * Consumes the purchased rounds for the equipped weapon and reports the
 * magazine plus reserve the run starts with. Purchased ammo is spent, not banked.
 */
export function beginRun(profile, runId) {
  if (!validRunId(runId)) throw new TypeError('Identificador de salida no válido.');
  const next = normalizeProfile(profile);
  const base = WEAPONS[next.weapon] || WEAPONS.pistol;
  const mounted = next.attachments[base.id] || [];
  const weapon = resolveWeapon(base, mounted) || base;
  const bought = next.ammo[weapon.id] || 0;
  next.ammo = { ...next.ammo, [weapon.id]: 0 };
  const reserve = weapon.startReserve + bought;
  const stats = runStats(weapon.id, next.skin, mounted);
  return {
    profile: next,
    runId,
    loadout: {
      weapon: weapon.id,
      skin: next.skin,
      attachments: [...mounted],
      extraAmmo: bought,
      reserve,
      magazine: Math.min(weapon.magazine, weapon.magazine + reserve),
      maxHealth: stats.maxHealth,
      speedScale: stats.speedScale,
      damageScale: stats.damageScale,
    },
  };
}

export function rewardExtraction(profile, runId, options = {}) {
  const next = normalizeProfile(profile);
  if (!validRunId(runId)) {
    return { profile: next, awarded: 0, message: 'Identificador de salida no válido.' };
  }
  if (next.completedRuns.includes(runId)) {
    return { profile: next, awarded: 0, message: 'Esta extracción ya fue recompensada.' };
  }
  const supplies = options && typeof options === 'object' &&
    !Array.isArray(options) && options.supplies === true;
  const reward = EXTRACTION_REWARD + (supplies ? SUPPLIES_BONUS : 0);
  const awarded = Math.min(reward, MAX_CREDITS - next.credits);
  next.credits += awarded;
  next.firstRunDone = true;
  // Bounded history is a local duplicate guard, not an anti-cheating ledger.
  next.completedRuns = [...next.completedRuns, runId].slice(-MAX_COMPLETED_RUNS);
  return { profile: next, awarded, message: `Extracción completada: +${awarded} créditos.` };
}

export function loadProfile() {
  try {
    const raw = globalThis.localStorage.getItem(ECONOMY_KEY);
    if (raw !== null) return normalizeProfile(JSON.parse(raw));
    for (const key of [LEGACY_ECONOMY_KEY, LEGACY_ECONOMY_KEY_V2, LEGACY_ECONOMY_KEY_V1]) {
      const legacy = globalThis.localStorage.getItem(key);
      if (legacy !== null) return normalizeProfile(JSON.parse(legacy));
    }
    return defaultProfile();
  } catch (_) {
    return defaultProfile();
  }
}

export function saveProfile(profile) {
  try {
    globalThis.localStorage.setItem(ECONOMY_KEY, JSON.stringify(normalizeProfile(profile)));
    return true;
  } catch (_) {
    // Unavailable, blocked or full storage must not prevent playing this session.
    return false;
  }
}

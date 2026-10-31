// Pure mission rules: the renderer owns health, ammunition, combat and visuals.
function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
}

/**
 * Two ways out of the district, chosen at the fork.
 *
 * `short` runs straight down the avenue: fewer metres, more infected, no
 * supplies. `long` swings past the clinic: roughly twice the walk, thinner
 * opposition, and a supply cache that pays the extraction bonus.
 */
export const ROUTES = deepFreeze({
  short: {
    id: 'short', name: 'Ruta corta', subtitle: 'Avenida directa',
    description: 'Menos metros, más infectados. Sin suministros.',
    danger: 'ALTA', supplies: false, extraEnemies: 6,
    waypoints: [],
  },
  long: {
    id: 'long', name: 'Ruta larga', subtitle: 'Desvío por la clínica',
    description: 'El doble de camino, menos presión y un alijo de suministros.',
    danger: 'MEDIA', supplies: true, extraEnemies: 0,
    waypoints: [{ x: -9, z: -37, label: 'Clínica · alijo de suministros' }],
  },
});

export const MISSION = deepFreeze({
  start: { x: 0, z: 54 },
  fork: { x: 0, z: 8 },
  clinic: { x: -9, z: -37 },
  extraction: { x: 5.8, z: -82 },
  initialAmmo: 12,
  initialReserve: 36,
  magazineSize: 12,
  interactRadius: 2.8,
  pickups: [
    { id: 'ammo-east', kind: 'ammo', x: 7.8, z: 22, amount: 16, label: 'Caja de Munición · +16 balas' },
    { id: 'aid-west', kind: 'health', x: -8, z: -5, amount: 35, label: 'Botiquín táctico · +35 salud' },
    { id: 'ammo-west', kind: 'ammo', x: -8.1, z: -58, amount: 18, label: 'Caja de Munición · +18 balas' },
    { id: 'ammo-long', kind: 'ammo', x: -8.4, z: -30, amount: 24, label: 'Alijo militar · +24 balas', route: 'long' },
    { id: 'aid-long', kind: 'health', x: -8.6, z: -46, amount: 45, label: 'Botiquín militar · +45 salud', route: 'long' },
  ],
});

export const ENEMY_TYPES = deepFreeze({
  shambler: { name: 'Errante', hp: 90 },
  runner: { name: 'Corredor', hp: 90 },
  resistant: { name: 'Resistente', hp: 180 },
  brute: { name: 'Bruto blindado', hp: 270 },
});

export function createMission() {
  return { stage: 'route', route: null, collected: [], supplies: false };
}

/** Pickups available on the chosen route (route-tagged ones need that route). */
export function routePickups(route) {
  return MISSION.pickups.filter(pickup => !pickup.route || pickup.route === route);
}

/**
 * The current objective. Before the fork it points at the fork; afterwards it
 * walks the route's waypoints and finally the extraction.
 */
export function missionTarget(progress) {
  if (progress.stage === 'complete') return null;
  if (progress.stage === 'route' || !progress.route) {
    return { ...MISSION.fork, label: 'Elige una ruta de escape' };
  }
  const route = ROUTES[progress.route] || ROUTES.short;
  const pending = route.waypoints.filter(point => !progress.collected.includes(`wp-${point.z}`));
  if (pending.length) {
    return { ...pending[0], label: pending[0].label };
  }
  return { ...MISSION.extraction, label: 'Alcanza la zona de extracción' };
}

export function nearbyInteraction(position, progress) {
  if (progress.stage === 'complete' || !Number.isFinite(position?.x) || !Number.isFinite(position?.z)) return null;
  const candidates = routePickups(progress.route)
    .filter(pickup => !progress.collected.includes(pickup.id));
  if (progress.stage === 'route') {
    candidates.push({
      id: 'fork', kind: 'fork', label: 'Elegir ruta de escape', ...MISSION.fork,
    });
  } else {
    const route = ROUTES[progress.route] || ROUTES.short;
    for (const point of route.waypoints) {
      if (!progress.collected.includes(`wp-${point.z}`)) {
        candidates.push({
          id: `wp-${point.z}`, kind: 'supplies', label: point.label, x: point.x, z: point.z,
        });
      }
    }
    candidates.push({
      id: 'extraction', kind: 'extract', label: 'Salir del distrito', ...MISSION.extraction,
    });
  }
  let closest = null;
  let distance = MISSION.interactRadius;
  for (const candidate of candidates) {
    const nextDistance = Math.hypot(position.x - candidate.x, position.z - candidate.z);
    if (nextDistance <= distance) {
      closest = candidate;
      distance = nextDistance;
    }
  }
  // Never expose the frozen config objects as mutable gameplay state.
  return closest ? { ...closest } : null;
}

export function applyInteraction(progress, id, choice = null) {
  const unchanged = () => ({ progress, reward: {}, event: null });
  if (progress.stage === 'complete') return unchanged();
  if (id === 'fork') {
    if (progress.stage !== 'route') return unchanged();
    const route = choice && ROUTES[choice] ? choice : 'short';
    return {
      progress: { ...progress, collected: [...progress.collected], stage: 'extraction', route },
      reward: {},
      event: 'route',
      route,
    };
  }
  if (id === 'extraction') {
    if (progress.stage !== 'extraction') return unchanged();
    return {
      progress: { ...progress, collected: [...progress.collected], stage: 'complete' },
      reward: {},
      event: 'extract',
    };
  }
  if (id.startsWith('wp-')) {
    if (progress.collected.includes(id)) return unchanged();
    const route = ROUTES[progress.route] || ROUTES.short;
    const point = route.waypoints.find(candidate => `wp-${candidate.z}` === id);
    if (!point) return unchanged();
    return {
      progress: {
        ...progress,
        collected: [...progress.collected, id],
        supplies: route.supplies ? true : progress.supplies,
      },
      reward: route.supplies ? { ammo: 6, health: 15 } : {},
      event: 'supplies',
    };
  }
  const pickup = MISSION.pickups.find(candidate => candidate.id === id);
  if (!pickup || progress.collected.includes(id)) return unchanged();
  if (pickup.route && pickup.route !== progress.route) return unchanged();
  return {
    progress: { ...progress, collected: [...progress.collected, id] },
    reward: { [pickup.kind]: pickup.amount },
    event: pickup.kind,
  };
}

// Each call gets its own PRNG; this cannot perturb visual or gameplay randomness.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

export function createEnemySpawns(route = 'short') {
  const random = seededRandom(0xd1570909);
  const cars = [{ x: -6, z: 5 }, { x: 6, z: -18 }, { x: -6, z: -43 }, { x: 6, z: 44 }];
  const runners = new Set([5, 16, 28]);
  const brutes = new Set([10, 23, 34]);
  const resistant = new Set([3, 8, 13, 20, 26, 31]);
  const clear = (x, z) =>
    Math.hypot(x - MISSION.start.x, z - MISSION.start.z) >= 14 &&
    Math.hypot(x - MISSION.clinic.x, z - MISSION.clinic.z) >= 4 &&
    Math.hypot(x - MISSION.extraction.x, z - MISSION.extraction.z) >= 4 &&
    !cars.some(car => Math.abs(x - car.x) <= 1.7 && Math.abs(z - car.z) <= 2.7);

  // The short route is the dangerous one: it adds a handful of extra infected
  // along the avenue. Before the fork is chosen the district holds the base
  // population only, so the choice is what actually raises the pressure.
  const extra = route ? (ROUTES[route] || ROUTES.short).extraEnemies : 0;
  const total = 36 + extra;

  return Array.from({ length: total }, (_, index) => {
    // Stagger both sides rather than making a solid row across the road.
    const z = Number(Math.max(-85, Math.min(31, 31 - index * 116 / 35 + random() * 1.4 - .7)).toFixed(3));
    const side = index % 2 ? 1 : -1;
    let x;
    for (let attempt = 0; attempt < 24; attempt++) {
      x = Number((side * (2.6 + random() * 4.8)).toFixed(3));
      if (clear(x, z)) break;
    }
    // This inner-left lane is clear of all configured cars and mission areas.
    if (!clear(x, z)) x = -2.6;
    const kind = runners.has(index) ? 'runner' : brutes.has(index) ? 'brute' :
      resistant.has(index) ? 'resistant' : 'shambler';
    // Keep the same PRNG calls and spawn positions as before this balance pass.
    const speed = kind === 'runner' ? 2.05 : kind === 'brute' ? .82 :
      Number((1.05 + random() * .33).toFixed(2));
    return {
      id: `infected-${String(index + 1).padStart(2, '0')}`,
      x, z, kind, hp: ENEMY_TYPES[kind].hp,
      speed: kind === 'resistant' ? Number((speed * .85).toFixed(2)) : speed,
      yaw: Number((random() * Math.PI * 2).toFixed(6)),
    };
  });
}

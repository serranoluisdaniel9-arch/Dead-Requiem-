/**
 * Street lighting with ONE recycled PointLight.
 *
 * v1.1 created a PointLight for every third lamp post — eight lights, each one
 * a full per-fragment lighting pass on every lit material. That is the single
 * most expensive thing in the scene and it is invisible: only the two or three
 * lamps near the player are ever on screen.
 *
 * This module keeps one PointLight and moves it to the nearest lamp each frame.
 * The visual result is identical where it matters (the pool of light you are
 * standing in) and the cost is one light instead of eight.
 *
 * It also owns the fog: `FogExp2` at 0.0385 was effectively opaque by 40 m, so
 * the far city was drawn and then hidden. A linear `Fog` with a real near/far
 * pair gives depth you can see into, and the camera far plane can come in.
 */

/**
 * @param {object} options
 * @param {Array<{x:number,y:number,z:number}>} options.lamps  lamp head positions
 */
export function createStreetLighting({ THREE, scene, lamps = [], color = '#ffce9b' }) {
  const light = new THREE.PointLight(color, 0, 14, 2);
  light.name = 'recycled-street-lamp';
  light.castShadow = false;
  scene.add(light);

  let activeIndex = -1;
  let intensity = 0;

  /**
   * Moves the light to the lamp nearest `position` and fades it in/out so the
   * hand-off between two lamps is not a visible pop.
   */
  function update(position, dt = 0) {
    if (!lamps.length) return;
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < lamps.length; i++) {
      const lamp = lamps[i];
      const dx = lamp.x - position.x;
      const dz = lamp.z - position.z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    // Beyond ~18 m the pool of light is out of frame anyway.
    const target = bestDistance < 18 * 18 ? 5.2 : 0;
    if (best !== activeIndex) {
      activeIndex = best;
      const lamp = lamps[best];
      light.position.set(lamp.x, lamp.y, lamp.z);
    }
    // Exponential approach: no per-frame allocation, no visible step.
    const blend = dt > 0 ? 1 - Math.exp(-dt * 6) : 1;
    intensity += (target - intensity) * blend;
    light.intensity = intensity;
  }

  return {
    light,
    update,
    get lampCount() { return lamps.length; },
    get activeLamp() { return activeIndex; },
    get intensity() { return intensity; },
  };
}

/**
 * Fog with real depth. `near` is where it starts to bite, `far` where it is
 * fully opaque; the camera far plane should sit just past `far`.
 */
export function createDepthFog({ THREE, scene, color = '#bdc3bd', near = 26, far = 96 }) {
  const fog = new THREE.Fog(color, near, far);
  scene.fog = fog;
  return {
    fog,
    /** Fog density at a given distance, 0..1 — used by the tests. */
    densityAt(distance) {
      return Math.max(0, Math.min(1, (distance - near) / (far - near)));
    },
    get near() { return fog.near; },
    get far() { return fog.far; },
  };
}

/**
 * Varied surface response. v1.1 used `roughness: .8` for almost everything, so
 * asphalt, concrete, steel and cloth all caught the light identically and the
 * street read as one flat grey mass. These presets give each family its own
 * roughness/metalness pair.
 */
export const SURFACE_PRESETS = Object.freeze({
  asphalt: { roughness: .62, metalness: .04 },
  wetAsphalt: { roughness: .34, metalness: .12 },
  pavement: { roughness: .88, metalness: .02 },
  concrete: { roughness: .93, metalness: .01 },
  paintedSteel: { roughness: .42, metalness: .55 },
  bareSteel: { roughness: .28, metalness: .82 },
  glass: { roughness: .12, metalness: .35 },
  rubber: { roughness: .97, metalness: 0 },
  cloth: { roughness: .95, metalness: 0 },
  brick: { roughness: .86, metalness: .02 },
  rust: { roughness: .78, metalness: .22 },
});

/** Builds a MeshStandardMaterial from a preset name, with an optional colour. */
export function surface(THREE, preset, color, extra = {}) {
  const base = SURFACE_PRESETS[preset] || SURFACE_PRESETS.concrete;
  return new THREE.MeshStandardMaterial({ color, ...base, ...extra });
}

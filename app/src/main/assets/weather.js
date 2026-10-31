/**
 * Weather: rain, wet surfaces and ambient smoke.
 *
 * v1.3 had `rainCount = 0` — the rain buffer existed but was never filled, so
 * the "rain" in the README was a dead code path. This module makes it real and
 * ties it to the graphics profile, so a low-end phone gets no rain at all
 * rather than a stutter.
 *
 * Three pieces:
 *   1. Rain — one LineSegments buffer of slanted streaks, recycled in a box
 *      around the player. No allocation per frame.
 *   2. Wet surfaces — the road and pavement materials get a lower roughness and
 *      a slight metalness, which is what makes a wet street catch the lamp
 *      light in a long smear instead of a flat sheen. It is a material change,
 *      not a filter, so it costs nothing per frame.
 *   3. Smoke — a handful of slow, large, very faint sprites drifting up from
 *      the wrecks. Cheap, and it is what sells "something burned here".
 */

/**
 * Rain streaks. Each drop is a two-vertex segment, so one draw call covers the
 * whole storm.
 */
export function createRain({ THREE, scene, count = 520, area = 34, height = 22, color = '#a8c4d0' }) {
  const positions = new Float32Array(Math.max(0, count) * 6);
  const speeds = new Float32Array(Math.max(0, count));
  let s = 3319;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };

  for (let i = 0; i < count; i++) {
    const j = i * 6;
    const x = (rnd() - 0.5) * area;
    const y = rnd() * height;
    const z = (rnd() - 0.5) * area;
    // A slanted streak: the tail is offset down and slightly back, which reads
    // as wind rather than as vertical dashes.
    positions[j] = x; positions[j + 1] = y; positions[j + 2] = z;
    positions[j + 3] = x - 0.10; positions[j + 4] = y - 0.72; positions[j + 5] = z + 0.06;
    speeds[i] = 13 + rnd() * 9;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color, transparent: true, opacity: 0.22, depthWrite: false, fog: true,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = 'rain';
  lines.frustumCulled = false;
  lines.visible = count > 0;
  scene.add(lines);

  const attribute = geometry.attributes.position;

  function update(position, dt = 0) {
    if (count <= 0) return;
    const array = attribute.array;
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    for (let i = 0; i < count; i++) {
      const j = i * 6;
      const fall = speeds[i] * step;
      array[j + 1] -= fall;
      array[j + 4] -= fall;
      if (array[j + 1] < 0) {
        // Recycle to the top, re-centred on the player so the storm follows.
        const x = position.x + (rnd() - 0.5) * area;
        const z = position.z + (rnd() - 0.5) * area;
        array[j] = x; array[j + 1] = height; array[j + 2] = z;
        array[j + 3] = x - 0.10; array[j + 4] = height - 0.72; array[j + 5] = z + 0.06;
      }
    }
    attribute.needsUpdate = true;
  }

  return {
    lines,
    update,
    get count() { return count; },
    setVisible(visible) { lines.visible = visible && count > 0; },
  };
}

/**
 * Wet-surface response. Applied to the road and pavement materials at boot.
 *
 * A wet street is not "shinier": it is *smoother*, so the specular highlight
 * spreads into a long vertical smear under each lamp. Lowering roughness and
 * adding a little metalness is the cheap, correct way to get that.
 */
export function applyWetSurfaces({ materials = [], wet = true } = {}) {
  let changed = 0;
  for (const material of materials) {
    if (!material || !material.isMeshStandardMaterial) continue;
    if (wet) {
      material.roughness = Math.min(material.roughness ?? 1, 0.34);
      material.metalness = Math.max(material.metalness ?? 0, 0.16);
      // A wet surface is darker where it is smooth: the water absorbs.
      if (material.color) material.color.multiplyScalar(0.88);
    }
    material.needsUpdate = true;
    changed++;
  }
  return { changed, wet };
}

/**
 * Ambient smoke: slow, large, faint sprites rising from a list of sources.
 * One shared texture, one material per plume, recycled in place.
 */
export function createSmokePlumes({ THREE, scene, sources = [], count = 5, texture = null }) {
  const plumes = [];
  if (count <= 0 || !sources.length) {
    return { group: null, update() {}, get count() { return 0; } };
  }
  const group = new THREE.Group();
  group.name = 'ambient-smoke';
  scene.add(group);

  for (let i = 0; i < count; i++) {
    const source = sources[i % sources.length];
    const material = new THREE.SpriteMaterial({
      map: texture, color: '#6d6a63', transparent: true,
      opacity: 0.10, depthWrite: false, fog: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(source.x, source.y || 0.4, source.z);
    sprite.scale.setScalar(2.2 + (i % 3) * 0.9);
    group.add(sprite);
    plumes.push({
      sprite, material, source,
      baseY: source.y || 0.4,
      phase: i * 1.9,
      rise: 0.22 + (i % 4) * 0.06,
      drift: 0.5 + (i % 3) * 0.3,
    });
  }

  function update(time = 0) {
    for (const plume of plumes) {
      const cycle = (time * plume.rise + plume.phase) % 6;
      plume.sprite.position.y = plume.baseY + cycle;
      plume.sprite.position.x = plume.source.x + Math.sin(time * 0.3 + plume.phase) * plume.drift;
      plume.sprite.position.z = plume.source.z + Math.cos(time * 0.24 + plume.phase) * plume.drift;
      // Fade in at the source, out at the top of the cycle.
      const t = cycle / 6;
      plume.material.opacity = 0.13 * Math.sin(t * Math.PI);
      plume.sprite.scale.setScalar(2.0 + t * 3.4);
    }
  }

  return {
    group, update,
    get count() { return plumes.length; },
    setVisible(visible) { group.visible = visible; },
  };
}

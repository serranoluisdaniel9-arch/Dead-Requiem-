/**
 * Zombie part instancing.
 *
 * The draw-call ceiling in v1.3 was the characters: 37 bodies × 9 meshes = 333
 * draws if they were all on screen. The street had already been batched, so
 * there was nothing left to merge there.
 *
 * The rig cannot be merged — thighs, shins and arms are separate pivots because
 * they rotate independently. But every zombie of the same archetype shares the
 * *same geometry and the same material*, which is exactly the case InstancedMesh
 * exists for.
 *
 * So: keep the pivot hierarchy and the pose solver completely untouched, hide
 * the per-zombie meshes, and mirror each part's world matrix into one
 * InstancedMesh per (archetype, part). The animation code still writes
 * `pivot.rotation.x`; this layer just reads the resulting matrix.
 *
 * Cost: 9 draws per *archetype* instead of 9 per *zombie*. With six archetypes
 * on screen that is 54 draws instead of 200+.
 *
 * The one thing that must be right: a hidden or dead zombie has to be pushed
 * out of the instance buffer, or its last matrix keeps drawing a body at the
 * place it died.
 */

const ZERO = { x: 0, y: 0, z: 0, w: 0 };

/**
 * @param {object} options
 * @param {object} options.THREE
 * @param {object} options.scene
 * @param {number} options.capacity  max simultaneous zombies per archetype
 */
export function createZombieInstancer({ THREE, scene, capacity = 48 }) {
  /** archetypeKey -> { parts: Map<name, {mesh, geometry, count}>, order: [] } */
  const archetypes = new Map();
  /** far:<kind> -> { mesh, count, key } — the single-draw LOD, also instanced. */
  const farBatches = new Map();
  let registered = 0;
  let lastDrawn = 0;
  let lastFarDrawn = 0;

  /**
   * v1.4: the batch key is the *kind*, not the (kind, variant) pair.
   *
   * The 36 zombies are spread over 8 (kind, variant) archetypes, and each
   * archetype was costing 9 batches — 72 draws for the crowd alone. But the
   * variants differ only in palette: same silhouette, same topology, different
   * baked vertex colours. Instancing already carries a per-instance colour, so
   * the variant can be a tint instead of a separate geometry.
   *
   * That takes the crowd from 8 archetypes to 4, and from 72 batches to 36,
   * while every zombie keeps its own colour.
   */
  function keyFor(character) {
    const rig = character?.rig;
    if (!rig || !rig.zombie) return null;
    return rig.kind;
  }

  /** A stable per-variant tint, so two shamblers do not look identical. */
  function tintFor(character) {
    const variant = character?.rig?.variant ?? 0;
    // Small, warm/cool drift around white: enough to read as different people,
    // not enough to look like a different material.
    const hue = (variant * 0.37) % 1;
    const c = new THREE.Color().setHSL(hue, 0.10, 0.5);
    return new THREE.Color(0.86 + c.r * 0.28, 0.86 + c.g * 0.28, 0.86 + c.b * 0.28);
  }

  /**
   * Registers one zombie's parts. Called once per archetype, on the first body
   * of that archetype that is created; later bodies of the same archetype reuse
   * the buffers.
   *
   * v1.4: parts are grouped by (geometry, material), not one batch per part.
   * The left and right thigh share a geometry and a material, so they belong in
   * the same InstancedMesh — instancing carries the per-instance matrix, so two
   * limbs of one body are just two instances. That takes an archetype from 9
   * batches to 5, which is the difference between 72 and 40 draws with eight
   * archetypes on screen.
   */
  function register(character) {
    const key = keyFor(character);
    if (!key) return null;
    const existing = archetypes.get(key);
    if (existing) {
      // A later body of an archetype that is already batched: its own meshes
      // must be hidden too, or it would draw twice (once per-mesh, once in the
      // batch). This is the bug that would otherwise show up as doubled limbs.
      for (const mesh of Object.values(character.rig.meshes || {})) {
        if (mesh) mesh.visible = false;
      }
      return existing;
    }
    const parts = new Map();
    const order = [];
    /** partName -> batch key, so update() knows which buffer a part feeds. */
    const partToBatch = new Map();
    for (const [name, mesh] of Object.entries(character.rig.meshes || {})) {
      if (!mesh || !mesh.geometry) continue;
      const batchKey = `${mesh.geometry.uuid}|${mesh.material?.uuid || 'none'}`;
      let part = parts.get(batchKey);
      if (!part) {
        const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, capacity);
        instanced.name = `zombie-batch-${key}-${parts.size}`;
        instanced.castShadow = true;
        instanced.receiveShadow = true;
        instanced.frustumCulled = false;
        instanced.count = 0;
        // A zero matrix for every slot: an unused instance must draw nothing.
        const zero = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let i = 0; i < capacity; i++) instanced.setMatrixAt(i, zero);
        instanced.instanceMatrix.needsUpdate = true;
        scene.add(instanced);
        part = { mesh: instanced, count: 0, names: [] };
        parts.set(batchKey, part);
        order.push(batchKey);
      }
      part.names.push(name);
      partToBatch.set(name, batchKey);
      // The per-zombie mesh is now redundant: the batch draws it.
      mesh.visible = false;
    }
    const entry = { parts, order, key, partToBatch };
    archetypes.set(key, entry);
    registered++;
    return entry;
  }

  /**
   * Rebuilds every batch from the live zombie list. Called once per frame after
   * the pose solver has run, so the matrices are current.
   *
   * `bodies` is the list of characters to draw this frame (already filtered for
   * visibility and LOD by the caller). A body may carry `flashTint` (0..1) for
   * the white impact flash — with shared materials a per-mesh emissive would
   * flash the whole archetype, so the flash is a per-instance colour instead.
   */
  function update(bodies) {
    for (const entry of archetypes.values()) {
      for (const part of entry.parts.values()) part.count = 0;
    }
    const scratch = new THREE.Matrix4();
    const tint = new THREE.Color();
    const WHITE = new THREE.Color(1, 1, 1);
    for (const character of bodies) {
      const key = keyFor(character);
      const entry = key ? archetypes.get(key) : null;
      if (!entry) continue;
      const flash = Math.max(0, Math.min(1, character.flashTint || 0));
      const base = tintFor(character);
      for (const batchKey of entry.order) {
        const part = entry.parts.get(batchKey);
        if (!part) continue;
        // A batch may hold several parts of this body (both thighs, both arms).
        for (const name of part.names) {
          const mesh = character.rig.meshes[name];
          if (!mesh || part.count >= capacity) continue;
          // matrixWorld already includes the group scale, the pivot rotation and
          // the mesh's own local offset — everything the pose solver wrote.
          scratch.copy(mesh.matrixWorld);
          part.mesh.setMatrixAt(part.count, scratch);
          // Per-instance colour carries the variant tint and the impact flash.
          tint.copy(base).lerp(new THREE.Color(2.2, 2.2, 2.2), flash);
          part.mesh.setColorAt(part.count, tint);
          part.count++;
        }
      }
    }
    let drawn = 0;
    for (const entry of archetypes.values()) {
      for (const part of entry.parts.values()) {
        part.mesh.count = part.count;
        part.mesh.instanceMatrix.needsUpdate = true;
        if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
        if (part.count > 0) drawn++;
      }
    }
    lastDrawn = drawn;
    return drawn;
  }

  /**
   * v1.4: the distant LOD is instanced too.
   *
   * A far zombie is one merged mesh, so it was already "cheap" at 1 draw — but
   * 36 of them is 36 draws, which was the single largest block in the scene.
   * They all share one geometry per kind, so they collapse to 4 draws.
   */
  function registerFar(character) {
    const rig = character?.rig;
    if (!rig || !rig.zombie || !character.distant) return null;
    const key = `far:${rig.kind}`;
    const existing = farBatches.get(key);
    if (existing) { character.distant.visible = false; return existing; }
    const source = character.distant;
    const instanced = new THREE.InstancedMesh(source.geometry, source.material, capacity);
    instanced.name = `zombie-far-${rig.kind}`;
    instanced.castShadow = true;
    instanced.receiveShadow = true;
    instanced.frustumCulled = false;
    instanced.count = 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) instanced.setMatrixAt(i, zero);
    instanced.instanceMatrix.needsUpdate = true;
    scene.add(instanced);
    const entry = { mesh: instanced, count: 0, key };
    farBatches.set(key, entry);
    source.visible = false;
    return entry;
  }

  /** Rebuilds the far batches from the bodies the caller marked as distant. */
  function updateFar(bodies) {
    for (const entry of farBatches.values()) entry.count = 0;
    const scratch = new THREE.Matrix4();
    const tint = new THREE.Color();
    for (const character of bodies) {
      const rig = character?.rig;
      if (!rig || !rig.zombie || !character.distant) continue;
      const entry = farBatches.get(`far:${rig.kind}`);
      if (!entry || entry.count >= capacity) continue;
      scratch.copy(character.distant.matrixWorld);
      entry.mesh.setMatrixAt(entry.count, scratch);
      tint.copy(tintFor(character));
      entry.mesh.setColorAt(entry.count, tint);
      entry.count++;
    }
    let drawn = 0;
    for (const entry of farBatches.values()) {
      entry.mesh.count = entry.count;
      entry.mesh.instanceMatrix.needsUpdate = true;
      if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
      if (entry.count > 0) drawn++;
    }
    lastFarDrawn = drawn;
    return drawn;
  }

  /** Hides every batch — used when the run ends or the scene is torn down. */
  function clear() {
    for (const entry of archetypes.values()) {
      for (const part of entry.parts.values()) {
        part.mesh.count = 0;
        part.count = 0;
        part.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (const entry of farBatches.values()) {
      entry.mesh.count = 0;
      entry.count = 0;
      entry.mesh.instanceMatrix.needsUpdate = true;
    }
    lastDrawn = 0;
    lastFarDrawn = 0;
  }

  return {
    register,
    registerFar,
    update,
    updateFar,
    clear,
    get archetypeCount() { return registered; },
    get drawCalls() { return lastDrawn + lastFarDrawn; },
    get nearDrawCalls() { return lastDrawn; },
    get farDrawCalls() { return lastFarDrawn; },
    get capacity() { return capacity; },
    /** Total instances currently drawn, for the tests. */
    get instanceCount() {
      let total = 0;
      for (const entry of archetypes.values()) {
        for (const part of entry.parts.values()) total += part.count;
      }
      for (const entry of farBatches.values()) total += entry.count;
      return total;
    },
  };
}

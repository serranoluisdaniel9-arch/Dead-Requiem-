/**
 * Destroyed-city dressing: the layer that makes the street read as a place
 * people used to live in, not a corridor of boxes.
 *
 * Everything here is instanced by (geometry, material) pair, so the whole
 * module costs a handful of draw calls no matter how many props it places.
 * Nothing is fetched: geometry is primitive, textures come from
 * procedural-textures.js.
 *
 * The module owns visuals and colliders only. It never touches the mission,
 * the player or the HUD.
 */
import { texturedMaterial } from './procedural-textures.js';

export function decorateDestroyedCity({ THREE, scene, materials: M = {}, obstacles = [], quality = 'high' }) {
  const root = new THREE.Group();
  root.name = 'destroyed-city';
  scene.add(root);

  const box = new THREE.BoxGeometry(1, 1, 1);
  const plane = new THREE.PlaneGeometry(1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  const rock = new THREE.IcosahedronGeometry(1, 0);
  const shard = new THREE.TetrahedronGeometry(1, 0);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  // --- materials -----------------------------------------------------------
  // One material per surface family. Every prop that shares a family shares the
  // material, which is what makes the batching below possible.
  const brick = texturedMaterial(THREE, 'brick', { repeat: 2, bumpScale: .05, roughness: 1 });
  const plaster = texturedMaterial(THREE, 'plaster', { repeat: 2, bumpScale: .04 });
  const concrete = texturedMaterial(THREE, 'concrete', { repeat: 2, bumpScale: .035 });
  const rust = texturedMaterial(THREE, 'rust', { repeat: 1, bumpScale: .05, metalness: .55 });
  const wood = texturedMaterial(THREE, 'wood', { repeat: 1, bumpScale: .03 });
  const asphalt = texturedMaterial(THREE, 'asphalt', { repeat: 3, bumpScale: .02 });
  const glassDark = new THREE.MeshStandardMaterial({
    color: '#1b2426', roughness: .18, metalness: .5, transparent: true, opacity: .55,
  });
  const voidMat = new THREE.MeshBasicMaterial({ color: '#080b0c' });
  const cableMat = new THREE.MeshStandardMaterial({ color: '#14181a', roughness: .9, metalness: .1 });
  const emberMat = new THREE.MeshStandardMaterial({
    color: '#c8763a', emissive: '#a34d18', emissiveIntensity: 1.1, roughness: .8,
  });

  // --- batching ------------------------------------------------------------
  const batches = new Map();
  function part(geometry, material, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, color = null) {
    const key = `${geometry.uuid}/${material.uuid}`;
    if (!batches.has(key)) batches.set(key, { geometry, material, items: [] });
    batches.get(key).items.push({ x, y, z, sx, sy, sz, rx, ry, rz, color });
  }
  const block = (material, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, color = null) =>
    part(box, material, x, y, z, sx, sy, sz, rx, ry, rz, color);

  function collider(x, z, rx, rz) { obstacles.push({ x, z, rx, rz }); }

  // Deterministic local RNG: the city must look the same on every load.
  let s = 20261029;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const between = (a, b) => a + rnd() * (b - a);

  // --- 1. destroyed facades ------------------------------------------------
  // The base buildings come from game.js. This layer adds what a blast does to
  // them: blown-out window openings, missing wall sections, exposed floor slabs,
  // and rubble where the wall came down.
  const facadeZ = [];
  for (let i = 0; i < 15; i++) facadeZ.push(-105 + i * 13);

  for (const side of [-1, 1]) {
    for (let i = 0; i < facadeZ.length; i++) {
      const z = facadeZ[i];
      const faceX = side * 11.9;
      // Two or three blown windows per facade: a black recess plus a frame.
      const blown = 2 + Math.floor(rnd() * 2);
      for (let b = 0; b < blown; b++) {
        const wy = between(4.2, 12.5);
        const wz = z + between(-4.2, 4.2);
        // The recess sits just inside the wall plane, so it reads as a hole.
        block(voidMat, faceX - side * .06, wy, wz, .1, 1.5, 1.45);
        // Broken frame: two stubs of mullion, one hanging shard of glass.
        block(concrete, faceX - side * .02, wy + .78, wz, .12, .1, 1.5);
        block(concrete, faceX - side * .02, wy - .78, wz, .12, .1, 1.5);
        if (rnd() < .6) {
          part(shard, glassDark, faceX - side * .04, wy + between(-.5, .5), wz + between(-.5, .5),
            between(.18, .4), between(.3, .7), .04, 0, 0, between(-.4, .4));
        }
      }
      // A collapsed wall section on roughly one facade in three: the corner is
      // gone, the floor slabs are exposed, and the debris is on the pavement.
      if (rnd() < .34) {
        const cz = z + between(-3.5, 3.5);
        const ch = between(3.5, 7);
        // Exposed slab edges, stacked, receding into the building.
        for (let f = 0; f < Math.floor(ch / 3); f++) {
          block(concrete, faceX - side * .55, 3 + f * 3, cz, 1.1, .22, between(2.4, 3.6));
        }
        // Interior darkness behind the missing wall.
        block(voidMat, faceX - side * 1.1, ch * .5, cz, .12, ch, 3.4);
        // Rubble fan on the pavement, spilling toward the kerb.
        const pieces = quality === 'low' ? 5 : 11;
        for (let p = 0; p < pieces; p++) {
          const spread = between(.2, 2.6);
          part(rock, concrete,
            faceX - side * spread, between(.06, .5), cz + between(-2.2, 2.2),
            between(.16, .55), between(.12, .4), between(.16, .55),
            rnd() * 3, rnd() * 3, rnd() * 3);
        }
        for (let p = 0; p < 4; p++) {
          block(brick, faceX - side * between(.4, 2.2), between(.05, .3), cz + between(-2, 2),
            between(.2, .5), between(.1, .22), between(.2, .5), 0, rnd() * 3, 0);
        }
      }
      // Soot streaks above the blown windows: a dark plane on the wall face.
      if (rnd() < .5) {
        part(plane, voidMat, faceX - side * .015, between(6, 14), z + between(-3, 3),
          1.1, between(2, 5), 1, 0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      }
    }
  }

  // --- 2. abandoned vehicles ----------------------------------------------
  // The four hero cars come from game.js. These are the wrecks: burnt shells,
  // a van on its side, a bus blocking a lane, all built from instanced boxes.
  const wrecks = [
    { x: -7.4, z: -62, kind: 'burnt', ry: .18 },
    { x: 7.2, z: 8, kind: 'van', ry: -.12 },
    { x: -6.9, z: 30, kind: 'burnt', ry: .05 },
    { x: 6.8, z: -78, kind: 'sedan', ry: .22 },
    { x: -7.6, z: -12, kind: 'sedan', ry: -.3 },
  ];
  for (const w of wrecks) {
    const bodyMat = w.kind === 'burnt' ? rust : concrete;
    const bodyColor = w.kind === 'burnt' ? '#3a2f28' : '#4a5254';
    if (w.kind === 'van') {
      block(bodyMat, w.x, .95, w.z, 2.0, 1.5, 4.4, 0, w.ry, 0, bodyColor);
      block(voidMat, w.x, 1.35, w.z + 2.21, 1.7, .7, .06, 0, w.ry, 0);
      // On its side: the whole shell is rolled 90°.
      block(bodyMat, w.x + 1.1, .55, w.z - 1.2, 1.9, 1.1, 2.2, 0, w.ry, Math.PI / 2, bodyColor);
      collider(w.x, w.z, 1.5, 2.4);
    } else if (w.kind === 'burnt') {
      block(bodyMat, w.x, .62, w.z, 1.8, .6, 3.6, 0, w.ry, 0, bodyColor);
      block(bodyMat, w.x, 1.15, w.z - .2, 1.5, .55, 1.8, 0, w.ry, 0, bodyColor);
      // Burnt-out window apertures.
      block(voidMat, w.x, 1.2, w.z + .72, 1.3, .4, .05, 0, w.ry, 0);
      block(voidMat, w.x, 1.2, w.z - 1.12, 1.3, .4, .05, 0, w.ry, 0);
      // Embers still glowing in the engine bay.
      block(emberMat, w.x, .78, w.z + 1.5, .7, .12, .5, 0, w.ry, 0);
      collider(w.x, w.z, 1.15, 2.1);
    } else {
      block(bodyMat, w.x, .68, w.z, 1.85, .62, 3.7, 0, w.ry, 0, bodyColor);
      block(bodyMat, w.x, 1.28, w.z - .2, 1.55, .66, 1.9, 0, w.ry, 0, bodyColor);
      block(voidMat, w.x, 1.32, w.z + .76, 1.4, .44, .05, 0, w.ry, 0);
      collider(w.x, w.z, 1.2, 2.2);
    }
    // Wheels: two visible on the near side, one missing on the burnt shells.
    const wheelCount = w.kind === 'burnt' ? 2 : 4;
    for (let i = 0; i < wheelCount; i++) {
      const sx = (i % 2 ? 1 : -1) * .92;
      const sz = (i < 2 ? 1 : -1) * 1.15;
      part(cylinder, M.boots || concrete, w.x + sx, .36, w.z + sz, .36, .2, .36, 0, 0, Math.PI / 2);
    }
  }

  // --- 3. shipping containers and barricade walls --------------------------
  const containers = [
    { x: -9.6, z: -46, ry: .06, color: '#5a4a3a' },
    { x: 9.5, z: 52, ry: -.04, color: '#3f4a44' },
    { x: -9.4, z: 66, ry: .1, color: '#4a3f3a' },
  ];
  for (const c of containers) {
    block(rust, c.x, 1.3, c.z, 2.4, 2.6, 6.0, 0, c.ry, 0, c.color);
    // Corrugation: thin ribs down the long faces.
    for (let r = 0; r < 9; r++) {
      block(rust, c.x - 1.22, 1.3, c.z - 2.6 + r * .65, .06, 2.5, .12, 0, c.ry, 0, '#2f2a26');
    }
    // Door end with its locking bars.
    block(rust, c.x, 1.3, c.z + 3.02, 2.3, 2.5, .08, 0, c.ry, 0, '#332c26');
    for (const bx of [-.7, 0, .7]) {
      block(M.steel || rust, c.x + bx, 1.3, c.z + 3.08, .07, 2.3, .07, 0, c.ry, 0);
    }
    collider(c.x, c.z, 1.35, 3.1);
  }

  // --- 4. fallen lamp posts and cables ------------------------------------
  // Two lamps are down: the pole lies across the pavement, the head is smashed.
  const fallen = [
    { x: -9.2, z: -34, ry: .9 },
    { x: 9.0, z: 20, ry: -1.1 },
  ];
  for (const f of fallen) {
    part(cylinder, M.steel || rust, f.x, .16, f.z, .12, 6.0, .12, Math.PI / 2, 0, f.ry);
    // The head, detached, a couple of metres away.
    block(M.steel || rust, f.x + Math.cos(f.ry) * 3.1, .18, f.z + Math.sin(f.ry) * 3.1,
      .55, .16, .3, 0, f.ry, 0);
    block(glassDark, f.x + Math.cos(f.ry) * 3.1, .26, f.z + Math.sin(f.ry) * 3.1,
      .45, .06, .24, 0, f.ry, 0);
    collider(f.x, f.z, .5, .5);
  }
  // Cables: catenaries strung between facades, sagging into the street.
  const cableSegments = quality === 'low' ? 3 : 7;
  for (let c = 0; c < cableSegments; c++) {
    const z0 = -80 + c * 24 + between(-4, 4);
    const y0 = between(6.5, 9.5);
    const sag = between(.8, 2.2);
    const steps = 9;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const x0 = -11.6 + t0 * 23.2, x1 = -11.6 + t1 * 23.2;
      const ya = y0 - Math.sin(t0 * Math.PI) * sag;
      const yb = y0 - Math.sin(t1 * Math.PI) * sag;
      const dx = x1 - x0, dy = yb - ya;
      const len = Math.hypot(dx, dy);
      part(cylinder, cableMat, (x0 + x1) / 2, (ya + yb) / 2, z0,
        .022, len, .022, 0, 0, Math.atan2(dy, dx) - Math.PI / 2);
    }
  }

  // --- 5. street debris: rubble, planks, tyres, papers --------------------
  const debrisCount = quality === 'low' ? 26 : quality === 'medium' ? 54 : 88;
  for (let i = 0; i < debrisCount; i++) {
    const side = rnd() < .5 ? -1 : 1;
    const x = side * between(8.6, 11.2);
    const z = between(-92, 74);
    const kind = rnd();
    if (kind < .45) {
      // Concrete rubble.
      part(rock, concrete, x, between(.05, .22), z,
        between(.1, .34), between(.08, .26), between(.1, .34),
        rnd() * 3, rnd() * 3, rnd() * 3);
    } else if (kind < .68) {
      // Broken brick.
      block(brick, x, between(.04, .12), z, between(.16, .3), between(.08, .14), between(.1, .2),
        0, rnd() * 3, 0);
    } else if (kind < .84) {
      // Plank or board.
      block(wood, x, between(.03, .1), z, between(.1, .22), .04, between(.7, 1.8),
        0, rnd() * 3, 0);
    } else {
      // A tyre on its side.
      part(cylinder, M.boots || concrete, x, .12, z, .34, .18, .34, 0, 0, Math.PI / 2);
    }
  }

  // --- 6. road damage: cracks and potholes --------------------------------
  // Decals are flat planes lifted a hair above the asphalt, so they never
  // z-fight and never need a second material pass on the road itself.
  const potholes = quality === 'low' ? 4 : 9;
  for (let i = 0; i < potholes; i++) {
    const x = between(-7.5, 7.5), z = between(-88, 70);
    part(plane, asphalt, x, -.018, z, between(1.1, 2.6), between(.9, 2.1), 1,
      -Math.PI / 2, 0, rnd() * 3);
    // A dark rim so the patch reads as a hole rather than a stain.
    part(plane, voidMat, x, -.016, z, between(.5, 1.2), between(.4, .9), 1,
      -Math.PI / 2, 0, rnd() * 3);
  }

  // --- 7. emergency lighting fixtures -------------------------------------
  // Amber beacons on the barricades and the clinic approach. These are emissive
  // meshes, not lights: the scene keeps exactly one PointLight.
  const beacons = [
    { x: -7.8, z: 16 }, { x: 7.8, z: -31 }, { x: -11.2, z: -30 }, { x: 11.2, z: 37 },
  ];
  for (const b of beacons) {
    block(M.steel || rust, b.x, 1.62, b.z, .16, .3, .16);
    block(emberMat, b.x, 1.82, b.z, .13, .13, .13);
  }

  // --- flush ---------------------------------------------------------------
  let drawCalls = 0, instances = 0;
  for (const { geometry, material, items } of batches.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    const hasColor = items.some(item => item.color);
    items.forEach((item, i) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.rotation.set(item.rx, item.ry, item.rz);
      dummy.scale.set(item.sx, item.sy, item.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (hasColor) mesh.setColorAt(i, tint.set(item.color || '#ffffff'));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    // Only the big silhouettes cast: rubble and papers would cost shadow-map
    // draws for detail nobody can see in the dark.
    mesh.castShadow = false;
    mesh.computeBoundingSphere();
    mesh.name = 'destroyed-batch';
    root.add(mesh);
    drawCalls++;
    instances += items.length;
  }

  return {
    root,
    stats: { drawCalls, instances, batches: batches.size, wrecks: wrecks.length, containers: containers.length },
  };
}

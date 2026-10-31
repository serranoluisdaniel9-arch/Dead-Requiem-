/**
 * Original exterior mission props. This module owns visuals only: no colliders,
 * DOM UI, interaction checks or mission transitions. Coordinates are world-space.
 */
export function createMissionWorld({ THREE, scene, materials: M = {}, mission }) {
  const root = new THREE.Group();
  root.name = 'mission-world';
  scene.add(root);
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const planeGeometry = new THREE.PlaneGeometry(1, 1);
  const material = (color, extra = {}) => new THREE.MeshStandardMaterial({
    color, roughness: .9, ...extra
  });
  const steel = M.steel || material('#545e59');
  const dark = M.trim || material('#323a35');
  const ivory = material('#c5c8b6');
  const green = material('#536b59');
  const olive = material('#62684d');
  const wood = material('#726c58');
  const paint = material('#a9ad92');
  const batches = new Map();
  const dummy = new THREE.Object3D();

  function block(parent, surface, x, y, z, w, h, d) {
    const mesh = new THREE.Mesh(boxGeometry, surface);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function fixed(surface, x, y, z, w, h, d) {
    if (!batches.has(surface)) batches.set(surface, []);
    batches.get(surface).push([x, y, z, w, h, d]);
  }
  function texture(width, height, draw, transparent = false) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({
      map, transparent, roughness: .95, depthWrite: !transparent,
      polygonOffset: transparent, polygonOffsetFactor: -1,
      side: THREE.DoubleSide
    });
  }
  function plane(parent, surface, x, y, z, w, h, floor = false) {
    const mesh = new THREE.Mesh(planeGeometry, surface);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, 1);
    if (floor) mesh.rotation.x = -Math.PI / 2;
    parent.add(mesh);
    return mesh;
  }
  function cross(ctx, x, y, size, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x - size / 6, y - size / 2, size / 3, size);
    ctx.fillRect(x - size / 2, y - size / 6, size, size / 3);
  }
  function wear(ctx, width, height, color, count = 55) {
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      ctx.fillRect((i * 137 + 31) % width, (i * 73 + 19) % height, 2 + i % 13, 1 + i % 2);
    }
  }
  const clinicSign = texture(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3c5348'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b9c1ab'; ctx.lineWidth = 6; ctx.strokeRect(10, 10, w - 20, h - 20);
    cross(ctx, 107, 122, 103, '#d5d8c3');
    ctx.fillStyle = '#e0dfcc'; ctx.textAlign = 'left';
    ctx.font = 'bold 92px sans-serif'; ctx.fillText('CLÍNICA 09', 200, 123);
    ctx.font = '30px sans-serif'; ctx.fillText('SUMINISTROS DE EMERGENCIA', 202, 186);
    wear(ctx, w, h, 'rgba(34,43,34,.25)');
  });
  const shutter = texture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#52685a'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 19) {
      ctx.fillStyle = '#36493f'; ctx.fillRect(0, y, w, 3);
      ctx.fillStyle = '#708073'; ctx.fillRect(0, y + 3, w, 2);
    }
    wear(ctx, w, h, '#7f7962', 90);
    ctx.fillStyle = '#c0c4ad'; ctx.fillRect(46, 205, 164, 86);
    ctx.fillStyle = '#3e4c40'; ctx.textAlign = 'center';
    ctx.font = 'bold 24px sans-serif'; ctx.fillText('CERRADO', 128, 241);
    ctx.font = '13px sans-serif'; ctx.fillText('RECOGIDA EXTERIOR', 128, 269);
    ctx.fillStyle = '#303b33'; ctx.fillRect(98, 451, 60, 9);
  });
  const healthStencil = texture(128, 128, ctx => {
    ctx.fillStyle = '#c8ccbc'; ctx.fillRect(0, 0, 128, 128);
    cross(ctx, 64, 64, 70, '#8e4940');
    wear(ctx, 128, 128, 'rgba(66,64,48,.25)', 16);
  });
  const clinicStencil = texture(128, 128, ctx => {
    ctx.fillStyle = '#59705b'; ctx.fillRect(0, 0, 128, 128);
    cross(ctx, 64, 64, 64, '#d8d9c5');
    wear(ctx, 128, 128, 'rgba(35,43,32,.3)', 16);
  });
  const ammoStencil = texture(256, 128, ctx => {
    ctx.fillStyle = '#62684d'; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#b9a767';
    for (let i = 0; i < 3; i++) {
      const x = 85 + i * 37;
      ctx.fillRect(x, 43, 17, 48);
      ctx.beginPath(); ctx.moveTo(x, 43); ctx.lineTo(x + 8.5, 27);
      ctx.lineTo(x + 17, 43); ctx.closePath(); ctx.fill();
      ctx.fillRect(x - 2, 87, 21, 6);
    }
    wear(ctx, 256, 128, '#424b36', 35);
  });
  const ringMaterial = texture(128, 128, ctx => {
    ctx.strokeStyle = 'rgba(181,197,157,.42)';
    ctx.lineWidth = 3;
    ctx.setLineDash([22, 12]);
    ctx.beginPath(); ctx.arc(64, 64, 49, 0, Math.PI * 2); ctx.stroke();
  }, true);
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 64;
  const glowContext = glowCanvas.getContext('2d');
  const gradient = glowContext.createRadialGradient(32, 32, 1, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,.7)');
  gradient.addColorStop(.22, 'rgba(255,255,255,.18)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  glowContext.fillStyle = gradient; glowContext.fillRect(0, 0, 64, 64);
  const glowMap = new THREE.CanvasTexture(glowCanvas);
  const beacons = [];
  function beacon(parent, y, color = '#b8c8a0') {
    const surface = new THREE.SpriteMaterial({
      map: glowMap, color, transparent: true, opacity: .22, depthWrite: false
    });
    const sprite = new THREE.Sprite(surface);
    sprite.position.y = y; sprite.scale.set(.85, .85, 1);
    parent.add(sprite);
    beacons.push(surface);
    return surface;
  }
  function anchor(name, position) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(position.x, 0, position.z);
    root.add(group);
    return group;
  }
  function crate(parent, width = .85) {
    block(parent, wood, 0, .32, 0, width, .46, .68);
    for (const z of [-.351, .351]) {
      block(parent, dark, 0, .32, z, width + .025, .055, .024);
    }
  }
  function caseProp(parent, kind, y) {
    const medical = kind !== 'ammo';
    const w = medical ? .7 : .78, d = medical ? .46 : .5;
    block(parent, medical ? ivory : olive, 0, y, 0, w, .24, d);
    block(parent, kind === 'clinic' ? green : medical ? ivory : olive,
      0, y + .147, 0, w + .035, .055, d + .035);
    for (const x of [-w * .32, w * .32]) {
      block(parent, steel, x, y + .05, d / 2 + .014, .065, .115, .028);
    }
    block(parent, dark, 0, y + .02, d / 2 + .038, .22, .055, .045);
    plane(parent, kind === 'clinic' ? clinicStencil : medical ? healthStencil : ammoStencil,
      0, y + .177, 0, w * .72, d * .85, true);
  }

  const clinic = anchor('clinic-exterior-pickup', mission.clinic);
  const clinicCase = new THREE.Group();
  clinicCase.name = 'emergency-medical-case';
  clinic.add(clinicCase);
  crate(clinic, .98);
  caseProp(clinicCase, 'clinic', .71);
  plane(clinicCase, ringMaterial, 0, .014, 0, 1.9, 1.9, true);
  beacon(clinicCase, 1.12);
  // The closed shutter is a facade, not a false promise of an enterable room.
  const facadeX = -11.6, facadeZ = mission.clinic.z;
  fixed(dark, facadeX - .06, 1.65, facadeZ, .2, 3.1, 3.2);
  fixed(ivory, facadeX + .035, 1.6, facadeZ - 1.5, .2, 3, .18);
  fixed(ivory, facadeX + .035, 1.6, facadeZ + 1.5, .2, 3, .18);
  fixed(ivory, facadeX + .035, 3.05, facadeZ, .2, .2, 3.2);
  fixed(steel, facadeX + .2, .14, facadeZ, .45, .12, 3.15);
  const shutterMesh = plane(root, shutter, facadeX + .12, 1.59, facadeZ, 2.8, 2.82);
  shutterMesh.rotation.y = Math.PI / 2;
  const signMesh = plane(root, clinicSign, facadeX + .16, 3.8, facadeZ, 4.7, 1.18);
  signMesh.rotation.y = Math.PI / 2;
  fixed(dark, facadeX - .01, 3.8, facadeZ, .18, 1.27, 4.8);

  const pickups = new Map();
  for (const pickup of mission.pickups || []) {
    const marker = anchor(`pickup-${pickup.id}`, pickup);
    marker.userData.pickupId = pickup.id;
    crate(marker);
    caseProp(marker, pickup.kind, .7);
    plane(marker, ringMaterial, 0, .014, 0, 1.55, 1.55, true);
    beacon(marker, 1.05, pickup.kind === 'health' ? '#c1c9af' : '#c9bc8e');
    pickups.set(pickup.id, marker);
  }

  const extraction = anchor('extraction-rendezvous', mission.extraction);
  const exitSign = texture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#4b5548'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c0c4a8'; ctx.lineWidth = 5; ctx.strokeRect(9, 9, w - 18, h - 18);
    ctx.fillStyle = '#d4d5bd'; ctx.textAlign = 'center';
    ctx.font = 'bold 83px sans-serif'; ctx.fillText('SALIDA', w / 2, 112);
    ctx.font = '29px sans-serif'; ctx.fillText('PUNTO DE REUNIÓN', w / 2, 174);
    ctx.font = '20px monospace'; ctx.fillText('CONTROL 09', w / 2, 214);
    wear(ctx, w, h, 'rgba(29,36,28,.22)');
  });
  const groundPaint = texture(256, 256, (ctx, w, h) => {
    ctx.strokeStyle = 'rgba(187,184,137,.63)'; ctx.lineWidth = 7;
    ctx.setLineDash([38, 11]); ctx.strokeRect(12, 12, w - 24, h - 24);
    ctx.setLineDash([]); ctx.fillStyle = 'rgba(187,184,137,.55)';
    ctx.textAlign = 'center'; ctx.font = 'bold 31px sans-serif'; ctx.fillText('09', 128, 151);
    ctx.globalCompositeOperation = 'destination-out';
    wear(ctx, w, h, 'rgba(0,0,0,.5)', 120);
  }, true);
  plane(extraction, groundPaint, 0, -.026, 0, 4.2, 4.5, true);
  // A low sign sits beyond the landing rectangle, leaving its street approach open.
  block(extraction, steel, 1.65, .8, -2.65, .09, 1.65, .09);
  block(extraction, dark, 1.65, 1.48, -2.65, 1.9, .98, .09);
  plane(extraction, exitSign, 1.65, 1.48, -2.595, 1.85, .925);
  const lampMaterial = material('#bfa56c', {
    emissive: '#9a7238', emissiveIntensity: .28
  });
  block(extraction, dark, 1.65, 2.08, -2.65, .29, .12, .23);
  block(extraction, lampMaterial, 1.65, 2.17, -2.65, .18, .12, .17);
  const exitBeacon = new THREE.Group();
  exitBeacon.position.set(1.65, 2.17, -2.65);
  extraction.add(exitBeacon);
  const exitGlow = beacon(exitBeacon, 0, '#c2a76e');
  // A short, decorative boundary behind the goal; never added to collision data.
  const fenceZ = mission.extraction.z - 6;
  for (let i = 0; i < 7; i++) {
    fixed(steel, mission.extraction.x - 2.7 + i * .9, .72, fenceZ, .055, 1.5, .055);
  }
  for (const y of [.3, 1.2]) {
    fixed(steel, mission.extraction.x, y, fenceZ, 5.5, .05, .05);
  }
  fixed(paint, mission.extraction.x + 2.7, 1.53, fenceZ, .1, .08, .1);
  for (const [surface, parts] of batches) {
    const mesh = new THREE.InstancedMesh(boxGeometry, surface, parts.length);
    parts.forEach(([x, y, z, w, h, d], i) => {
      dummy.position.set(x, y, z); dummy.scale.set(w, h, d); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  /**
   * `collected` is a Set of pickup IDs (or an array); clinic is keyed "clinic" or the supplies boolean.
   * `stage` is visual state only. "extract"/"extraction"/"complete" turn on the
   * ready light; the caller remains the sole authority on mission progression.
   * playerPosition is accepted for a consistent host update API, not mutated.
   */
  function update({ stage, supplies = false, time = 0, playerPosition, collected = new Set() } = {}) {
    const has = id => typeof collected?.has === 'function'
      ? collected.has(id) : Array.isArray(collected) && collected.includes(id);
    for (const [id, marker] of pickups) marker.visible = !has(id);
    const ready = ['extract', 'extraction', 'ready', 'complete', 'completed', 'escaped'].includes(stage);
    clinicCase.visible = !(has('clinic') || has('clinic-supplies') || supplies || stage === 'complete');
    const pulse = .5 + .5 * Math.sin(time * 1.65);
    for (const surface of beacons) surface.opacity = .16 + pulse * .065;
    lampMaterial.color.set(ready ? '#9fbfa4' : '#bfa56c');
    lampMaterial.emissive.set(ready ? '#729f88' : '#9a7238');
    lampMaterial.emissiveIntensity = ready ? .45 + pulse * .12 : .18 + pulse * .035;
    exitGlow.color.set(ready ? '#9fc5b5' : '#c2a76e');
    exitGlow.opacity = ready ? .23 + pulse * .08 : .12 + pulse * .025;
  }
  update();
  return { markers: { clinic, extraction, pickups }, update };
}

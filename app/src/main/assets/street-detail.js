/**
 * Original, procedural street dressing. No models, fonts or images are fetched.
 * Repeated parts are grouped by geometry/material into static instance batches.
 * Lighting and fog belong to the caller, so these muted surfaces work in daylight.
 */
export function decorateStreet({ THREE, scene, materials: M, obstacles }) {
  const group = new THREE.Group();
  group.name = 'abandoned-street-details';
  const batches = new Map();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 7);
  const crown = new THREE.IcosahedronGeometry(1, 0);
  const plane = new THREE.PlaneGeometry(1, 1);
  // v1.2: each prop family gets its own surface response. v1.1 used .94 for
  // every single prop, so bark, painted metal, paper and soil all caught the
  // light identically and the dressing read as one flat mass.
  const material = (color, roughness = .94, metalness = .02) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const bark = material('#625b51', .97, 0);
  const leaves = material('#69715e', .88, 0);
  leaves.flatShading = true;
  const wood = material('#777364', .9, .02);
  const soil = material('#54564a', .99, 0);
  const red = material('#824d43', .72, .18);
  const paper = material('#a7a495', .95, 0);
  const steel = M.steel || material('#626b69');
  const trim = M.trim || material('#3d4240');
  const concrete = M.concrete || material('#85867c');
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  function part(geometry, surface, x, y, z, sx, sy, sz, ry = 0, rz = 0, color) {
    const key = `${geometry.uuid}/${surface.uuid}`;
    if (!batches.has(key)) batches.set(key, { geometry, surface, items: [] });
    batches.get(key).items.push({ x, y, z, sx, sy, sz, ry, rz, color });
  }
  function block(surface, x, y, z, sx, sy, sz, ry = 0, rz = 0) {
    part(box, surface, x, y, z, sx, sy, sz, ry, rz);
  }
  function collider(x, z, rx, rz) {
    obstacles.push({ x, z, rx, rz });
  }
  function canvasMaterial(width, height, paint) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    paint(canvas.getContext('2d'), width, height);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 2;
    return new THREE.MeshStandardMaterial({ map, roughness: .82, metalness: .06, side: THREE.DoubleSide });
  }

  const warning = canvasMaterial(768, 384, (ctx, w, h) => {
    ctx.fillStyle = '#ded8c7'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#883d35'; ctx.fillRect(12, 12, w - 24, h - 24);
    ctx.strokeStyle = '#c7b5a0'; ctx.lineWidth = 3; ctx.strokeRect(24, 24, w - 48, h - 48);
    ctx.fillStyle = '#eee5d2'; ctx.textAlign = 'center';
    ctx.font = 'bold 68px sans-serif'; ctx.fillText('ZONA AISLADA', w / 2, 122);
    ctx.font = 'bold 47px sans-serif'; ctx.fillText('PASO RESTRINGIDO', w / 2, 204);
    ctx.font = '25px monospace'; ctx.fillText('QUARANTINE / NO ENTRY', w / 2, 264);
    ctx.font = '21px monospace'; ctx.fillText('DISTRITO 09  ·  CONTROL SANITARIO', w / 2, 322);
    // Deterministic paint loss; no global random state is consumed.
    ctx.fillStyle = '#b4a18b';
    for (let i = 0; i < 75; i++) ctx.fillRect((i * 113) % w, (i * 61) % h, 2 + i % 8, 1);
  });
  const stripes = canvasMaterial(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#d5cbb0'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#43453e';
    for (let x = -h; x < w + h; x += 104) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 48, 0);
      ctx.lineTo(x + h + 48, h); ctx.lineTo(x + h, h); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#797667';
    for (let i = 0; i < 85; i++) ctx.fillRect((i * 73) % w, (i * 47) % h, 9, 1);
    ctx.strokeStyle = '#a9a38e'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
  });
  const shutter = canvasMaterial(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#777d77'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 17) {
      ctx.fillStyle = '#555d59'; ctx.fillRect(0, y, w, 3);
      ctx.fillStyle = '#95998e'; ctx.fillRect(0, y + 3, w, 2);
    }
    ctx.fillStyle = 'rgba(78,57,42,.32)';
    for (let i = 0; i < 55; i++) ctx.fillRect((i * 131) % w, (i * 79) % h, 1 + i % 5, 9 + i % 41);
    ctx.fillStyle = '#b8b5a5'; ctx.fillRect(155, 215, 202, 69);
    ctx.fillStyle = '#694b40'; ctx.textAlign = 'center'; ctx.font = 'bold 31px sans-serif';
    ctx.fillText('CERRADO', 256, 260);
    ctx.fillStyle = '#444b47'; ctx.fillRect(228, 444, 56, 8);
  });
  const streetName = canvasMaterial(512, 160, (ctx, w, h) => {
    ctx.fillStyle = '#4f635c'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#aeb6a5'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#dedfcb'; ctx.textAlign = 'center';
    ctx.font = 'bold 39px sans-serif'; ctx.fillText('CALLE DEL ALBA', w / 2, 70);
    ctx.font = '24px monospace'; ctx.fillText('SECTOR 09  /  EAST BLOCK', w / 2, 119);
  });

  // Six planters, alternating sidewalks. Trunks leave a walkable curb-side gap.
  [-72, -48, -24, 0, 28, 54].forEach((z, i) => {
    const side = i % 2 ? 1 : -1;
    const x = side * 10.82;
    block(concrete, x, .15, z, 1.45, .25, 1.6);
    block(soil, x, .285, z, 1.26, .025, 1.4);
    part(cylinder, bark, x, 1.98, z, .16, 3.5, .16);
    part(cylinder, bark, x + side * .26, 3.12, z, .085, 1.1, .085, 0, -side * .53);
    part(crown, leaves, x, 4.23, z, 1.35, 1.55, 1.4, i * .8, 0, '#737b66');
    part(crown, leaves, x - side * .65, 3.86, z + .2, .99, 1.02, 1.12, i, 0, '#626e5b');
    part(crown, leaves, x + side * .52, 4.6, z - .25, 1.02, .95, 1.04, i * .5, 0, '#7a806b');
    collider(x, z, .74, .8);
  });

  // Four narrow benches run parallel to the facade, facing the roadway.
  [[-1, -67], [1, -43], [-1, -19], [1, 33]].forEach(([side, z]) => {
    const x = side * 10.84;
    for (let i = 0; i < 3; i++) block(wood, x + (i - 1) * .16, .66, z, .14, .09, 1.85);
    for (let i = 0; i < 2; i++) block(wood, x + side * .27, .97 + i * .17, z, .08, .13, 1.85);
    for (const end of [-.72, .72]) {
      block(steel, x, .39, z + end, .5, .48, .075);
      block(steel, x + side * .27, .86, z + end, .07, .72, .07);
      block(steel, x, .91, z + end, .57, .065, .065);
    }
    collider(x, z, .37, .98);
  });

  // Small, faded fire hydrants near the curb rather than in the travel lane.
  [[-1, -35], [1, 13], [-1, 48]].forEach(([side, z]) => {
    const x = side * 9.48;
    part(cylinder, red, x, .5, z, .18, .75, .18);
    part(cylinder, steel, x, .17, z, .26, .12, .26);
    part(crown, red, x, .94, z, .23, .17, .23);
    part(cylinder, red, x, .62, z, .11, .61, .11, 0, Math.PI / 2);
    collider(x, z, .34, .27);
  });

  // Plane front normals point inward: left wall +X, right wall -X.
  for (const side of [-1, 1]) {
    const angle = -side * Math.PI / 2;
    for (const z of [-14, 24, 61]) {
      block(trim, side * 11.79, 1.52, z, .15, 2.88, 4.24);
      part(plane, shutter, side * 11.69, 1.5, z, 3.94, 2.64, 1, angle);
      block(steel, side * 11.64, 2.94, z, .22, .17, 4.35);
      block(concrete, side * 11.57, .15, z, .55, .12, 4.3);
    }
    part(plane, warning, side * 11.64, 2.05, side < 0 ? -10.3 : 20.3, 2.1, 1.05, 1, angle);
    const z = side < 0 ? 12 : -52;
    part(cylinder, steel, side * 9.7, 1.82, z, .055, 3.5, .055);
    part(plane, streetName, side * 9.68, 3.19, z, 1.95, .61, 1, angle);
    collider(side * 9.7, z, .12, .12);
  }

  // Two 2.3 m barricades at the road edges. Their inner edges are at |x|=6.65:
  // even after collision padding the entire central twelve metres remain clear.
  [[-7.8, 16], [7.8, -31]].forEach(([x, z]) => {
    for (const dx of [-.9, .9]) {
      block(steel, x + dx, .63, z, .11, 1.15, .12);
      block(concrete, x + dx, .13, z, .43, .18, .8);
    }
    block(trim, x, .83, z, 2.3, .53, .15);
    part(plane, stripes, x, .83, z + .082, 2.25, .48, 1);
    part(plane, stripes, x, .83, z - .082, 2.25, .48, 1, Math.PI);
    part(plane, warning, x, 1.49, z, 1.38, .69, 1);
    collider(x, z, 1.15, .42);
  });

  // A few fallen notices tucked along the pavement; deterministic and unlit-free.
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1;
    block(paper, side * (9.3 + (i % 4) * .51), .115, -78 + i * 9.3,
      .14 + (i % 3) * .04, .008, .24, i * 1.7);
  }
  for (const { geometry, surface, items } of batches.values()) {
    const mesh = new THREE.InstancedMesh(geometry, surface, items.length);
    const hasColors = items.some(item => item.color);
    items.forEach((item, i) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.rotation.set(0, item.ry, item.rz);
      dummy.scale.set(item.sx, item.sy, item.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (hasColors) mesh.setColorAt(i, tint.set(item.color || '#ffffff'));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    // No extra shadow-map draws: angular foliage silhouettes still read in fog.
    mesh.castShadow = false;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  group.userData.streetDetail = { trees: 6, benches: 4, barricades: 2, batches: batches.size };
  scene.add(group);
  return group;
}

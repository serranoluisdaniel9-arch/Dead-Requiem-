/**
 * Dead Strike Reborn — original, texture-free procedural civilian characters.
 * +Z is the face; anatomical right is -X. All dimensions are world metres.
 * Animated segments are merged, vertex-coloured geometry, not object-per-detail.
 * No global random source, timer, image, canvas, skeleton, or external asset.
 */
export function createCharacterFactory({ THREE }) {
  if (!THREE?.BufferGeometry) throw new TypeError('createCharacterFactory requires THREE');
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .83, metalness: .035 });
  const cache = new Map();
  const stats = { geometries: 0, materials: 1, npcArchetypes: 0, heroInstances: 0 };
  const heroStyles = {
    survivor: { jacket: '#405c68', pants: '#493d39', hair: '#302c29', backpack: '#6e5b43', hairstyle: 'ponytail', outfit: 'canvas-jacket' },
    crimson: { jacket: '#743f46', pants: '#303740', hair: '#302c29', backpack: '#50483c', hairstyle: 'high-ponytail', outfit: 'high-collar-jacket' },
    olive: { jacket: '#626b43', pants: '#383b36', hair: '#6a4934', backpack: '#4b443b', hairstyle: 'side-braid', outfit: 'rolled-sleeves-scarf' },
    reborn: { jacket: '#25282a', pants: '#293b50', hair: '#bda36c', backpack: '#4b4236', hairstyle: 'layered-bob', outfit: 'open-lapelled-jacket' },
  };
  // Template vertices begin with this palette; every instance is recoloured in
  // createBody, before first use. Only four semantic slots may ever be tinted.
  const defaults = heroStyles.reborn;
  const colorNames = ['jacket', 'pants', 'hair', 'backpack'];
  const slots = { jacket: 1, pants: 2, hair: 3, backpack: 4 };
  const palette = colorNames.map(k => new THREE.Color(defaults[k]));
  const colorCache = new Map();
  const Y = new THREE.Vector3(0, 1, 0);
  const TAU = Math.PI * 2;
  const slot = (name, shade = 1) => ({ slot: slots[name], shade });
  function rgb(value) {
    if (value && typeof value === 'object') {
      const c = palette[value.slot - 1], s = value.shade;
      return [c.r * s, c.g * s, c.b * s];
    }
    if (!colorCache.has(value)) {
      const c = new THREE.Color(value);
      colorCache.set(value, [c.r, c.g, c.b]);
    }
    return colorCache.get(value);
  }
  // Integer hash is local/stateless: producing an outfit never advances game RNG.
  const hash = n => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const shade = (hex, amount) => { const c = new THREE.Color(hex).multiplyScalar(amount); return '#' + c.getHexString(); };
  class Builder {
    constructor(origin = [0, 0, 0]) { this.origin = origin; this.p = []; this.c = []; this.i = []; this.s = []; this.sh = []; }
    vertex(p, color, matrix) {
      const v = new THREE.Vector3(...p); if (matrix) v.applyMatrix4(matrix);
      const index = this.p.length / 3;
      this.p.push(v.x - this.origin[0], v.y - this.origin[1], v.z - this.origin[2]);
      this.c.push(...rgb(color)); this.s.push(color?.slot || 0); this.sh.push(color?.shade ?? 1); return index;
    }
    // Profile is [height, horizontal radius, depth radius, x-offset?, z-offset?].
    profile(rings, color, radial = 12, start = 0, sweep = TAU, matrix = null, caps = true) {
      const base = this.p.length / 3, closed = sweep === TAU, stride = radial + (closed ? 0 : 1);
      for (const r of rings) for (let j = 0; j < stride; j++) {
        const angle = start + sweep * j / radial;
        this.vertex([(r[3] || 0) + Math.sin(angle) * r[1], r[0], (r[4] || 0) + Math.cos(angle) * r[2]], color, matrix);
      }
      for (let k = 0; k < rings.length - 1; k++) for (let j = 0; j < radial; j++) {
        const a = base + k * stride + j, next = base + k * stride + (j + 1) % stride, b = a + stride;
        this.i.push(a, next, b, next, next + stride, b);
      }
      if (caps && sweep === TAU) for (const [k, top] of [[0, false], [rings.length - 1, true]]) {
        const r = rings[k], center = this.vertex([r[3] || 0, r[0], r[4] || 0], color, matrix);
        for (let j = 0; j < radial; j++) {
          const a = base + k * stride + j, next = base + k * stride + (j + 1) % stride;
          this.i.push(...(top ? [center, a, next] : [center, next, a]));
        }
      }
    }
    ellipsoid(center, scale, color, radial = 10, vertical = 6) {
      const rings = [];
      for (let j = 0; j <= vertical; j++) {
        const a = -Math.PI / 2 + Math.PI * j / vertical, r = Math.max(.001, Math.cos(a));
        rings.push([center[1] + Math.sin(a) * scale[1], r * scale[0], r * scale[2], center[0], center[2]]);
      }
      this.profile(rings, color, radial);
    }
    limb(a, b, r1, r2, color, radial = 10) {
      const direction = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
      const length = direction.length(), q = new THREE.Quaternion().setFromUnitVectors(Y, direction.normalize());
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...a), q, new THREE.Vector3(1, 1, 1));
      this.profile([[0, r1, r1 * .86], [length * .18, r1 * 1.02, r1 * .89], [length * .82, r2 * 1.07, r2 * .9], [length, r2, r2 * .84]], color, radial, 0, TAU, matrix);
    }
    poly(points, color) {
      const ids = points.map(p => this.vertex(p, color));
      const ab = new THREE.Vector3(...points[1]).sub(new THREE.Vector3(...points[0]));
      const ac = new THREE.Vector3(...points[2]).sub(new THREE.Vector3(...points[0]));
      const normal = ab.cross(ac), centerZ = points.reduce((s, p) => s + p[2], 0) / points.length;
      const reverse = Math.abs(centerZ) > .035 ? normal.z * centerZ < 0 : normal.x * points[0][0] < 0;
      for (let j = 1; j < ids.length - 1; j++) this.i.push(...(reverse ? [ids[0], ids[j + 1], ids[j]] : [ids[0], ids[j], ids[j + 1]]));
    }
    patch(outline, color, surface) {
      const center = outline.reduce((s, p) => [s[0] + p[0] / outline.length, s[1] + p[1] / outline.length], [0, 0]);
      const mid = this.vertex([center[0], center[1], surface(...center)], color);
      const ids = outline.map(p => this.vertex([p[0], p[1], surface(...p)], color));
      const ab = new THREE.Vector2(...outline[1]).sub(new THREE.Vector2(...outline[0]));
      const ac = new THREE.Vector2(...outline[2]).sub(new THREE.Vector2(...outline[0]));
      const reverse = ab.x * ac.y - ab.y * ac.x < 0;
      for (let i = 0; i < ids.length; i++) {
        const next = (i + 1) % ids.length;
        this.i.push(...(reverse ? [mid, ids[next], ids[i]] : [mid, ids[i], ids[next]]));
      }
    }
    seam(a, b, color, radius = .003) { this.limb(a, b, radius, radius, color, 5); }
    // A curved leaf/ribbon in the XY plane, used for overlapping hair locks.
    ribbon(points, widths, color, back = false) {
      const ids = [];
      for (let j = 0; j < points.length; j++) {
        const before = points[Math.max(0, j - 1)], after = points[Math.min(points.length - 1, j + 1)];
        const dx = after[0] - before[0], dy = after[1] - before[1], len = Math.hypot(dx, dy) || 1;
        const w = widths[j] / 2, p = points[j];
        ids.push(this.vertex([p[0] + dy / len * w, p[1] - dx / len * w, p[2]], color), this.vertex([p[0] - dy / len * w, p[1] + dx / len * w, p[2]], color));
      }
      for (let j = 0; j < points.length - 1; j++) {
        const n = j * 2;
        this.i.push(...(back ? [ids[n], ids[n + 1], ids[n + 2], ids[n + 1], ids[n + 3], ids[n + 2]] : [ids[n], ids[n + 2], ids[n + 1], ids[n + 1], ids[n + 2], ids[n + 3]]));
      }
    }
    finish() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      geometry.setIndex(this.i); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      stats.geometries++;
      return { geometry, slots: Uint8Array.from(this.s), shades: Float32Array.from(this.sh) };
    }
  }
  const clothes = [
    ['#655f51', '#333d47', '#d0c9b1'], ['#4e6767', '#343d48', '#aba79b'],
    ['#5c6678', '#48433d', '#c9c6b3'], ['#75584a', '#303c48', '#c3b59e'],
    ['#747468', '#3b4144', '#c4bca6'], ['#47494d', '#4e5557', '#b1b8a5'],
    ['#53664e', '#354353', '#beb59e'], ['#7a6b52', '#383e45', '#b8b9ab'],
    ['#6f4d53', '#414b56', '#c4bea7'],
  ];
  function appearance(zombie, variant, kind, styleId = 'survivor') {
    if (!zombie) return { jacket: slot('jacket'), pants: slot('pants'), hair: slot('hair'), skin: '#c6987e', skinShade: '#b3816c', shirt: '#dedbd0', boots: '#76503a', style: 0, styleId };
    const outfit = clothes[variant % clothes.length], tone = ['#949a80', '#a5a38a', '#939c8c', '#a6a08b'][variant % 4];
    return { jacket: kind === 'resistant' ? '#883d35' : outfit[0], pants: outfit[1], shirt: outfit[2], skin: tone, skinShade: shade(tone, .7), hair: ['#48443a', '#696252', '#393c37', '#8b8877'][variant % 4], boots: '#3a362f', style: variant % 3 };
  }
  function collar(builder, color, y = 1.49) {
    for (const side of [-1, 1]) builder.poly([[side * .065, y + .07, .125], [side * .19, y + .02, .165], [side * .105, y - .075, .185]], color);
  }
  function addTorso(b, a, zombie, kind, variant, lod) {
    const n = lod ? 6 : 12;
    b.profile([[.96, .235, .142], [1.09, .227, .145], [1.3, .277, .158], [1.47, .309, .145], [1.54, .245, .112]], zombie ? a.jacket : a.shirt, n);
    b.profile([[1.52, .077, .071], [1.66, .07, .068]], a.skin, n);
    if (!zombie) {
      const reborn = a.styleId === 'reborn', opening = reborn ? .57 : a.styleId === 'crimson' ? .24 : .43;
      b.profile([[.955, .259, .162], [1.08, .248, .163], [1.29, .287, .176], [1.47, .325, .16], [1.535, .253, .124]], a.jacket, 14, opening, TAU - opening * 2, null, false);
      for (const side of [-1, 1]) {
        if (reborn) {
          b.poly([[side * .085, 1.535, .125], [side * .175, 1.545, .13], [side * .277, 1.4, .161], [side * .185, 1.225, .176], [side * .205, 1.395, .184]], slot('jacket', 1.45));
          b.poly([[side * .183, 1.42, .188], [side * .225, 1.49, .16], [side * .125, 1.555, .128]], slot('jacket', .7));
          b.ellipsoid([side * .187, 1.408, .191], [.01, .01, .004], '#8d938b', 6, 4);
        } else {
          b.poly([[side * .075, 1.55, .13], [side * .184, 1.52, .151], [side * .126, 1.39, .173]], slot('jacket', 1.24));
          b.poly([[side * .14, 1.34, .162], [side * .245, 1.32, .123], [side * .242, 1.255, .133], [side * .139, 1.268, .17]], slot('jacket', .77));
          b.seam([side * .143, 1.325, .17], [side * .239, 1.307, .14], slot('jacket', 1.5), .003);
        }
        b.seam([side * (reborn ? .148 : .108), .974, .153], [side * (reborn ? .185 : .125), 1.23, .181], reborn ? '#777c77' : slot('jacket', 1.4), .003);
        b.seam([side * .255, 1.05, .113], [side * .215, 1.12, .152], '#565b58', .004);
      }
      collar(b, '#e7e3d8', 1.485);
      if (a.styleId === 'crimson') {
        b.profile([[1.516, .108, .093], [1.607, .092, .081]], slot('jacket', .8), 12, .35, TAU - .7, null, false);
        b.profile([[.958, .26, .164], [.999, .257, .165]], slot('jacket', .65), 12, .24, TAU - .48, null, false);
        for (const side of [-1, 1]) b.limb([side * .16, 1.517, -.025], [side * .303, 1.475, .012], .025, .021, slot('jacket', .65), 6);
      }
      if (a.styleId === 'olive') {
        b.profile([[1.51, .096, .083], [1.567, .103, .088]], '#a99876', 12);
        b.poly([[-.078, 1.543, .089], [.081, 1.542, .091], [.025, 1.378, .184], [-.028, 1.403, .174]], '#b9aa83');
        b.seam([-.04, 1.512, .13], [.02, 1.411, .182], '#7e775c', .004);
      }
      b.seam([.014, .995, .15], [.014, 1.405, .169], '#b7b7ae', .003);
      for (const y of [1.08, 1.18, 1.28, 1.38]) b.ellipsoid([.014, y, .167], [.006, .006, .004], '#8c8c80', 6, 4);
      // Compact rounded daypack, fitted close to the back; no military frame.
      b.profile([[1.04, .12, .049, 0, -.202], [1.075, .175, .085, 0, -.215], [1.28, .18, .087, 0, -.226], [1.42, .145, .068, 0, -.214], [1.46, .095, .035, 0, -.197]], slot('backpack'), 12);
      b.profile([[1.075, .105, .018, 0, -.294], [1.11, .132, .026, 0, -.3], [1.23, .125, .025, 0, -.306], [1.25, .095, .017, 0, -.299]], slot('backpack', 1.25), 10);
      if (!reborn) {
        b.poly([[-.142, 1.404, -.263], [.142, 1.404, -.263], [.146, 1.275, -.319], [0, 1.248, -.326], [-.146, 1.275, -.319]], slot('backpack', 1.12));
        for (const side of [-1, 1]) b.limb([side * .085, 1.305, -.321], [side * .085, 1.215, -.333], .012, .012, '#6e6651', 5);
      }
      for (const side of [-1, 1]) {
        b.limb([side * .18, 1.45, -.11], [side * .225, 1.15, .13], .023, .02, slot('backpack', .7), 6);
        b.seam([side * .145, 1.4, -.271], [side * .16, 1.12, -.288], slot('backpack', 1.5), .004);
      }
      b.seam([-.11, 1.255, -.323], [.11, 1.255, -.323], '#8c8c78', .003);
    } else {
      if (a.style === 1 && kind !== 'brute') {
        // Soft hoodie neck roll and open front reveal; civilian, not body armour.
        b.profile([[1.46, .12, .1, 0, -.043], [1.52, .145, .115, 0, -.044], [1.575, .106, .091, 0, -.035]], shade(a.jacket, .7), n);
        b.poly([[-.08, 1.43, .164], [.078, 1.43, .164], [.095, 1.03, .151], [-.095, 1.03, .151]], a.shirt);
        if (!lod) for (const side of [-1, 1]) b.seam([side * .07, 1.46, .177], [side * .08, 1.27, .183], '#a09a85', .004);
      } else {
        collar(b, shade(a.jacket, 1.18));
        if (!lod) b.seam([.012, 1.04, .15], [.012, 1.45, .153], shade(a.jacket, .6), .004);
      }
      if (!lod) {
        const front = (x, y) => {
          const upper = y > 1.3, t = upper ? (y - 1.3) / .17 : (y - 1.09) / .21;
          const rx = upper ? .277 + t * .032 : .227 + t * .05, rz = upper ? .158 - t * .013 : .145 + t * .013;
          return rz * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)) + .0025;
        };
        b.patch([[-.2, 1.24], [-.12, 1.26], [-.10, 1.17], [-.19, 1.15]], shade(a.jacket, .58), front);
        b.patch([[.064, 1.075], [.17, 1.06], [.19, 1.12], [.118, 1.15]], '#59564a', front);
        b.patch([[-.2, 1.37], [-.104, 1.37], [-.105, 1.29], [-.2, 1.3]], shade(a.jacket, .8), front);
      }
      if (kind === 'resistant') {
        b.profile([[1.245, .279, .168], [1.295, .287, .169]], '#b5aa80', n);
        b.profile([[1.269, .283, .172], [1.279, .285, .172]], '#d1cdc0', n);
      }
      if (kind === 'brute') {
        b.profile([[.995, .273, .178], [1.05, .302, .193], [1.4, .328, .19], [1.49, .285, .158]], '#4d5346', n);
        for (const side of [-1, 1]) {
          b.limb([side * .205, 1.53, -.03], [side * .21, 1.33, .168], .045, .04, '#343c34', 6);
          b.poly([[side * .035, 1.35, .194], [side * .255, 1.35, .178], [side * .25, 1.17, .192], [side * .035, 1.17, .204]], '#606452');
        }
        if (!lod) b.seam([0, 1.04, .202], [0, 1.42, .193], '#97967d', .006);
      }
    }
  }
  function addHead(b, a, zombie, kind, variant, lod) {
    const forward = zombie ? .045 : 0, z = v => v + forward, n = lod ? 8 : 14;
    if (lod) {
      b.profile([[1.65, .075, .079, 0, z(.012)], [1.8, .153, .126, 0, z(.003)], [1.94, .142, .121, 0, z(-.01)], [2.005, .07, .066, 0, z(-.014)]], a.skin, 6);
      b.poly([[-.025, 1.85, z(.125)], [0, 1.78, z(.19)], [.025, 1.8, z(.127)]], a.skinShade);
      if (kind === 'brute') {
        b.profile([[1.925, .188, .168, 0, z(-.008)], [2.025, .155, .141, 0, z(-.011)], [2.091, .035, .035, 0, z(-.012)]], '#646952', 6);
        b.profile([[1.926, .204, .181, 0, z(-.004)], [1.945, .204, .181, 0, z(-.004)]], '#484e3e', 6);
      } else b.profile([[1.935, .153, .131, 0, z(-.017)], [2.008, .108, .098, 0, z(-.018)], [2.03, .012, .012, 0, z(-.021)]], a.hair, 6);
      return;
    }
    b.profile([[1.65, .065, .078, 0, z(.006)], [1.69, .105, .1, 0, z(.018)], [1.77, .146, .123, 0, z(.009)], [1.85, .16, .132, 0, z(0)], [1.94, .148, .126, 0, z(-.009)], [2.005, .094, .086, 0, z(-.014)]], a.skin, n);
    for (const side of [-1, 1]) {
      if (!lod) {
        b.ellipsoid([side * .158, 1.805, z(.001)], [.026, .046, .025], a.skin, 8, 5);
        b.ellipsoid([side * .174, 1.804, z(.013)], [.008, .024, .014], a.skinShade, 6, 4);
        if (zombie) b.poly([[side * .073, 1.8, z(.114)], [side * .127, 1.787, z(.086)], [side * .113, 1.749, z(.096)], [side * .082, 1.765, z(.118)]], a.skinShade);
      }
      // Eye whites are deliberately small and muted, never emissive beads.
      b.ellipsoid([side * .064, 1.843, z(.124)], [.038, .014, .011], zombie ? '#646e61' : '#8b6958', lod ? 6 : 8, 4);
      if (!lod) {
        b.poly([[side * .03, 1.842, z(.133)], [side * .063, 1.848, z(.139)], [side * .094, 1.842, z(.128)], [side * .064, 1.837, z(.139)]], zombie ? '#b0af94' : '#d8d4bc');
        b.ellipsoid([side * .064, 1.842, z(.141)], [.007, .007, .003], zombie ? '#4e584b' : '#536268', 6, 4);
        b.ellipsoid([side * .064, 1.842, z(.144)], [.0035, .0045, .002], '#292c27', 6, 4);
        b.seam([side * .028, 1.865, z(.131)], [side * .095, 1.867, z(.119)], zombie ? '#50584c' : '#8b7854', .0045);
      }
    }
    b.poly([[-.023, 1.827, z(.133)], [0, 1.845, z(.145)], [0, 1.776, z(.177)], [-.026, 1.778, z(.15)]], a.skinShade);
    b.poly([[0, 1.845, z(.145)], [.023, 1.827, z(.133)], [.026, 1.778, z(.15)], [0, 1.776, z(.177)]], a.skin);
    b.poly([[-.026, 1.778, z(.15)], [0, 1.776, z(.177)], [.026, 1.778, z(.15)], [0, 1.768, z(.143)]], a.skinShade);
    b.seam([-.045, 1.727, z(.12)], [0, 1.723, z(.132)], zombie ? '#646b59' : '#9f6c60', .004);
    b.seam([0, 1.723, z(.132)], [.043, 1.728, z(.12)], zombie ? '#646b59' : '#9f6c60', .004);
    if (!zombie && a.styleId === 'reborn') {
      // Cropped layered bob: open face, nape, overlapping side-swept fringe.
      b.profile([[1.74, .166, .129, 0, -.023], [1.83, .184, .15, 0, -.021], [1.95, .177, .15, 0, -.02], [2.025, .126, .11, 0, -.025], [2.067, .04, .047, 0, -.026]], slot('hair', .82), 16, .89, TAU - 1.78, null, false);
      b.profile([[1.947, .159, .139, 0, -.02], [2.023, .12, .111, 0, -.024], [2.063, .067, .061, 0, -.026], [2.078, .006, .006, 0, -.026]], slot('hair'), 16);
      for (let i = 0; i < 5; i++) {
        const shift = i * .018;
        b.ribbon([[.065 + shift * .35, 2.047 - i * .004, .076], [-.025 - shift, 2.009 - i * .013, .139], [-.126 - shift * .45, 1.94 - i * .017, .138], [-.164 - shift * .12, 1.846 - i * .017, .09]], [.027, .044, .033, .003], slot('hair', .93 + i * .06));
      }
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
        const x = side * (.14 + i * .015);
        b.ribbon([[side * .117, 2.015 - i * .013, .092 - i * .017], [x, 1.943, .11 - i * .025], [side * (.181 + i * .002), 1.84, .065 - i * .024], [side * (.159 + i * .01), 1.735 + i * .012, .045 - i * .023]], [.036, .036, .029, .003], slot('hair', .92 + i * .1));
      }
      for (let i = 0; i < 9; i++) {
        const angle = Math.PI + (i - 4) * .22, points = [[2.026, .126, .115], [1.94, .179, .155], [1.825, .186, .155], [1.725 + (i % 3) * .008, .167, .135]].map(r => [Math.sin(angle) * r[1], r[0], -.022 + Math.cos(angle) * r[2]]);
        b.ribbon(points, [.014, .025, .023, .002], slot('hair', .92 + (i % 3) * .09), true);
      }
    } else if (!zombie) {
      const high = a.styleId === 'crimson', braid = a.styleId === 'olive';
      b.profile([[1.825, .147, .117, 0, -.022], [1.944, .166, .145, 0, -.022], [2.015, .119, .104, 0, -.024], [2.047, .025, .027, 0, -.025]], slot('hair', .85), 14, .98, TAU - 1.96, null, false);
      b.profile([[1.958, .153, .131, 0, -.022], [2.015, .117, .104, 0, -.024], [2.054, .048, .048, 0, -.024], [2.06, .004, .004, 0, -.024]], slot('hair'), 14);
      for (let i = 0; i < 4; i++) b.ribbon([[.075, 2.026 - i * .006, .095], [-.035 - i * .024, 1.985 - i * .011, .135], [-.14 - i * .007, 1.904 - i * .012, .093]], [.027, .043, .004], slot('hair', .94 + i * .09));
      if (braid) {
        for (let i = 0; i < 7; i++) b.ellipsoid([.135 + (i % 2 ? .012 : -.008), 1.78 - i * .043, -.102 + i * .012], [.039 - i * .0025, .039, .033 - i * .002], slot('hair', i % 2 ? 1.08 : .83), 8, 5);
        b.ellipsoid([.145, 1.502, -.021], [.027, .012, .025], '#656b4c', 8, 4);
      } else {
        b.profile([[high ? 1.55 : 1.57, .012, .025, .018, -.222], [1.64, .043, .061, .014, -.243], [1.77, .059, .073, 0, -.24], [high ? 1.925 : 1.86, .044, .047, 0, -.173]], slot('hair', .9), 10);
        b.ellipsoid([0, high ? 1.925 : 1.864, -.163], [.045, .026, .036], high ? '#3c3031' : '#696555', 8, 5);
        b.seam([-.025, 1.79, -.298], [.008, 1.615, -.267], slot('hair', 1.3), .004);
      }
    } else if (kind === 'brute') {
      b.profile([[1.925, .182, .163, 0, z(-.008)], [2.002, .176, .157, 0, z(-.011)], [2.069, .126, .113, 0, z(-.012)], [2.091, .025, .025, 0, z(-.012)]], '#646952', n);
      b.profile([[1.928, .203, .18, 0, z(-.004)], [1.946, .204, .18, 0, z(-.004)]], '#484e3e', n);
      if (!lod) b.seam([0, 2.086, z(.018)], [0, 2.009, z(.146)], '#919177', .009);
    } else {
      b.profile([[1.935, .152, .13, 0, z(-.017)], [1.998, .115, .105, 0, z(-.018)], [2.025, .05, .05, 0, z(-.021)], [2.03, .004, .004, 0, z(-.021)]], a.hair, n);
      if (!lod) {
        b.poly([[-.133, 1.918, z(.067)], [-.12, 1.79, z(.07)], [-.092, 1.823, z(.1)], [-.075, 1.944, z(.114)]], shade(a.hair, .82));
        b.seam([-.099, 1.765, z(.123)], [-.081, 1.728, z(.122)], '#68715f', .004);
        b.poly([[.099, 1.914, z(.093)], [.136, 1.923, z(.06)], [.13, 1.884, z(.086)]], a.skinShade);
      }
    }
  }
  function addHips(b, a, zombie, lod) {
    b.profile([[.785, .225, .123], [.86, .265, .153], [.965, .235, .145]], a.pants, lod ? 6 : 12);
    b.profile([[.945, .238, .149], [.979, .233, .146]], zombie ? '#49483a' : '#64513b', lod ? 6 : 12);
    if (!lod) {
      b.poly([[-.03, .95, .152], [.03, .95, .152], [.03, .977, .148], [-.03, .977, .148]], '#9d987e');
      for (const side of [-1, 1]) {
        b.seam([side * .135, .928, .13], [side * .218, .866, .109], zombie ? '#61645a' : slot('pants', 1.4), .004);
        b.poly([[side * .08, .92, -.145], [side * .216, .905, -.116], [side * .207, .837, -.119], [side * .12, .823, -.14]], zombie ? shade(a.pants, .8) : slot('pants', .8));
      }
    }
  }
  function addThigh(b, a, side, zombie, variant, lod) {
    const n = lod ? 5 : 10;
    b.profile(lod ? [[-.419, .087, .092, side * .009, .006], [-.15, .123, .124], [0, .12, .119]] : [[-.419, .087, .092, side * .009, .006], [-.32, .105, .113], [-.12, .126, .125], [0, .12, .119]], a.pants, n);
    if (!lod) {
      b.seam([side * .119, -.08, .018], [side * .092, -.38, .021], zombie ? shade(a.pants, .75) : slot('pants', 1.35), .003);
      if (zombie && side < 0) b.poly([[-.086, -.25, .086], [.01, -.27, .115], [.037, -.335, .109], [-.074, -.342, .078]], '#666759');

    }
  }
  function addShin(b, a, side, zombie, lod) {
    const n = lod ? 5 : 10;
    b.profile(lod ? [[-.287, .089, .089, 0, -.006], [-.14, .087, .096], [.015, .088, .095]] : [[-.287, .089, .089, 0, -.006], [-.21, .084, .09, 0, -.01], [-.08, .091, .102], [.015, .088, .095]], a.pants, n);
    if (!lod) {
      b.profile([[-.284, .092, .092, 0, -.005], [-.258, .091, .093, 0, -.005]], zombie ? '#6a6959' : slot('pants', 1.25), n);
      b.seam([side * .086, -.045, .021], [side * .084, -.25, .018], zombie ? shade(a.pants, .7) : slot('pants', 1.3), .003);
    }
    // The foot is a shaped last: broad round toe, narrow ankle and dark outsole.
    b.profile(lod ? [[-.45, .088, .151, 0, .049], [-.385, .106, .179, 0, .059], [-.242, .068, .072, 0, -.012]] : [[-.45, .088, .151, 0, .049], [-.421, .106, .183, 0, .059], [-.368, .103, .171, 0, .058], [-.33, .075, .106, 0, .015], [-.242, .068, .072, 0, -.012]], a.boots, n);
    b.profile([[-.457, .095, .167, 0, .054], [-.432, .109, .186, 0, .058]], '#292c28', n);
    if (!lod && !zombie) {
      b.seam([-.075, -.381, .145], [.075, -.381, .145], '#9b7651', .004);
      b.poly([[side * .071, -.267, .022], [side * .077, -.332, .033], [side * .068, -.354, -.024], [side * .066, -.265, -.035]], '#3d3730');
    }
  }
  function addArm(b, a, side, zombie, lod) {
    const n = lod ? 7 : 10;
    if (lod) {
      if (a.style === 0) {
        b.profile([[-.245, .08, .07, side * .022, .015], [0, .104, .09]], a.jacket, 6);
        b.profile([[-.46, .054, .047, side * .005, .045], [-.245, .079, .069, side * .022, .015]], a.skin, 6);
      } else b.profile([[-.46, .054, .047, side * .005, .045], [-.245, .083, .072, side * .022, .015], [0, .104, .09]], a.jacket, 6);
      b.ellipsoid([side * .002, -.507, .058], [.059, .084, .043], a.skin, 6, 3);
      return;
    }
    if (zombie) {
      const sleeve = a.style === 0;
      b.limb([0, 0, 0], [side * .022, -.244, .015], .104, .082, a.jacket, n);
      b.limb([side * .022, -.244, .015], [side * .005, -.457, .046], .081, .054, sleeve ? a.skin : a.jacket, n);
      b.ellipsoid([side * .002, -.507, .058], [.059, .084, .043], a.skin, n, lod ? 4 : 6);
      if (!lod) {
        b.ellipsoid([-side * .05, -.492, .084], [.021, .042, .025], a.skinShade, 6, 4);
        b.poly([[side * .071, -.09, .053], [side * .09, -.14, .043], [side * .061, -.2, .057], [side * .03, -.17, .078]], shade(a.jacket, .68));
      }
    } else {
      const elbow = side < 0 ? [0, -.19, .23] : [-.19, -.22, .24];
      const hand = side < 0 ? [0, -.02, .56] : [-.66, -.045, .55];
      const direction = new THREE.Vector3(...hand).sub(new THREE.Vector3(...elbow)).normalize();
      const cuff = new THREE.Vector3(...hand).addScaledVector(direction, -.064).toArray();
      b.limb([0, 0, 0], elbow, .106, .084, a.jacket, n);
      b.ellipsoid(elbow, [.087, .082, .083], slot('jacket', .85), n, 5);
      if (a.styleId === 'olive') {
        const roll = new THREE.Vector3(...elbow).lerp(new THREE.Vector3(...cuff), .36);
        b.limb(elbow, roll.toArray(), .081, .074, a.jacket, n);
        b.limb(roll.toArray(), cuff, .065, .047, a.skin, n);
        b.limb(roll.clone().addScaledVector(direction, -.038).toArray(), roll.toArray(), .083, .083, slot('jacket', 1.45), n);
      } else {
        b.limb(elbow, cuff, .081, .057, a.jacket, n);
        b.limb(new THREE.Vector3(...cuff).addScaledVector(direction, -.029).toArray(), cuff, .06, .061, slot('jacket', a.styleId === 'crimson' ? .65 : 1.3), n);
      }
      b.ellipsoid(hand, [.055, .055, .079], a.skin, n, 6);
      b.ellipsoid([hand[0] - side * .047, hand[1] + .015, hand[2] - .02], [.023, .038, .043], a.skinShade, 8, 5);
      b.seam([-.03, -.007, .061], [elbow[0] - .028, elbow[1] + .015, elbow[2] + .043], slot('jacket', 1.5), .003);
    }
  }
  function buildData(zombie, variant, kind, lod = false, styleId = 'survivor') {
    const a = appearance(zombie, variant, kind, styleId), parts = [];
    function part(name, origin, draw, extra = {}) { const builder = new Builder(origin); draw(builder); parts.push({ name, origin, ...builder.finish(), ...extra }); }
    part('torso', [0, 1.25, 0], b => addTorso(b, a, zombie, kind, variant, lod));
    part('hips', [0, .88, 0], b => addHips(b, a, zombie, lod));
    part('head', [0, 1.8, zombie ? .045 : 0], b => addHead(b, a, zombie, kind, variant, lod));
    for (let index = 0; index < 2; index++) {
      const side = index === 0 ? -1 : 1;
      part('thigh' + index, [0, 0, 0], b => addThigh(b, a, side, zombie, variant, lod), { pivot: [side * .155, .88, 0], index });
      part('shin' + index, [0, 0, 0], b => addShin(b, a, side, zombie, lod), { pivot: [0, -.419, 0], index });
      // Keep the legacy ±.40 pivots even on NPCs. Their sleeve surface sits
      // slightly inward so the visible civilian shoulders fit the combat AABB.
      part('arm' + index, [zombie ? side * .065 : 0, 0, 0], b => addArm(b, a, side, zombie, lod), { pivot: [side * .4, 1.49, 0], index });
    }
    return parts;
  }
  function makeFar(parts) {
    const positions = [], colors = [], normals = [];
    for (const p of parts) {
      const geometry = p.geometry.toNonIndexed();
      const matrix = new THREE.Matrix4();
      if (p.name.startsWith('thigh')) matrix.makeTranslation(...p.pivot);
      else if (p.name.startsWith('shin')) matrix.makeTranslation(p.index ? .155 : -.155, .88 - .419, 0);
      else if (p.name.startsWith('arm')) matrix.compose(new THREE.Vector3(...p.pivot), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -.57), new THREE.Vector3(1, 1, 1));
      else matrix.makeTranslation(...p.origin);
      geometry.applyMatrix4(matrix);
      positions.push(...geometry.attributes.position.array); normals.push(...geometry.attributes.normal.array); colors.push(...geometry.attributes.color.array);
      geometry.dispose(); p.geometry.dispose();
      stats.geometries--; // Far-build segment buffers are temporary, never retained/uploaded.
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere(); stats.geometries++;
    return geometry;
  }
  function createBody(zombie = false, variant = 0, kind = 'shambler') {
    variant = ((Math.trunc(Number(variant) || 0) % 36) + 36) % 36;
    if (!['shambler', 'runner', 'resistant', 'brute'].includes(kind)) kind = 'shambler';
    const key = zombie ? `${kind}:${variant}` : 'hero';
    if (!cache.has(key)) {
      if (zombie) cache.set(key, { parts: buildData(true, variant, kind), far: makeFar(buildData(true, variant, kind, true)) });
      else {
        const styles = Object.fromEntries(Object.keys(heroStyles).map(id => [id, buildData(false, 0, 'shambler', false, id)]));
        cache.set(key, { parts: styles.survivor, styles, far: null });
      }
      if (zombie) stats.npcArchetypes++;
    }
    const data = cache.get(key), group = new THREE.Group(); group.name = zombie ? `civilian-${kind}-${variant}` : 'civilian-survivor';
    const upper = zombie ? null : new THREE.Group();
    if (upper) { upper.position.y = 1.05; upper.name = 'camera-pitch-upper'; group.add(upper); }
    const character = { group, torso: null, hips: null, head: null, legs: [], knees: [], arms: [], upper, details: [], distant: null,
      rig: { zombie: !!zombie, variant, kind, paletteParts: [], styleSets: {}, meshes: {}, movingBlend: 0, phaseOffset: zombie ? hash(variant + 71) * TAU : 0 },
      metadata: { source: 'original-procedural', front: '+z', nearMeshes: 9, farDraws: zombie ? 1 : 0, height: kind === 'brute' && zombie ? 2.091 : zombie ? 2.03 : 2.078, paletteSlots: ['jacket', 'pants', 'hair', 'backpack'] } };
    if (!zombie) for (const [id, templates] of Object.entries(data.styles)) {
      character.rig.styleSets[id] = templates.map(part => {
        stats.geometries++;
        return { name: part.name, geometry: part.geometry.clone(), slots: part.slots, shades: part.shades };
      });
    }
    for (const part of data.parts) {
      const geometry = zombie ? part.geometry : character.rig.styleSets.survivor.find(p => p.name === part.name).geometry;
      const mesh = new THREE.Mesh(geometry, material); mesh.name = part.name; mesh.castShadow = true; mesh.receiveShadow = true;
      character.rig.meshes[part.name] = mesh;
      if (part.name.startsWith('thigh')) {
        const pivot = new THREE.Group(); pivot.position.set(...part.pivot); pivot.add(mesh); group.add(pivot); character.legs[part.index] = pivot;
      } else if (part.name.startsWith('shin')) {
        const pivot = new THREE.Group(); pivot.position.set(...part.pivot); pivot.add(mesh); character.legs[part.index].add(pivot); character.knees[part.index] = pivot;
      } else if (part.name.startsWith('arm')) {
        const pivot = new THREE.Group(); pivot.position.set(...part.pivot); if (upper) pivot.position.y -= 1.05; pivot.add(mesh); (upper || group).add(pivot);
        if (zombie) pivot.rotation.x = -.2; character.arms[part.index] = pivot;
      } else {
        mesh.position.set(...part.origin);
        const parent = part.name === 'hips' ? group : upper || group;
        if (parent === upper) mesh.position.y -= 1.05;
        parent.add(mesh); character[part.name] = mesh;
      }
    }
    character.details = [...group.children];
    if (zombie) { character.distant = new THREE.Mesh(data.far, material); character.distant.name = 'single-draw-distant'; character.distant.visible = false; character.distant.castShadow = true; group.add(character.distant); }
    else { stats.heroInstances++; applyPalette(character, { id: 'survivor', ...heroStyles.survivor }); }
    return character;
  }
  function applyPalette(character, skin = {}) {
    if (!character?.rig || character.rig.zombie) return;
    const id = Object.prototype.hasOwnProperty.call(heroStyles, skin.id) ? skin.id : character.rig.styleId || 'survivor';
    const values = colorNames.map(k => skin[k] ?? heroStyles[id][k]), key = id + '|' + values.join('|');
    if (key === character.rig.paletteKey) return;
    character.rig.paletteParts = character.rig.styleSets[id];
    for (const part of character.rig.paletteParts) character.rig.meshes[part.name].geometry = part.geometry;
    const colors = values.map(v => new THREE.Color(v));
    for (const part of character.rig.paletteParts) {
      const attribute = part.geometry.attributes.color, array = attribute.array;
      for (let i = 0; i < part.slots.length; i++) {
        const s = part.slots[i]; if (!s) continue;
        const c = colors[s - 1], amount = part.shades[i], j = i * 3;
        array[j] = c.r * amount; array[j + 1] = c.g * amount; array[j + 2] = c.b * amount;
      }
      attribute.needsUpdate = true;
    }
    character.rig.paletteKey = key;
    character.rig.styleId = id;
    character.metadata.styleId = id;
    character.metadata.hairstyle = heroStyles[id].hairstyle;
    character.metadata.outfit = heroStyles[id].outfit;
  }
  /** Deterministic pose only. Root, upper-body pitch, aim arms, torso sway are caller-owned. */
  function animate(character, { phase = 0, moving = false, dt = 0, snap = false } = {}) {
    if (!character?.rig) return;
    if (snap && !moving) {
      character.rig.movingBlend = 0;
      for (const leg of character.legs) leg.rotation.set(0, 0, 0);
      for (const knee of character.knees) knee.rotation.set(0, 0, 0);
      character.head.rotation.set(0, 0, 0);
      return;
    }
    const rig = character.rig, step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, .1)) : 0;
    const blend = 1 - Math.exp(-step * 13), target = moving ? 1 : 0;
    rig.movingBlend = snap ? target : rig.movingBlend + (target - rig.movingBlend) * blend;
    if (rig.movingBlend < .00001) rig.movingBlend = 0;
    const p = (Number.isFinite(phase) ? phase : 0), weight = rig.movingBlend, amplitude = rig.zombie ? .33 : .39;
    for (let i = 0; i < 2; i++) {
      const t = p + i * Math.PI, swing = Math.sin(t);
      character.legs[i].rotation.x = swing * amplitude * weight;
      character.legs[i].rotation.z = (i ? -1 : 1) * .012 * weight;
      character.knees[i].rotation.x = Math.max(0, -swing) * .52 * weight;
    }
    // Only a very small neck yaw/roll; never modify its parent camera-pitch pivot.
    const idle = Math.sin(p * .31 + rig.phaseOffset);
    character.head.rotation.y = idle * (rig.zombie ? .026 : .012) * weight;
    character.head.rotation.z = idle * (rig.zombie ? .018 : .008) * weight;
  }
  return { createBody, applyPalette, animate, getResourceStats: () => ({ ...stats, cachedArchetypes: cache.size, sharedMaterials: 1 }) };
}

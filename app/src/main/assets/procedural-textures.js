/**
 * Procedural surface textures — generated on a canvas, never fetched.
 *
 * Every set returns three maps that share one UV layout:
 *   map          albedo (sRGB)
 *   bumpMap      height, used as a cheap normal substitute (no tangent space)
 *   roughnessMap roughness variation, so a wet patch and a dry patch of the
 *                same asphalt do not answer the light identically
 *
 * `bumpMap` is deliberately chosen over `normalMap`: a normal map needs
 * per-vertex tangents, which the instanced box geometry does not carry, and
 * generating them for 1 200 instances costs more than the visual gain. A bump
 * map works from the height alone and reads correctly on flat facades.
 *
 * All noise is deterministic (local LCG), so two runs produce identical
 * textures and the harness can compare screenshots.
 */

/** Small deterministic PRNG. Never touches the game's own RNG stream. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Value noise: a coarse grid, bilinearly interpolated, summed over octaves. */
function valueNoise(size, cells, random) {
  const grid = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = random();
  const out = new Float32Array(size * size);
  const step = cells / size;
  for (let y = 0; y < size; y++) {
    const gy = y * step, y0 = Math.floor(gy), fy = gy - y0;
    const sy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < size; x++) {
      const gx = x * step, x0 = Math.floor(gx), fx = gx - x0;
      const sx = fx * fx * (3 - 2 * fx);
      const a = grid[y0 * (cells + 1) + x0];
      const b = grid[y0 * (cells + 1) + x0 + 1];
      const c = grid[(y0 + 1) * (cells + 1) + x0];
      const d = grid[(y0 + 1) * (cells + 1) + x0 + 1];
      out[y * size + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return out;
}

/** Sums octaves of value noise into a 0..1 field. */
function fbm(size, octaves, random) {
  const out = new Float32Array(size * size);
  let amplitude = 1, total = 0, cells = 4;
  for (let o = 0; o < octaves; o++) {
    const layer = valueNoise(size, cells, random);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amplitude;
    total += amplitude;
    amplitude *= .5;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Writes a 0..1 field into a canvas as greyscale, with an optional curve. */
function fieldToCanvas(size, field, curve = v => v) {
  const c = canvas(size), ctx = c.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < field.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(curve(field[i]) * 255)));
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return c;
}

/** Paints cracks: a random walk that forks, drawn as a dark hairline. */
function cracks(ctx, size, random, { count = 9, width = 1.4, color = 'rgba(12,14,16,.72)' } = {}) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = random() * size, y = random() * size;
    let angle = random() * Math.PI * 2;
    ctx.lineWidth = width * (.6 + random() * .9);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 12 + Math.floor(random() * 26);
    for (let s = 0; s < steps; s++) {
      angle += (random() - .5) * .9;
      x += Math.cos(angle) * (2 + random() * 5);
      y += Math.sin(angle) * (2 + random() * 5);
      ctx.lineTo(x, y);
      // A fork every few steps keeps the crack from reading as a scribble.
      if (random() < .12) {
        const forkAngle = angle + (random() - .5) * 2.2;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(forkAngle) * (4 + random() * 9), y + Math.sin(forkAngle) * (4 + random() * 9));
        ctx.moveTo(x, y);
      }
    }
    ctx.stroke();
  }
}

/** Scattered specks: gravel, rust pitting, plaster grit. */
function specks(ctx, size, random, { count = 2600, min = 1, max = 3, colors = ['rgba(0,0,0,.16)'] } = {}) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    const s = min + random() * (max - min);
    ctx.fillRect(random() * size, random() * size, s, s);
  }
}

const PAINTERS = {
  /** Cracked, patched asphalt with tar seams and a wet sheen in the low spots. */
  asphalt(size, random) {
    const base = fbm(size, 5, random);
    const albedo = canvas(size), ctx = albedo.getContext('2d');
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < base.length; i++) {
      const v = base[i];
      // Dark aggregate with lighter worn patches where tyres have polished it.
      const tone = 34 + v * 30;
      image.data[i * 4] = tone * .92;
      image.data[i * 4 + 1] = tone * .98;
      image.data[i * 4 + 2] = tone * 1.06;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    specks(ctx, size, random, {
      count: 4200, min: 1, max: 2.6,
      colors: ['rgba(150,155,158,.20)', 'rgba(8,10,12,.30)', 'rgba(96,102,104,.16)'],
    });
    // Tar repair seams: long, slightly wavy, darker than the road.
    ctx.strokeStyle = 'rgba(14,16,18,.55)';
    for (let i = 0; i < 3; i++) {
      ctx.lineWidth = 3 + random() * 4;
      ctx.beginPath();
      const y0 = random() * size;
      ctx.moveTo(0, y0);
      for (let x = 0; x <= size; x += size / 8) ctx.lineTo(x, y0 + Math.sin(x * .05 + i) * 6);
      ctx.stroke();
    }
    cracks(ctx, size, random, { count: 11, width: 1.5 });
    const height = fbm(size, 4, random);
    return {
      map: albedo,
      bump: fieldToCanvas(size, height, v => .35 + v * .5),
      roughness: fieldToCanvas(size, base, v => .52 + v * .34),
    };
  },

  /** Poured concrete: form-board lines, aggregate, chipped corners. */
  concrete(size, random) {
    const base = fbm(size, 5, random);
    const albedo = canvas(size), ctx = albedo.getContext('2d');
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < base.length; i++) {
      const v = base[i], tone = 96 + v * 46;
      image.data[i * 4] = tone;
      image.data[i * 4 + 1] = tone * .99;
      image.data[i * 4 + 2] = tone * .95;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    specks(ctx, size, random, {
      count: 3000, min: 1, max: 2.2,
      colors: ['rgba(60,62,58,.22)', 'rgba(190,190,182,.18)'],
    });
    // Form-board seams every quarter of the tile.
    ctx.strokeStyle = 'rgba(58,60,56,.30)';
    ctx.lineWidth = 1.6;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(0, i * size / 4); ctx.lineTo(size, i * size / 4); ctx.stroke();
    }
    // Water staining running down from the top edge.
    for (let i = 0; i < 7; i++) {
      const x = random() * size, w = 4 + random() * 22;
      const g = ctx.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, 'rgba(48,52,48,.20)');
      g.addColorStop(1, 'rgba(48,52,48,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, w, size * (.4 + random() * .6));
    }
    cracks(ctx, size, random, { count: 5, width: 1.1, color: 'rgba(40,42,40,.5)' });
    const height = fbm(size, 4, random);
    return {
      map: albedo,
      bump: fieldToCanvas(size, height, v => .4 + v * .45),
      roughness: fieldToCanvas(size, base, v => .78 + v * .2),
    };
  },

  /** Brick courses with mortar, spalled faces and soot. */
  brick(size, random) {
    const albedo = canvas(size), ctx = albedo.getContext('2d');
    ctx.fillStyle = '#6d6a60';
    ctx.fillRect(0, 0, size, size);
    const rows = 12, brickH = size / rows, brickW = size / 5;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * brickW * .5;
      for (let c = -1; c < 6; c++) {
        const x = c * brickW + offset + 2, y = r * brickH + 2;
        const w = brickW - 4, h = brickH - 4;
        // Each brick gets its own fired tone; a few are spalled to the core.
        const t = random();
        const r0 = 96 + t * 46, g0 = 62 + t * 30, b0 = 52 + t * 24;
        ctx.fillStyle = `rgb(${r0 | 0},${g0 | 0},${b0 | 0})`;
        ctx.fillRect(x, y, w, h);
        if (random() < .12) {
          ctx.fillStyle = 'rgba(58,50,44,.55)';
          ctx.fillRect(x + random() * w * .5, y + random() * h * .5, w * .3, h * .4);
        }
        // A soft top highlight reads as a chamfered edge under raking light.
        ctx.fillStyle = 'rgba(255,240,220,.07)';
        ctx.fillRect(x, y, w, 1.5);
      }
    }
    specks(ctx, size, random, {
      count: 2400, min: 1, max: 2,
      colors: ['rgba(30,26,22,.22)', 'rgba(200,190,170,.10)'],
    });
    // Soot wash from the top, as if a fire passed above.
    const soot = ctx.createLinearGradient(0, 0, 0, size * .55);
    soot.addColorStop(0, 'rgba(18,18,18,.42)');
    soot.addColorStop(1, 'rgba(18,18,18,0)');
    ctx.fillStyle = soot;
    ctx.fillRect(0, 0, size, size * .55);
    const height = fbm(size, 3, random);
    return {
      map: albedo,
      bump: fieldToCanvas(size, height, v => .3 + v * .6),
      roughness: fieldToCanvas(size, height, v => .72 + v * .24),
    };
  },

  /** Oxidised steel: pitted plate, flaking paint, rust blooms. */
  rust(size, random) {
    const base = fbm(size, 5, random);
    const albedo = canvas(size), ctx = albedo.getContext('2d');
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < base.length; i++) {
      const v = base[i];
      // Blend from cold steel to orange oxide by the noise value.
      const rustAmount = Math.max(0, Math.min(1, (v - .42) * 2.6));
      const steel = 58 + v * 26;
      image.data[i * 4] = steel + rustAmount * 96;
      image.data[i * 4 + 1] = steel + rustAmount * 40;
      image.data[i * 4 + 2] = steel + rustAmount * 6;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    specks(ctx, size, random, {
      count: 3600, min: 1, max: 3.4,
      colors: ['rgba(122,58,24,.34)', 'rgba(38,34,30,.30)', 'rgba(168,96,44,.22)'],
    });
    // Rivet line down one edge, as on a container or a hull plate.
    ctx.fillStyle = 'rgba(24,22,20,.5)';
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(size * .08, size * (.08 + i * .105), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    const height = fbm(size, 4, random);
    return {
      map: albedo,
      bump: fieldToCanvas(size, height, v => .35 + v * .55),
      roughness: fieldToCanvas(size, base, v => .42 + v * .5),
    };
  },

  /** Weathered timber: grain, knots, split ends. */
  wood(size, random) {
    const albedo = canvas(size), ctx = albedo.getContext('2d');
    const grain = fbm(size, 4, random);
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        // Grain runs along X: stretch the noise vertically into long fibres.
        const fibre = Math.sin((y * .55 + grain[i] * 9) * 1.1) * .5 + .5;
        const tone = 74 + fibre * 34 + grain[i] * 18;
        image.data[i * 4] = tone * 1.06;
        image.data[i * 4 + 1] = tone * .88;
        image.data[i * 4 + 2] = tone * .66;
        image.data[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    // Knots: concentric rings around a dark core.
    for (let k = 0; k < 3; k++) {
      const cx = random() * size, cy = random() * size, r = 5 + random() * 9;
      for (let ring = 4; ring >= 1; ring--) {
        ctx.strokeStyle = `rgba(52,38,26,${.10 + ring * .05})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * ring * .5, r * ring * .28, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,28,18,.6)';
      ctx.beginPath(); ctx.ellipse(cx, cy, r * .3, r * .18, 0, 0, Math.PI * 2); ctx.fill();
    }
    const height = fbm(size, 3, random);
    return {
      map: albedo,
      bump: fieldToCanvas(size, height, v => .4 + v * .4),
      roughness: fieldToCanvas(size, grain, v => .74 + v * .22),
    };
  },

  /** Painted plaster over masonry: peeling patches exposing the wall beneath. */
  plaster(size, random) {
    const base = fbm(size, 5, random);
    const albedo = canvas(size), ctx = albedo.getContext('2d');
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < base.length; i++) {
      const v = base[i], tone = 118 + v * 40;
      image.data[i * 4] = tone;
      image.data[i * 4 + 1] = tone * .97;
      image.data[i * 4 + 2] = tone * .88;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    // Peeling: irregular blobs where the render has fallen away.
    for (let i = 0; i < 14; i++) {
      const cx = random() * size, cy = random() * size, r = 8 + random() * 30;
      ctx.fillStyle = `rgba(${70 + random() * 20 | 0},${64 + random() * 16 | 0},${56 + random() * 14 | 0},.55)`;
      ctx.beginPath();
      const points = 9;
      for (let p = 0; p <= points; p++) {
        const a = p / points * Math.PI * 2;
        const rr = r * (.6 + random() * .6);
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (p === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
    specks(ctx, size, random, {
      count: 1800, min: 1, max: 2,
      colors: ['rgba(60,56,48,.20)', 'rgba(220,214,198,.14)'],
    });
    const height = fbm(size, 4, random);
    return {
      map: albedo,
      bump: fieldToCanvas(size, height, v => .42 + v * .4),
      roughness: fieldToCanvas(size, base, v => .8 + v * .18),
    };
  },
};

/**
 * Builds one texture set.
 *
 * @param {object} THREE
 * @param {string} kind  one of the PAINTERS keys
 * @param {object} [options]
 * @param {number} [options.size=256]     canvas resolution
 * @param {number} [options.repeat=1]     UV tiling
 * @param {number} [options.anisotropy=2]
 * @returns {{map:THREE.Texture, bumpMap:THREE.Texture, roughnessMap:THREE.Texture}}
 */
export function createTextureSet(THREE, kind, { size = 256, repeat = 1, anisotropy = 2 } = {}) {
  const painter = PAINTERS[kind];
  if (!painter) throw new Error(`Unknown procedural texture: ${kind}`);
  // A fixed per-kind seed keeps every run identical.
  const seed = [...kind].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);
  const random = rng(seed);
  const painted = painter(size, random);

  const wrap = (source, colorSpace) => {
    const texture = new THREE.CanvasTexture(source);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = anisotropy;
    if (colorSpace) texture.colorSpace = colorSpace;
    return texture;
  };

  return {
    map: wrap(painted.map, THREE.SRGBColorSpace),
    bumpMap: wrap(painted.bump, null),
    roughnessMap: wrap(painted.roughness, null),
  };
}

/**
 * A material that uses a full texture set. `bumpScale` is in world-ish units;
 * 0.02 is a subtle grain, 0.08 reads as deep pitting.
 */
export function texturedMaterial(THREE, kind, {
  color = '#ffffff', repeat = 1, size = 256, bumpScale = .03,
  roughness = 1, metalness = .04, extra = {},
} = {}) {
  const set = createTextureSet(THREE, kind, { size, repeat });
  return new THREE.MeshStandardMaterial({
    color,
    map: set.map,
    bumpMap: set.bumpMap,
    bumpScale,
    roughnessMap: set.roughnessMap,
    roughness,
    metalness,
    ...extra,
  });
}

/** The kinds this module can paint, for the settings UI and the tests. */
export const TEXTURE_KINDS = Object.freeze(Object.keys(PAINTERS));

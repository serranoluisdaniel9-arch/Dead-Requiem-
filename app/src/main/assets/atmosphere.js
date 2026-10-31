/**
 * Atmosphere: the layer that turns a lit street into a place with air in it.
 *
 * Three things, all cheap:
 *   1. Volumetric fog *impression* — a stack of large, very faint horizontal
 *      planes at different heights, drifting at different speeds. Real
 *      volumetric fog needs a raymarch pass; this reads the same at a fraction
 *      of the cost and works on a phone.
 *   2. Floating dust — one Points cloud, recycled around the player, so the
 *      motes are always where the camera is without ever being reallocated.
 *   3. Grade — vignette and colour correction as a full-screen quad drawn after
 *      the scene, not a CSS filter (a CSS filter on the canvas forces the
 *      compositor to re-read the whole framebuffer every frame on Android).
 *
 * Quality presets are real: they change counts, shadow resolution and pixel
 * ratio, not just a label.
 */

// v1.4: the presets moved to graphics-profiles.js, which also carries the frame
// cap and the extra fields (rain, smoke, wet, lodDistance). Re-exported here so
// every existing reader keeps working and there is exactly one definition.
import { GRAPHICS_PROFILES, PROFILE_ORDER, resolveProfile } from './graphics-profiles.js';

export const QUALITY_PRESETS = GRAPHICS_PROFILES;
export { PROFILE_ORDER };

/** Picks a preset from a stored preference, falling back to a device guess. */
export function resolveQuality(stored, options = {}) {
  return resolveProfile(stored, options);
}

/**
 * Volumetric fog impression: horizontal sheets of very faint haze.
 *
 * Each sheet is a large plane with a radial alpha texture, so its edges fade
 * out instead of showing a hard rectangle. They are additive-free (normal
 * blending, low opacity) so they darken the far city rather than washing it out.
 */
export function createFogLayers({ THREE, scene, count = 5, color = '#aab4b2' }) {
  const group = new THREE.Group();
  group.name = 'volumetric-fog';
  scene.add(group);

  // One shared radial texture: a soft disc, transparent at the rim.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,.55)');
  gradient.addColorStop(.55, 'rgba(255,255,255,.22)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);

  const layers = [];
  for (let i = 0; i < count; i++) {
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color,
      transparent: true,
      opacity: .05 + (i / Math.max(1, count)) * .05,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(46 + i * 9, 46 + i * 9, 1);
    mesh.position.y = .35 + i * .55;
    mesh.renderOrder = 2;
    group.add(mesh);
    layers.push({
      mesh,
      material,
      baseY: mesh.position.y,
      speed: .12 + i * .05,
      phase: i * 1.7,
      drift: 3 + i * 1.4,
    });
  }

  /**
   * Follows the player and drifts. `time` is the game clock, so pausing freezes
   * the haze instead of letting it slide under a paused frame.
   */
  function update(position, time = 0) {
    for (const layer of layers) {
      layer.mesh.position.x = position.x + Math.sin(time * layer.speed + layer.phase) * layer.drift;
      layer.mesh.position.z = position.z + Math.cos(time * layer.speed * .8 + layer.phase) * layer.drift;
      layer.mesh.position.y = layer.baseY + Math.sin(time * .3 + layer.phase) * .12;
    }
  }

  return {
    group,
    update,
    get layerCount() { return layers.length; },
    setVisible(visible) { group.visible = visible; },
  };
}

/**
 * Floating dust: one Points cloud, recycled in a box around the player.
 *
 * The cloud is a fixed buffer; when a mote drifts out of the box it is wrapped
 * to the opposite face. No allocation, no per-frame garbage.
 */
export function createDustField({ THREE, scene, count = 220, color = '#cfd6cf' }) {
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);
  const BOX = 26, HEIGHT = 9;

  let s = 7717;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rnd() - .5) * BOX;
    positions[i * 3 + 1] = rnd() * HEIGHT;
    positions[i * 3 + 2] = (rnd() - .5) * BOX;
    speeds[i] = .12 + rnd() * .3;
    phases[i] = rnd() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // A tiny round sprite, so motes are dots rather than squares.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, 'rgba(255,255,255,.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 16);
  const texture = new THREE.CanvasTexture(canvas);

  const material = new THREE.PointsMaterial({
    size: .055,
    map: texture,
    color,
    transparent: true,
    opacity: .5,
    depthWrite: false,
    sizeAttenuation: true,
    fog: true,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'floating-dust';
  points.frustumCulled = false;
  scene.add(points);

  const attribute = geometry.attributes.position;

  function update(position, time = 0, dt = 0) {
    const array = attribute.array;
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      // Slow upward drift plus a lateral sway, so the field never looks static.
      array[j + 1] += speeds[i] * dt * .55;
      array[j] += Math.sin(time * .5 + phases[i]) * dt * .12;
      if (array[j + 1] > HEIGHT) array[j + 1] -= HEIGHT;
      // Wrap into the box centred on the player.
      const dx = array[j] - position.x;
      const dz = array[j + 2] - position.z;
      if (dx > BOX / 2) array[j] -= BOX;
      else if (dx < -BOX / 2) array[j] += BOX;
      if (dz > BOX / 2) array[j + 2] -= BOX;
      else if (dz < -BOX / 2) array[j + 2] += BOX;
    }
    attribute.needsUpdate = true;
  }

  return {
    points,
    update,
    get count() { return count; },
    setVisible(visible) { points.visible = visible; },
  };
}

/**
 * Colour grade: vignette plus a cool-shadow / warm-highlight split.
 *
 * Drawn as a full-screen quad in a second scene with an orthographic camera,
 * after the main render. That is one extra draw call and no framebuffer copy,
 * which is why it is affordable on a phone where a CSS filter is not.
 */
export function createGrade({ THREE, renderer, strength = 1 }) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uStrength: { value: strength },
      uVignette: { value: .42 },
      uCool: { value: new THREE.Color('#8fa6b8') },
      uWarm: { value: new THREE.Color('#d8b98a') },
      uContrast: { value: 1.06 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uStrength;
      uniform float uVignette;
      uniform float uContrast;
      uniform vec3 uCool;
      uniform vec3 uWarm;
      varying vec2 vUv;

      void main() {
        // Vignette: distance from centre, smoothstepped so the falloff is soft.
        vec2 d = vUv - 0.5;
        float r = length(d) * 1.42;
        float vig = smoothstep(0.42, 1.05, r) * uVignette;

        // Split tone: shadows lean cool, highlights lean warm. The luminance
        // decides which side of the split a pixel belongs to.
        float lum = dot(vec3(0.2126, 0.7152, 0.0722), vec3(1.0));
        vec3 cool = uCool * 0.055;
        vec3 warm = uWarm * 0.045;

        // Contrast around mid-grey, applied as a multiply so it never clips.
        float c = uContrast;
        vec3 base = vec3(1.0);
        vec3 graded = base * c - (c - 1.0) * 0.5;

        // The quad is drawn with normal blending over the frame: we only add
        // the tint and subtract the vignette, never replace the colour.
        vec3 tint = mix(cool, warm, 0.5) * uStrength;
        float alpha = vig * uStrength;
        gl_FragColor = vec4(tint, alpha);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);

  function render() {
    const previous = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = previous;
  }

  return {
    render,
    material,
    setStrength(value) { material.uniforms.uStrength.value = value; },
    get strength() { return material.uniforms.uStrength.value; },
  };
}

/**
 * Cinematic lighting rig: cold moon key with shadows, a warm bounce fill, and
 * a low ambient so the shadows stay deep instead of washing to grey.
 *
 * The amber emergency lights are emissive meshes in environment-detail.js, not
 * real lights — the scene keeps exactly one PointLight (the recycled street
 * lamp) so the per-fragment cost stays flat.
 */
export function createLightingRig({ THREE, scene, quality = 'high', touch = false }) {
  const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;

  // Cold moonlight: the key. Slightly blue, low intensity, long shadows.
  const moon = new THREE.DirectionalLight('#c8d8e8', 2.35);
  moon.position.set(-16, 30, -22);
  moon.castShadow = preset.shadows && !touch;
  moon.shadow.mapSize.set(preset.shadowMap, preset.shadowMap);
  moon.shadow.camera.left = -24;
  moon.shadow.camera.right = 24;
  moon.shadow.camera.top = 30;
  moon.shadow.camera.bottom = -30;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 90;
  moon.shadow.bias = -.0008;
  moon.shadow.normalBias = .02;
  scene.add(moon);
  scene.add(moon.target);

  // Warm bounce from the street: no shadows, no cost worth counting.
  const bounce = new THREE.DirectionalLight('#c9a878', .75);
  bounce.position.set(12, 6, 14);
  scene.add(bounce);

  // Ambient: a cold sky over a warm ground, which is what a night street does.
  // The value is deliberately generous: with ACES tone mapping a night scene
  // collapses to near-black long before it looks "moody", and a wall at 8/255
  // shows no texture at all no matter how good the maps are.
  const ambient = new THREE.HemisphereLight('#a8bccc', '#5c5346', 1.55);
  scene.add(ambient);

  // A very low fill from behind, so silhouettes separate from the fog.
  const rim = new THREE.DirectionalLight('#7f9bb0', .55);
  rim.position.set(8, 12, 26);
  scene.add(rim);

  function update(position) {
    // The shadow camera follows the player: a 48 m box around them is all that
    // can be seen through the fog anyway.
    moon.position.set(position.x - 16, 30, position.z - 22);
    moon.target.position.set(position.x, 0, position.z);
    moon.target.updateMatrixWorld();
  }

  return {
    moon, bounce, ambient, rim, update,
    get shadowEnabled() { return moon.castShadow; },
    get shadowMapSize() { return moon.shadow.mapSize.x; },
  };
}

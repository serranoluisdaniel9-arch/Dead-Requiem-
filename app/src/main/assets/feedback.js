/**
 * Combat feedback: hitmarker, floating damage numbers, camera shake and the
 * blob shadows that keep characters grounded when the shadow map is off.
 *
 * The DOM pieces are created once and reused; nothing here allocates per frame
 * except the short-lived damage numbers, which are pooled by removal.
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Radial falloff texture used by every blob shadow. */
export function createBlobTexture(THREE) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0,0,0,.72)');
  gradient.addColorStop(.45, 'rgba(0,0,0,.34)');
  gradient.addColorStop(.78, 'rgba(0,0,0,.10)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A soft ellipse under a character. `width`/`depth` are world metres; the plane
 * is rotated flat and lifted a hair to avoid z-fighting with the road.
 */
export function createBlobShadow(THREE, texture, { width = .78, depth = .52, opacity = .5 } = {}) {
  const geometry = new THREE.PlaneGeometry(width, depth);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * Screen-space feedback layer. Returns imperative calls the game loop drives.
 */
export function createFeedback({ container, crosshair }) {
  const layer = document.createElement('div');
  layer.className = 'feedback-layer';
  layer.setAttribute('aria-hidden', 'true');
  container.append(layer);

  const marker = document.createElement('div');
  marker.className = 'hitmarker';
  for (const side of ['tl', 'tr', 'bl', 'br']) {
    const tick = document.createElement('i');
    tick.className = `hitmarker-tick hitmarker-${side}`;
    marker.append(tick);
  }
  layer.append(marker);

  let markerTimer = 0;
  let shake = 0;
  let shakeTime = 0;
  const numbers = [];

  function hitmarker(kind = 'body') {
    marker.dataset.kind = kind;
    marker.classList.remove('active');
    // Force a reflow so a rapid second hit restarts the animation.
    void marker.offsetWidth;
    marker.classList.add('active');
    markerTimer = .16;
    if (crosshair) {
      crosshair.classList.add('hit');
      setTimeout(() => crosshair.classList.remove('hit'), 110);
    }
  }

  function damageNumber(worldPoint, amount, camera, kind = 'body') {
    const vector = worldPoint.clone().project(camera);
    if (vector.z > 1) return;
    const element = document.createElement('span');
    element.className = `damage-number damage-${kind}`;
    element.textContent = String(Math.round(amount));
    element.style.left = `${(vector.x * .5 + .5) * 100}%`;
    element.style.top = `${(-vector.y * .5 + .5) * 100}%`;
    layer.append(element);
    numbers.push({ element, life: .85, max: .85, drift: (Math.random() - .5) * 26 });
  }

  function kick(amount) {
    shake = Math.max(shake, amount);
    shakeTime = .18;
  }

  /** Returns the pixel offset to apply to the canvas this frame. */
  function update(dt) {
    if (markerTimer > 0) {
      markerTimer -= dt;
      if (markerTimer <= 0) marker.classList.remove('active');
    }
    for (let i = numbers.length - 1; i >= 0; i--) {
      const entry = numbers[i];
      entry.life -= dt;
      const progress = 1 - entry.life / entry.max;
      entry.element.style.transform =
        `translate(-50%,-50%) translate(${entry.drift * progress}px,${-46 * progress}px) scale(${1 + progress * .18})`;
      entry.element.style.opacity = String(clamp(entry.life / entry.max * 1.6, 0, 1));
      if (entry.life <= 0) {
        entry.element.remove();
        numbers.splice(i, 1);
      }
    }
    if (shakeTime > 0) {
      shakeTime -= dt;
      const decay = clamp(shakeTime / .18, 0, 1);
      const magnitude = shake * decay;
      return {
        x: (Math.random() - .5) * 2 * magnitude,
        y: (Math.random() - .5) * 2 * magnitude,
      };
    }
    shake = 0;
    return { x: 0, y: 0 };
  }

  function clear() {
    for (const entry of numbers) entry.element.remove();
    numbers.length = 0;
    marker.classList.remove('active');
    markerTimer = 0;
    shake = 0;
    shakeTime = 0;
  }

  return { hitmarker, damageNumber, kick, update, clear };
}

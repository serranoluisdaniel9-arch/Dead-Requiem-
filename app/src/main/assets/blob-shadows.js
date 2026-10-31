/**
 * Blob shadows as ONE draw call.
 *
 * v1.1 gave every character its own plane mesh, so 37 characters meant 37 draw
 * calls and 37 materials. This module keeps a single InstancedMesh with a
 * per-instance alpha attribute, so the whole field costs one draw call no
 * matter how many casters are on screen.
 *
 * The material is a tiny ShaderMaterial rather than MeshBasicMaterial because
 * per-instance *opacity* is not expressible through instanceColor: the shadow
 * is black, so darkening it changes nothing. An instanced float attribute is
 * the only way to fade one caster without touching the others.
 */

const VERTEX = `
  attribute float aAlpha;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vUv = uv;
    vAlpha = aAlpha;
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, vUv).a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }
`;

/**
 * @param {object} options
 * @param {number} options.capacity  maximum simultaneous casters
 * @param {THREE.Texture} options.texture  radial falloff (alpha channel)
 */
export function createBlobShadowField({ THREE, texture, capacity = 96 }) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const alphas = new Float32Array(capacity);
  geometry.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(alphas, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: texture } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    // The plane lies flat on the road; polygon offset keeps it off the asphalt.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'blob-shadow-field';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Park every instance at zero scale until a caster claims it.
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, zero);
  mesh.instanceMatrix.needsUpdate = true;

  const dummy = new THREE.Object3D();
  const casters = [];
  let used = 0;

  /**
   * Registers a caster. The returned handle is what the game mutates:
   * `visible`, `width`, `depth`, `opacity`, `groundY`.
   */
  function add({ width = .8, depth = .56, opacity = .45, groundY = -.04 } = {}) {
    const handle = { visible: true, width, depth, opacity, groundY, x: 0, y: 0, z: 0, index: -1 };
    if (casters.length < capacity) {
      handle.index = casters.length;
      casters.push(handle);
    }
    return handle;
  }

  /** Rebuilds every instance matrix from the casters' current world positions. */
  function update() {
    used = 0;
    for (const caster of casters) {
      const index = caster.index;
      if (index < 0) continue;
      if (!caster.visible) {
        alphas[index] = 0;
        mesh.setMatrixAt(index, zero);
        continue;
      }
      dummy.position.set(caster.x, caster.groundY, caster.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(caster.width, caster.depth, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      alphas[index] = caster.opacity;
      used++;
    }
    mesh.instanceMatrix.needsUpdate = true;
    geometry.attributes.aAlpha.needsUpdate = true;
  }

  return {
    mesh,
    add,
    update,
    get count() { return used; },
    get capacity() { return capacity; },
    /** Draw calls this field costs, for the renderer report. */
    get drawCalls() { return 1; },
  };
}

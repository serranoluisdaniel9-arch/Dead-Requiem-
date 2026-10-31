/**
 * Merges the static meshes of a group into one mesh per material.
 *
 * Why not InstancedMesh: these props are not copies of one shape. A pickup is a
 * crate plus a case plus a lid plus two latches, each a differently scaled box.
 * Instancing needs one geometry, so it would still cost one draw per material
 * per prop. Merging bakes the transforms into the vertices and collapses the
 * whole prop to one draw per material — and a pickup only uses two or three.
 *
 * Only position / normal / uv are merged. That is exactly what BoxGeometry and
 * PlaneGeometry carry, and it is all a MeshStandardMaterial needs.
 */

/**
 * @param {object} THREE
 * @param {THREE.Object3D} group  the group to collapse in place
 * @param {object} [options]
 * @param {boolean} [options.keepTransparent=true]  leave transparent meshes alone
 * @param {boolean} [options.bakeColor=false]  merge by material *signature* and
 *   bake each mesh's colour into vertex colours. This is what takes the mission
 *   props from 35 draws to a handful: they are all the same MeshStandardMaterial
 *   with a different `color`, so keying on the material uuid gives one draw per
 *   prop. Keying on the signature (type + roughness + metalness + map) and
 *   baking the colour collapses them into one draw per *kind* of surface.
 * @returns {{before:number, after:number, materials:number}}
 */
export function mergeStaticGroup(THREE, group, { keepTransparent = true, bakeColor = false } = {}) {
  group.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();

  // Collect every mesh, keyed by material. Sprites, lines and transparent
  // surfaces are left untouched: they need their own draw order.
  const byMaterial = new Map();
  const removable = [];
  let before = 0;

  /** A material's identity ignoring its colour, for the bakeColor path. */
  function signature(material) {
    return [
      material.type,
      material.roughness ?? '',
      material.metalness ?? '',
      material.map ? material.map.uuid : '',
      material.normalMap ? material.normalMap.uuid : '',
      material.vertexColors ? 'vc' : '',
      material.side ?? '',
      material.transparent ? 't' : '',
    ].join('|');
  }

  group.traverse(object => {
    if (!object.isMesh || object.isInstancedMesh) return;
    if (Array.isArray(object.material)) return;
    if (keepTransparent && object.material.transparent) return;
    before++;
    const key = bakeColor ? signature(object.material) : object.material.uuid;
    if (!byMaterial.has(key)) byMaterial.set(key, { material: object.material, meshes: [] });
    byMaterial.get(key).meshes.push(object);
    removable.push(object);
  });

  if (!byMaterial.size) return { before, after: before, materials: 0 };

  let after = 0;
  for (const { material, meshes } of byMaterial.values()) {
    const positions = [], normals = [], uvs = [], indices = [], colors = [];
    let offset = 0;
    const bake = bakeColor && meshes.length > 1;

    for (const mesh of meshes) {
      const geometry = mesh.geometry;
      // World transform relative to the group, so the merged mesh can live at
      // the group's origin and still land in the right place.
      const matrix = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);

      const position = geometry.attributes.position;
      const normal = geometry.attributes.normal;
      const uv = geometry.attributes.uv;
      const index = geometry.index;
      const sourceColor = mesh.material.color;

      const vertex = new THREE.Vector3();
      const normalVector = new THREE.Vector3();

      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
        positions.push(vertex.x, vertex.y, vertex.z);
        if (normal) {
          normalVector.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
          normals.push(normalVector.x, normalVector.y, normalVector.z);
        } else {
          normals.push(0, 1, 0);
        }
        if (uv) uvs.push(uv.getX(i), uv.getY(i));
        else uvs.push(0, 0);
        if (bake) colors.push(sourceColor.r, sourceColor.g, sourceColor.b);
      }

      if (index) {
        for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset);
      } else {
        for (let i = 0; i < position.count; i++) indices.push(i + offset);
      }
      offset += position.count;
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (bake) merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    merged.setIndex(indices);
    merged.computeBoundingSphere();

    // When colours are baked the shared material must be white and read vertex
    // colours, or every merged prop would take the first prop's tint.
    const outputMaterial = bake
      ? (() => {
          const clone = material.clone();
          clone.color = new THREE.Color(0xffffff);
          clone.vertexColors = true;
          return clone;
        })()
      : material;

    const mesh = new THREE.Mesh(merged, outputMaterial);
    mesh.name = 'merged-static';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    after++;
  }

  for (const mesh of removable) mesh.parent?.remove(mesh);

  return { before, after, materials: byMaterial.size };
}

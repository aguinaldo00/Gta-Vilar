import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP = new Set(['position', 'normal', 'uv']);

/**
 * Collects static geometry per material and merges it into a single mesh per
 * material, turning thousands of props into a few dozen draw calls.
 */
export class Batcher {
  private readonly groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly o = new THREE.Object3D();

  add(
    geo: THREE.BufferGeometry, mat: THREE.Material,
    x: number, y: number, z: number,
    ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0,
  ): void {
    this.o.position.set(x, y, z);
    this.o.rotation.set(rx, ry, rz, 'YXZ');
    this.o.scale.set(sx, sy, sz);
    this.o.updateMatrix();
    this.addMatrix(geo, mat, this.o.matrix);
  }

  addMatrix(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    g.applyMatrix4(m);
    let list = this.groups.get(mat);
    if (!list) this.groups.set(mat, (list = []));
    list.push(g);
  }

  build(parent: THREE.Object3D): void {
    for (const [mat, list] of this.groups) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = mat.userData.castShadow !== false;
      mesh.receiveShadow = mat.userData.receiveShadow !== false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
    }
    this.groups.clear();
  }
}

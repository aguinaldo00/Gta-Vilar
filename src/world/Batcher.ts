import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Static geometry is merged per material and per CHUNK×CHUNK m square so distant chunks get frustum-culled. */
export const CHUNK = 384;

interface Group {
  mat: THREE.Material;
  geos: THREE.BufferGeometry[];
}

const _box = new THREE.Box3();
const _c = new THREE.Vector3();

/**
 * Collects static geometry per (material, chunk) and merges each group into
 * one mesh: thousands of buildings, roads and props become a few dozen draw
 * calls, and only chunks inside the view are drawn.
 */
export class Batcher {
  private readonly groups = new Map<string, Group>();
  private readonly o = new THREE.Object3D();
  triangles = 0;
  /** Triangles per build stage (set `stage` before adding), for profiling. */
  readonly byStage: Record<string, number> = {};
  stage = 'misc';

  add(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    ry = 0,
    sx = 1,
    sy = 1,
    sz = 1,
    rx = 0,
    rz = 0,
  ): void {
    this.o.position.set(x, y, z);
    this.o.rotation.set(rx, ry, rz, 'YXZ');
    this.o.scale.set(sx, sy, sz);
    this.o.updateMatrix();
    this.addMatrix(geo, mat, this.o.matrix);
  }

  /** Adds a (shared) geometry transformed by `m`; the source geometry is not modified. */
  addMatrix(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    this.addWorld(g, mat);
  }

  /**
   * Adds a geometry already in world coordinates; takes ownership of it.
   * Materials flagged with `userData.redirect` are folded into a shared
   * vertex-coloured material (their colour is baked into the vertices), which
   * keeps the number of draw calls low.
   */
  addWorld(geo: THREE.BufferGeometry, mat: THREE.Material): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    const redirect = mat.userData.redirect as { mat: THREE.Material; color: THREE.Color } | undefined;
    if (redirect) {
      const n = g.attributes.position.count;
      const src = g.attributes.color as THREE.BufferAttribute | undefined;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = redirect.color.r * (src ? src.getX(i) : 1);
        arr[i * 3 + 1] = redirect.color.g * (src ? src.getY(i) : 1);
        arr[i * 3 + 2] = redirect.color.b * (src ? src.getZ(i) : 1);
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      mat = redirect.mat;
    }
    const wantColor = (mat as THREE.MeshStandardMaterial).vertexColors === true;
    const extra = (mat.userData.attributes as string[] | undefined) ?? [];
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(name === 'color' && wantColor) && !extra.includes(name))
        g.deleteAttribute(name);
    }
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (wantColor && !g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    g.clearGroups();
    _box.setFromBufferAttribute(g.attributes.position as THREE.BufferAttribute).getCenter(_c);
    const key = `${mat.uuid}|${Math.floor(_c.x / CHUNK)}|${Math.floor(_c.z / CHUNK)}`;
    let grp = this.groups.get(key);
    if (!grp) this.groups.set(key, (grp = { mat, geos: [] }));
    grp.geos.push(g);
    this.triangles += n / 3;
    this.byStage[this.stage] = (this.byStage[this.stage] ?? 0) + n / 3;
  }

  build(parent: THREE.Object3D): number {
    let meshes = 0;
    for (const { mat, geos } of this.groups.values()) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = mat.userData.castShadow !== false;
      mesh.receiveShadow = mat.userData.receiveShadow !== false;
      if (mat.userData.depthMaterial) mesh.customDepthMaterial = mat.userData.depthMaterial;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      meshes++;
    }
    this.groups.clear();
    return meshes;
  }
}

/** Batcher view that applies a base transform (position + Y rotation) to everything added. */
export class LocalBatch {
  private readonly o = new THREE.Object3D();
  private readonly tmp = new THREE.Matrix4();
  readonly cos: number;
  readonly sin: number;
  readonly matrix: THREE.Matrix4;

  constructor(
    readonly batch: Batcher,
    readonly x: number,
    readonly y: number,
    readonly z: number,
    readonly rot: number,
  ) {
    this.cos = Math.cos(rot);
    this.sin = Math.sin(rot);
    this.matrix = new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z);
  }

  add(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    ry = 0,
    sx = 1,
    sy = 1,
    sz = 1,
    rx = 0,
    rz = 0,
  ): void {
    this.o.position.set(x, y, z);
    this.o.rotation.set(rx, ry, rz, 'YXZ');
    this.o.scale.set(sx, sy, sz);
    this.o.updateMatrix();
    this.batch.addMatrix(geo, mat, this.tmp.multiplyMatrices(this.matrix, this.o.matrix));
  }

  addMatrix(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4): void {
    this.batch.addMatrix(geo, mat, this.tmp.multiplyMatrices(this.matrix, m));
  }

  /** Local (x, z) → world. */
  point(x: number, z: number): [number, number] {
    return [this.x + x * this.cos + z * this.sin, this.z - x * this.sin + z * this.cos];
  }
}

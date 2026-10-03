import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const shared = new Map<string, THREE.MeshStandardMaterial>();

/** Shared vertex-coloured material (one per transparency setting). */
function colouredMaterial(opacity: number): THREE.MeshStandardMaterial {
  const key = String(opacity);
  let m = shared.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: opacity < 1, opacity, roughness: opacity < 1 ? 0.1 : 0.55, metalness: 0.05 });
    shared.set(key, m);
  }
  return m;
}

/**
 * Replaces the direct mesh children of `group` with a single mesh whose
 * vertex colours carry each part's material colour: one draw call instead of
 * one per box. Meshes rejected by `keep` stay as they are (animated
 * materials, textures...).
 */
export function mergeColoured(group: THREE.Object3D, keep: (m: THREE.Mesh) => boolean = () => false): void {
  const parts = group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh && !keep(c as THREE.Mesh));
  const byOpacity = new Map<number, THREE.BufferGeometry[]>();
  for (const mesh of parts) {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mesh.updateMatrix();
    const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrix);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const c = mat.color.clone();
    if (mat.emissive && mat.emissiveIntensity > 0) c.add(mat.emissive.clone().multiplyScalar(mat.emissiveIntensity * 0.5));
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([Math.min(1, c.r), Math.min(1, c.g), Math.min(1, c.b)], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    const op = mat.transparent ? mat.opacity : 1;
    if (!byOpacity.has(op)) byOpacity.set(op, []);
    byOpacity.get(op)!.push(g);
    group.remove(mesh);
  }
  for (const [op, geos] of byOpacity) {
    const merged = new THREE.Mesh(mergeGeometries(geos)!, colouredMaterial(op));
    merged.castShadow = op === 1;
    merged.receiveShadow = true;
    group.add(merged);
    geos.forEach((g) => g.dispose());
  }
}

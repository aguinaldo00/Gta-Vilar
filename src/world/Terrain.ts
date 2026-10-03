import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math';
import type { Materials } from './Materials';
import { SOTO, riverCenterX, terrainHeight } from './layout';

const SIZE = 480;
const SEGMENTS = 240;

/** Heightfield mesh sampled from `terrainHeight`, coloured per vertex (grass, riverbed sand, hills). */
export function buildTerrain(mats: Materials): THREE.Mesh {
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const grass = new THREE.Color('#6f8f45');
  const lush = new THREE.Color('#5d8a3c');
  const dry = new THREE.Color('#8f9a5a');
  const sand = new THREE.Color('#8a7a5c');
  const hill = new THREE.Color('#6b7d4a');

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    uv.setXY(i, x / 6, -z / 6);

    const n = Math.sin(x * 0.07) * Math.cos(z * 0.05) + Math.sin(x * 0.21 + z * 0.17) * 0.5;
    c.copy(grass).lerp(dry, clamp(0.35 + n * 0.25, 0, 1));
    if (x > SOTO.minX - 10) c.lerp(lush, smoothstep(SOTO.minX - 10, SOTO.minX + 10, x));
    if (h > 1) c.lerp(hill, clamp(h / 12, 0, 1));
    const d = Math.abs(x - riverCenterX(z));
    if (d < 11) c.lerp(sand, lerp(1, 0, smoothstep(5, 11, d)));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mats.terrain);
  mesh.receiveShadow = true;
  return mesh;
}

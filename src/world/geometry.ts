import * as THREE from 'three';

/**
 * Box whose UVs are scaled to world metres so tiled textures (windows, stone,
 * tiles) keep a constant size regardless of the box dimensions.
 */
export function boxGeo(w: number, h: number, d: number, tileU = 0, tileV = tileU): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tileU > 0) {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    // Face order: +x, -x, +y, -y, +z, -z (4 vertices each).
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        uv.setXY(k, (uv.getX(k) * dims[f][0]) / tileU, (uv.getY(k) * dims[f][1]) / tileV);
      }
    }
  }
  return g;
}

/** Hip roof (four slopes and a ridge along the longer side), base at y = 0. */
export function hipRoof(w: number, d: number, h: number, overhang = 0.4): THREE.BufferGeometry {
  const swap = d > w;
  const W = (swap ? d : w) / 2 + overhang;
  const D = (swap ? w : d) / 2 + overhang;
  const r = Math.max(0, W - D);
  const A = [-W, 0, -D], B = [W, 0, -D], C = [W, 0, D], E = [-W, 0, D];
  const R1 = [-r, h, 0], R2 = [r, h, 0];
  const tris = [
    [E, C, R2], [E, R2, R1], // front slope (+z)
    [B, A, R1], [B, R1, R2], // back slope (-z)
    [C, B, R2], // east hip
    [A, E, R1], // west hip
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  tris.forEach((t, i) => {
    const sideways = i >= 4;
    for (const v of t) {
      pos.push(v[0], v[1], v[2]);
      const along = sideways ? v[2] : v[0];
      const up = sideways ? W - Math.abs(v[0]) : D - Math.abs(v[2]);
      uv.push(along / 2, up / 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  if (swap) g.rotateY(Math.PI / 2);
  return g;
}

export function scaleUV(g: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * Matrix that stretches a unit Y-aligned geometry (height 1, centred) into a
 * beam from a to b with the given thickness.
 */
export function beamMatrix(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, thickness: number,
): THREE.Matrix4 {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz).sub(_a);
  const len = _b.length();
  _q.setFromUnitVectors(UP, _b.normalize());
  _b.set(bx, by, bz).add(_a).multiplyScalar(0.5);
  _s.set(thickness, len, thickness);
  return new THREE.Matrix4().compose(_b, _q, _s);
}

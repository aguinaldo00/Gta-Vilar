import * as THREE from 'three';
import type { MapData } from './mapData';
import { waterTime } from './Water';

/**
 * Density mask over the whole map: R = how much grass grows (0 on roads,
 * buildings, water, paving), G = dryness (fields and meadows turn golden).
 */
function grassMask(map: MapData, size: number): THREE.CanvasTexture {
  const B = map.meta.bounds;
  const W = B.maxX - B.minX,
    H = B.maxZ - B.minZ;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(230,60,0)';
  g.fillRect(0, 0, size, size);
  g.setTransform(size / W, 0, 0, size / H, (-B.minX * size) / W, (-B.minZ * size) / H);
  const poly = (coords: number[]) => {
    g.moveTo(coords[0], coords[1]);
    for (let i = 2; i < coords.length; i += 2) g.lineTo(coords[i], coords[i + 1]);
    g.closePath();
  };
  const fills: Record<string, string> = {
    farmland: 'rgb(200,200,0)',
    meadow: 'rgb(255,120,0)',
    grass: 'rgb(255,40,0)',
    park: 'rgb(235,30,0)',
    garden: 'rgb(170,20,0)',
    residential: 'rgb(110,40,0)',
    orchard: 'rgb(200,60,0)',
    forest: 'rgb(150,40,0)',
    scrub: 'rgb(200,140,0)',
    cemetery: 'rgb(80,40,0)',
    camp: 'rgb(200,50,0)',
    allotments: 'rgb(120,60,0)',
    industrial: 'rgb(0,0,0)',
    parking: 'rgb(0,0,0)',
    pedestrian: 'rgb(0,0,0)',
    water: 'rgb(0,0,0)',
    pool: 'rgb(0,0,0)',
    pitch: 'rgb(0,0,0)',
    playground: 'rgb(0,0,0)',
    track: 'rgb(0,0,0)',
    school: 'rgb(60,20,0)',
    sports: 'rgb(60,20,0)',
    brownfield: 'rgb(120,160,0)',
    farmyard: 'rgb(60,100,0)',
    beach: 'rgb(0,0,0)',
  };
  const order = [
    'farmland',
    'meadow',
    'grass',
    'scrub',
    'orchard',
    'allotments',
    'residential',
    'forest',
    'park',
    'garden',
    'cemetery',
    'camp',
    'brownfield',
    'farmyard',
    'school',
    'sports',
    'industrial',
    'parking',
    'pitch',
    'playground',
    'track',
    'pedestrian',
    'beach',
    'water',
    'pool',
  ];
  for (const a of [...map.areas].sort((x, y) => order.indexOf(x.k) - order.indexOf(y.k))) {
    const f = fills[a.k];
    if (!f) continue;
    g.fillStyle = f;
    g.beginPath();
    poly(a.o);
    for (const h of a.h ?? []) poly(h);
    g.fill('evenodd');
  }
  g.fillStyle = '#000';
  for (const b of map.buildings) {
    g.beginPath();
    poly(b.o);
    g.fill();
  }
  g.strokeStyle = '#000';
  g.lineCap = g.lineJoin = 'round';
  for (const r of map.roads) {
    g.lineWidth = r.w + (r.sw ? 4.4 : 0.6);
    g.beginPath();
    g.moveTo(r.p[0], r.p[1]);
    for (let i = 2; i < r.p.length; i += 2) g.lineTo(r.p[i], r.p[i + 1]);
    g.stroke();
  }
  for (const r of map.rivers) {
    g.lineWidth = r.w + 5;
    g.beginPath();
    g.moveTo(r.p[0], r.p[1]);
    for (let i = 2; i < r.p.length; i += 2) g.lineTo(r.p[i], r.p[i + 1]);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** One tuft: three tapered blades (6 triangles) fanned around the origin, height 1, base at y = 0. */
function tuft(): THREE.InstancedBufferGeometry {
  const pos: number[] = [],
    col: number[] = [];
  const base = new THREE.Color('#3d5a24'),
    tip = new THREE.Color('#9fb25e');
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI + 0.3;
    const ca = Math.cos(a),
      sa = Math.sin(a);
    const lean = 0.18 * (b - 1);
    const w = 0.075;
    const p = (x: number, y: number) => [x * ca + lean * y, y, x * sa + lean * y * 0.5];
    // Tapered blade: two triangles (base to a narrow tip).
    const v = [p(-w, 0), p(w, 0), p(w * 0.15, 1), p(-w * 0.15, 1)];
    for (const [i, j, k] of [
      [0, 1, 2],
      [0, 2, 3],
    ]) {
      for (const n of [i, j, k]) {
        pos.push(...v[n]);
        const c = base.clone().lerp(tip, v[n][1]);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(
      new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)),
      3,
    ),
  );
  return g;
}

/** Terrain heights as a half-float texture (4 m texels) for the grass vertex shader. */
function heightTexture(map: MapData): THREE.DataTexture {
  const t = map.meta.terrain;
  const h = map.heights;
  if (!t || !h) {
    const flat = new THREE.DataTexture(new Uint16Array([0]), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
    flat.needsUpdate = true;
    return flat;
  }
  const step = 2;
  const w = Math.ceil(t.cols / step),
    hh = Math.ceil(t.rows / step);
  const data = new Uint16Array(w * hh);
  for (let r = 0; r < hh; r++) {
    for (let c = 0; c < w; c++)
      data[r * w + c] = THREE.DataUtils.toHalfFloat(h[Math.min(t.rows - 1, r * step) * t.cols + Math.min(t.cols - 1, c * step)]);
  }
  const tex = new THREE.DataTexture(data, w, hh, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** (minX, minZ, width, depth) covered by heightTexture: texel centres sit on the grid nodes. */
function heightGrid(map: MapData): THREE.Vector4 {
  const t = map.meta.terrain;
  if (!t) return new THREE.Vector4(0, 0, 1, 1);
  const step = 2;
  const w = Math.ceil(t.cols / step),
    hh = Math.ceil(t.rows / step);
  const cell = t.cell * step;
  return new THREE.Vector4(t.minX - cell / 2, t.minZ - cell / 2, w * cell, hh * cell);
}

/**
 * Wind-blown grass around the camera, one draw call. A fixed grid of tufts
 * follows the camera (snapped to the grid so it never swims); the vertex
 * shader jitters each tuft, reads the density mask to keep grass off roads,
 * buildings and water, fades it with distance and bends the tips in the wind.
 */
export class Grass {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: { uCam: { value: THREE.Vector3 } };

  constructor(map: MapData, scene: THREE.Scene, radius: number, spacing: number, maskSize: number) {
    const n = Math.ceil((radius * 2) / spacing);
    const geo = tuft();
    const cells = new Float32Array(n * n * 2);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cells.set([i - n / 2, j - n / 2], (i * n + j) * 2);
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    geo.instanceCount = n * n;

    const B = map.meta.bounds;
    this.uniforms = { uCam: { value: new THREE.Vector3() } };
    const uniforms = {
      ...this.uniforms,
      uTime: waterTime,
      uMask: { value: grassMask(map, maskSize) },
      uHeight: { value: heightTexture(map) },
      uHeightGrid: { value: heightGrid(map) },
      uBounds: { value: new THREE.Vector4(B.minX, B.minZ, B.maxX - B.minX, B.maxZ - B.minZ) },
      uSpacing: { value: spacing },
      uRadius: { value: radius },
    };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec3 uCam; uniform float uTime; uniform sampler2D uMask; uniform vec4 uBounds; uniform float uSpacing; uniform float uRadius;
uniform sampler2D uHeight; uniform vec4 uHeightGrid;
attribute vec2 aCell;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace(
          '#include <begin_vertex>',
          `
  vec2 grid = floor(uCam.xz / uSpacing) * uSpacing;
  vec2 wp = grid + aCell * uSpacing;
  float r1 = h21(wp), r2 = h21(wp + 17.3), r3 = h21(wp + 41.7);
  wp += (vec2(r1, r2) - 0.5) * uSpacing * 1.6;
  vec4 m = texture2D(uMask, vec2((wp.x - uBounds.x) / uBounds.z, 1.0 - (wp.y - uBounds.y) / uBounds.w));
  float dist = length(wp - uCam.xz);
  float density = smoothstep(0.08, 0.35, m.r) * step(r3, m.r * 1.15);
  float fade = 1.0 - smoothstep(uRadius * 0.55, uRadius, dist);
  float hgt = (0.22 + 0.36 * r2) * (0.7 + 0.45 * m.r) * density * fade;
  float ang = r1 * 6.2832;
  float ca = cos(ang), sa = sin(ang);
  vec3 transformed = vec3(position.x * ca - position.z * sa, position.y, position.x * sa + position.z * ca);
  transformed *= vec3(1.0 + r3 * 0.5, hgt, 1.0 + r3 * 0.5);
  float tip = position.y * position.y;
  transformed.x += (sin(uTime * 1.9 + wp.x * 0.35 + wp.y * 0.18) * 0.16 + sin(uTime * 4.1 + wp.y) * 0.03) * tip * hgt;
  transformed.z += cos(uTime * 1.5 + wp.y * 0.3) * 0.12 * tip * hgt;
  transformed.xz += wp;
  // Stand on the real ground (heightmap texture, metres).
  transformed.y += texture2D(uHeight, (wp - uHeightGrid.xy) / uHeightGrid.zw).r;
  // Dry fields and meadows turn golden; small per-tuft brightness variation.
  vColor.rgb *= mix(vec3(1.0), vec3(1.25, 1.12, 0.7), m.g) * (0.9 + 0.25 * r2);`,
        );
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
  }

  update(camera: THREE.Camera): void {
    this.uniforms.uCam.value.copy(camera.position);
  }
}

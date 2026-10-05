import * as THREE from 'three';
import { Layer } from '../physics/PhysicsWorld';
import type { BuildContext } from './context';
import { windSway } from './Materials';
import { SHRUB_TINT, SPECIES, shrubGeometry, speciesGeometry, treeAtlas } from './TreeSpecies';

/** Typical crown colour in the orthophoto; a tree's own colour tints it relative to this. */
const ORTHO_REF = [84, 94, 72];
/** The near / far split is redone when the camera has moved this far (m). */
const REBUCKET = 15;

interface Species {
  code: number;
  /** Every static tree of the species: matrices and colours (fixed). */
  m: THREE.Matrix4[];
  c: THREE.Color[];
  x: Float32Array;
  z: Float32Array;
  hi: THREE.InstancedMesh;
  lo: THREE.InstancedMesh;
}

/**
 * Every tree and shrub of the map, by species: close squares draw the detailed model and
 * distant ones a light model of a few large leaf cards. Small trees and shrubs near the
 * streets are breakables (a car knocks them over) instead of static instances.
 */
export class TreeField {
  readonly material: THREE.MeshStandardMaterial;
  readonly depth: THREE.MeshDepthMaterial;
  private readonly detail: number;
  private readonly geos = new Map<string, THREE.BufferGeometry>();
  private readonly pending = new Map<number, { m: THREE.Matrix4[]; c: THREE.Color[]; x: number[]; z: number[] }>();
  private readonly species: Species[] = [];
  private readonly last = new THREE.Vector3(1e9, 0, 1e9);
  private readonly hiDist: number;
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  counts = { static: 0, breakable: 0, shrubs: 0 };

  constructor(private readonly ctx: BuildContext) {
    this.detail = ctx.quality.detail ? 1 : 0.6;
    const atlas = treeAtlas(ctx.quality.detail ? 1024 : 512);
    this.material = windSway(
      new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 }),
    );
    this.material.name = 'trees';
    this.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5 });
    this.hiDist = ctx.quality.detail ? 150 : 85;
  }

  private geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geos.get(key);
    if (!g) this.geos.set(key, (g = make()));
    return g;
  }

  /** Instance colour: the species' leaf tint, shaded half-way towards the crown's colour in the orthophoto. */
  colour(code: number, tint: number | undefined): THREE.Color {
    const sp = SPECIES[code] ?? SPECIES[0];
    const c = new THREE.Color(sp.tint[0], sp.tint[1], sp.tint[2]);
    if (tint !== undefined && tint > 0) {
      const rgb = [(tint >> 16) & 255, (tint >> 8) & 255, tint & 255];
      const f = rgb.map((v, i) => Math.min(1.22, Math.max(0.8, 1 + (v / ORTHO_REF[i] - 1) * 0.5)));
      c.setRGB(c.r * f[0], c.g * f[1], c.b * f[2]);
    }
    return c;
  }

  /** Scale of a species model to a tree of height h and crown radius r (from the LiDAR). */
  private scale(code: number, h: number, r: number): [number, number] {
    const sp = SPECIES[code] ?? SPECIES[0];
    const sy = Math.min(2.4, Math.max(0.35, h / sp.h));
    const narrow = code === 3 || code === 16;
    const sxz = Math.min((narrow ? 1.15 : 1.5) * sy, Math.max(0.6 * sy, r / sp.r));
    return [sxz, sy];
  }

  /**
   * One tree. Small ones (up to the species' breakable height) near the town's streets become
   * breakables; the rest are static instances with a trunk collider.
   */
  tree(code: number, x: number, y: number, z: number, h: number, r: number, tint?: number, breakable = false): void {
    const sp = SPECIES[code] ?? SPECIES[0];
    const [sxz, sy] = this.scale(code, h, r);
    const rot = ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) * Math.PI * 2;
    const color = this.colour(code, tint);
    const trunk = Math.max(0.15, sp.trunkR * sxz);
    if (breakable && h <= sp.breakH) {
      const local = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3(sxz, sy, sxz));
      this.ctx.breakables.add(
        x,
        y,
        z,
        rot,
        trunk + 0.15,
        [
          {
            key: `tree${code}`,
            geo: this.geo(`mid${code}`, () => speciesGeometry(code, Math.min(this.detail, 0.6))),
            mat: this.material,
            depthMat: this.depth,
            castShadow: this.ctx.quality.treeShadows,
            color,
            local,
            range: this.ctx.quality.detail ? 300 : 170,
          },
        ],
        0.62,
      );
      this.ctx.collision.addCircle(x, z, trunk, { top: h, mask: Layer.Player });
      this.counts.breakable++;
      return;
    }
    let e = this.pending.get(code);
    if (!e) this.pending.set(code, (e = { m: [], c: [], x: [], z: [] }));
    this.q.setFromAxisAngle(this.up, rot);
    e.m.push(new THREE.Matrix4().compose(this.v.set(x, y, z), this.q, this.s.set(sxz, sy, sxz)));
    e.c.push(color);
    e.x.push(x);
    e.z.push(z);
    if (h > 3) this.ctx.collision.addCircle(x, z, trunk, { top: h, mask: Layer.Bodies });
    this.counts.static++;
  }

  /** A shrub (always breakable: cars drive through hedgerow shrubs and garden bushes). */
  shrub(code: number, x: number, y: number, z: number, h: number): void {
    const sy = code === 4 ? h / 2 : Math.max(0.5, Math.min(3.5, h));
    const sxz = code === 4 ? Math.max(0.8, sy) : Math.max(0.7, Math.min(2.6, h * 0.9 + 0.3));
    const rot = ((Math.sin(x * 4.1 + z * 7.3) * 9631.17) % 1) * Math.PI * 2;
    const t = SHRUB_TINT[code] ?? SHRUB_TINT[0];
    const k = 0.88 + (((Math.sin(x * 3.7 + z * 1.9) * 1000) % 1) + 1) * 0.12;
    this.ctx.breakables.add(
      x,
      y,
      z,
      rot,
      0.35 * sxz,
      [
        {
          key: `shrub${code}`,
          geo: this.geo(`shrub${code}`, () => shrubGeometry(code, this.detail)),
          mat: this.material,
          depthMat: this.depth,
          // Low bushes: their shadow is barely visible and there are thousands of them.
          castShadow: false,
          color: new THREE.Color(t[0] * k, t[1] * k, t[2] * k),
          local: new THREE.Matrix4().makeScale(sxz, sy, sxz),
          range: this.ctx.quality.detail ? 170 : 100,
        },
      ],
      0.93,
    );
    if (h > 0.9) this.ctx.collision.addCircle(x, z, 0.3 * sxz, { top: h, mask: Layer.Player });
    this.counts.shrubs++;
  }

  /** Builds the instanced meshes (call once, after every tree was added): one near and one far mesh per species. */
  finish(scene: THREE.Scene): void {
    for (const [code, e] of this.pending) {
      const n = e.m.length;
      const make = (g: THREE.BufferGeometry, shadow: boolean) => {
        const im = new THREE.InstancedMesh(g, this.material, n);
        im.customDepthMaterial = this.depth;
        im.castShadow = shadow;
        im.receiveShadow = true;
        im.name = 'trees';
        im.count = 0;
        scene.add(im);
        return im;
      };
      const hi = make(
        this.geo(`hi${code}`, () => speciesGeometry(code, this.detail)),
        this.ctx.quality.treeShadows,
      );
      const lo = make(
        this.geo(`lo${code}`, () => speciesGeometry(code, 0.22)),
        false,
      );
      this.species.push({ code, m: e.m, c: e.c, x: Float32Array.from(e.x), z: Float32Array.from(e.z), hi, lo });
    }
    this.pending.clear();
  }

  /**
   * Near trees get the detailed model, far ones the light model: the split is redone
   * when the camera has moved REBUCKET metres (one near and one far draw per species).
   */
  update(camera: THREE.Vector3): void {
    if (Math.hypot(camera.x - this.last.x, camera.z - this.last.z) < REBUCKET) return;
    this.last.copy(camera);
    const r2 = this.hiDist * this.hiDist;
    for (const sp of this.species) {
      let nh = 0,
        nl = 0;
      for (let i = 0; i < sp.m.length; i++) {
        const dx = sp.x[i] - camera.x,
          dz = sp.z[i] - camera.z;
        if (dx * dx + dz * dz < r2) {
          sp.hi.setMatrixAt(nh, sp.m[i]);
          sp.hi.setColorAt(nh++, sp.c[i]);
        } else {
          sp.lo.setMatrixAt(nl, sp.m[i]);
          sp.lo.setColorAt(nl++, sp.c[i]);
        }
      }
      for (const [im, count] of [
        [sp.hi, nh],
        [sp.lo, nl],
      ] as const) {
        im.count = count;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        im.visible = count > 0;
      }
    }
  }
}

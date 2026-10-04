import * as THREE from 'three';
import { mergeColoured } from '../core/mergeColored';
import type { MapRoad } from '../world/mapData';
import type { World } from '../world/World';

const SKINS = ['#e8bd9a', '#d9a47e', '#c58c66', '#a8714e', '#7a5038'];
const TOPS = ['#2f4a74', '#7c2d22', '#3d5a3f', '#c9c3b5', '#1f1f22', '#8b6b3e', '#5a3d6b', '#b8463a', '#e2e0d8', '#4f6d84'];
const BOTTOMS = ['#2a3446', '#1f1f22', '#5b5146', '#3a4a5c', '#6b6457'];
const HAIRS = ['#2b1d14', '#5a3a22', '#9a9a96', '#c9b48a', '#1a1412'];
/** Pedestrians are updated (and shown) within this distance of the camera. */
const ACTIVE = 160;
const WALK_SPEED = 1.25;
const TOWN_RADIUS = 520;

interface Path {
  pts: [number, number][];
  len: number[];
}

interface Walker {
  root: THREE.Group;
  body: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  /** Walking a path, or sitting on a bench. */
  path: Path | null;
  s: number;
  dir: 1 | -1;
  /** Side offset from the path's centre line (sidewalk). */
  side: number;
  speed: number;
  phase: number;
  /** Seconds left standing still (window shopping, a chat). */
  pause: number;
  /** Stepping aside from a car (seconds left) and the direction. */
  dodge: number;
  dodgeX: number;
  dodgeZ: number;
  /** Out at night too (the rest stay in after dark). */
  nightOwl: boolean;
  x: number;
  z: number;
}

const pick = <T>(a: T[], r: number) => a[Math.floor(r * a.length) % a.length];

/**
 * A few townspeople: some walk the sidewalks, paths and squares of the town
 * at an easy pace (stopping now and then), others sit on the real benches of
 * the plaza and the parks. They step aside from a car that comes at them,
 * and most of them go home after dark. Low-poly, like the player.
 */
export class Pedestrians {
  private readonly people: Walker[] = [];
  private seed = 12345;

  constructor(
    private readonly world: World,
    scene: THREE.Scene,
    count: number,
  ) {
    const paths = this.collectPaths();
    const benches = this.collectBenches();
    const sitters = Math.min(benches.length, Math.round(count * 0.35));
    for (let i = 0; i < count; i++) {
      const w = this.makePerson();
      scene.add(w.root);
      if (i < sitters) {
        // Benches nearest the Plaza Mayor first (most life is in the centre).
        const b = benches.splice(Math.floor(this.rnd() ** 2 * Math.min(benches.length, 30)), 1)[0];
        this.seat(w, b.x, b.z, b.rot, b.off);
      } else if (paths.length) {
        w.path = this.weighted(paths);
        w.s = this.rnd() * w.path.len[w.path.len.length - 1];
        w.dir = this.rnd() < 0.5 ? 1 : -1;
      }
      this.people.push(w);
    }
  }

  /** A path picked with more weight near the centre of town. */
  private weighted<T extends Path>(paths: T[]): T {
    const wts = paths.map((p) => {
      const m = p.pts[Math.floor(p.pts.length / 2)];
      return 1 / (1 + Math.hypot(m[0], m[1]) / 70) ** 2.2;
    });
    let r = this.rnd() * wts.reduce((a, b) => a + b, 0);
    for (let i = 0; i < paths.length; i++) if ((r -= wts[i]) <= 0) return paths[i];
    return paths[paths.length - 1];
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** Walkable lines near the town: footways and squares, and the sidewalks of residential streets. */
  private collectPaths(): (Path & { sideW: number })[] {
    const out: (Path & { sideW: number })[] = [];
    const ok = (r: MapRoad) =>
      ['footway', 'pedestrian', 'path', 'living_street', 'residential', 'tertiary', 'secondary', 'primary'].includes(r.k);
    for (const r of this.world.map.roads) {
      if (!ok(r) || r.b) continue;
      const pts: [number, number][] = [];
      for (let i = 0; i < r.p.length; i += 2) pts.push([r.p[i], r.p[i + 1]]);
      if (Math.hypot(...pts[0]) > TOWN_RADIUS) continue;
      const len = [0];
      for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      if (len[len.length - 1] < 25) continue;
      const vehicle = !['footway', 'pedestrian', 'path'].includes(r.k);
      // Pedestrian ways in the middle; streets on their sidewalks.
      out.push({ pts, len, sideW: vehicle ? r.w / 2 + 1.1 : 0 });
    }
    return out;
  }

  private collectBenches(): { x: number; z: number; rot: number; off: number }[] {
    const b = this.world.map.benches;
    const out: { x: number; z: number; rot: number; off: number }[] = [];
    for (let i = 0; i < b.length; i += 2) {
      const x = b[i],
        z = b[i + 1];
      if (Math.hypot(x, z) > TOWN_RADIUS) continue;
      const hit = this.world.roads.nearest(x, z, 25);
      out.push({ x, z, rot: hit ? Math.atan2(hit.x - x, hit.z - z) : 0, off: (this.rnd() - 0.5) * 1.0 });
    }
    out.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    return out;
  }

  private makePerson(): Walker {
    const r = () => this.rnd();
    const mat = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
    const skin = mat(pick(SKINS, r())),
      top = mat(pick(TOPS, r())),
      bottom = mat(pick(BOTTOMS, r())),
      hair = mat(pick(HAIRS, r())),
      shoes = mat('#2a2420');
    const root = new THREE.Group(),
      body = new THREE.Group(),
      legL = new THREE.Group(),
      legR = new THREE.Group(),
      armL = new THREE.Group(),
      armR = new THREE.Group();
    const part = (p: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      p.add(mesh);
    };
    const scale = 0.9 + r() * 0.18;
    const wide = 0.9 + r() * 0.25;
    body.position.y = 0.95;
    root.add(body);
    part(body, 0.52 * wide, 0.62, 0.28 * wide, top, 0, 0.31, 0);
    part(body, 0.14, 0.08, 0.14, skin, 0, 0.66, 0);
    part(body, 0.28, 0.3, 0.28, skin, 0, 0.83, 0);
    const longHair = r() < 0.4;
    part(body, 0.3, 0.1, 0.3, hair, 0, 1.0, -0.01);
    if (longHair) part(body, 0.3, 0.34, 0.06, hair, 0, 0.82, -0.14);
    for (const [arm, side] of [
      [armL, 1],
      [armR, -1],
    ] as const) {
      arm.position.set(side * 0.33 * wide, 0.55, 0);
      body.add(arm);
      part(arm, 0.14, 0.42, 0.16, top, 0, -0.2, 0);
      part(arm, 0.12, 0.18, 0.13, skin, 0, -0.5, 0);
    }
    for (const [leg, side] of [
      [legL, 1],
      [legR, -1],
    ] as const) {
      leg.position.set(side * 0.13 * wide, 0, 0);
      body.add(leg);
      part(leg, 0.2, 0.86, 0.22, bottom, 0, -0.43, 0);
      part(leg, 0.2, 0.1, 0.3, shoes, 0, -0.9, 0.05);
    }
    for (const g of [body, armL, armR, legL, legR]) mergeColoured(g);
    root.scale.setScalar(scale);
    return {
      root,
      body,
      legL,
      legR,
      armL,
      armR,
      path: null,
      s: 0,
      dir: 1,
      side: r() < 0.5 ? 1 : -1,
      speed: WALK_SPEED * (0.8 + r() * 0.4),
      phase: r() * 6,
      pause: 0,
      dodge: 0,
      dodgeX: 0,
      dodgeZ: 0,
      nightOwl: r() < 0.3,
      x: 0,
      z: 0,
    };
  }

  private seat(w: Walker, x: number, z: number, rot: number, off: number): void {
    const c = Math.cos(rot),
      s = Math.sin(rot);
    w.x = x + c * off + s * 0.05;
    w.z = z - s * off + c * 0.05;
    w.root.position.set(w.x, this.world.heightAt(x, z) - 0.42, w.z);
    w.root.rotation.y = rot;
    w.legL.rotation.x = w.legR.rotation.x = -1.45;
    w.armL.rotation.x = w.armR.rotation.x = -0.35;
    w.body.rotation.x = -0.08;
  }

  private pointAt(p: Path, s: number): { x: number; z: number; dx: number; dz: number } {
    const L = p.len;
    let i = 1;
    while (i < L.length - 1 && L[i] < s) i++;
    const a = p.pts[i - 1],
      b = p.pts[i];
    const seg = L[i] - L[i - 1] || 1;
    const t = Math.min(1, Math.max(0, (s - L[i - 1]) / seg));
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / seg, dz: (b[1] - a[1]) / seg };
  }

  update(dt: number, camera: THREE.Vector3, night: number, cars: readonly { x: number; z: number; speed: number }[]): void {
    for (const w of this.people) {
      const home = night > 0.6 && !w.nightOwl;
      const near = Math.hypot(w.x - camera.x, w.z - camera.z) < ACTIVE;
      w.root.visible = near && !home;
      if (!w.path) continue;
      const p = w.path as Path & { sideW: number };
      // Walk even when not visible (cheap), but only animate nearby.
      if (w.pause > 0) w.pause -= dt;
      else {
        w.s += w.dir * w.speed * dt;
        const end = p.len[p.len.length - 1];
        if (w.s < 0 || w.s > end) {
          w.dir = w.dir === 1 ? -1 : 1;
          w.s = Math.min(end, Math.max(0, w.s));
        } else if (this.rnd() < dt * 0.02) w.pause = 2 + this.rnd() * 5;
      }
      const q = this.pointAt(p, w.s);
      const fx = q.dx * w.dir,
        fz = q.dz * w.dir;
      // Keep to the right-hand sidewalk of the way they are going.
      const off = p.sideW ? p.sideW : 0.6 * w.side;
      let x = q.x - fz * off,
        z = q.z + fx * off;
      // A car coming: step aside, away from it.
      for (const c of cars) {
        if (Math.abs(c.speed) < 2) continue;
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < 4 && w.dodge <= 0) {
          w.dodge = 1.2;
          w.dodgeX = (x - c.x) / (d || 1);
          w.dodgeZ = (z - c.z) / (d || 1);
        }
      }
      if (w.dodge > 0) {
        w.dodge -= dt;
        const k = Math.sin(Math.min(1, w.dodge / 1.2) * Math.PI) * 2.2;
        x += w.dodgeX * k;
        z += w.dodgeZ * k;
      }
      w.x = x;
      w.z = z;
      if (!w.root.visible) continue;
      w.root.position.set(x, this.world.heightAt(x, z), z);
      w.root.rotation.y = Math.atan2(fx, fz);
      const moving = w.pause <= 0;
      if (moving) w.phase += dt * w.speed * 4.2;
      const swing = moving ? Math.sin(w.phase) * 0.55 : 0;
      w.legL.rotation.x = swing;
      w.legR.rotation.x = -swing;
      w.armL.rotation.x = -swing * 0.8;
      w.armR.rotation.x = swing * 0.8;
      w.body.position.y = 0.95 + (moving ? Math.abs(Math.cos(w.phase)) * 0.03 : 0);
    }
  }
}

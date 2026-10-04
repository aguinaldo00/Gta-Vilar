import type { Howl } from 'howler';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AudioMix } from '../audio/AudioMix';
import type { World } from '../world/World';
import { type Agent, type AIHooks, panic, type Route, stepAgent, type Vehicleish, type VoiceKind, WALK } from './PedestrianAI';

const SKINS = ['#e8bd9a', '#d9a47e', '#c58c66', '#a8714e', '#7a5038'];
const TOPS = [
  '#2f4a74',
  '#7c2d22',
  '#3d5a3f',
  '#c9c3b5',
  '#1f1f22',
  '#8b6b3e',
  '#5a3d6b',
  '#b8463a',
  '#e2e0d8',
  '#4f6d84',
  '#d8a03a',
  '#2c6e6a',
];
const BOTTOMS = ['#2a3446', '#1f1f22', '#5b5146', '#3a4a5c', '#6b6457', '#7a6a55'];
const HAIRS = ['#2b1d14', '#5a3a22', '#9a9a96', '#c9b48a', '#1a1412', '#7a4a2a'];
/** Agents are simulated within this distance of the camera; models are given to the nearest. */
const SIM_R = 220;
const SHOW_R = 120;
const TOWN_R = 560;

/** Pooled, re-coloured body (one per visible townsperson). */
interface Model {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  phone: THREE.Mesh;
  mats: {
    skin: THREE.MeshStandardMaterial;
    top: THREE.MeshStandardMaterial;
    bottom: THREE.MeshStandardMaterial;
    hair: THREE.MeshStandardMaterial;
  };
  agent: Agent | null;
  phase: number;
}

const pick = <T>(a: T[], r: number) => a[Math.floor(r * a.length) % a.length];

/**
 * Merges the direct mesh children of a group that share a material (keeping
 * the material, so a pooled body can be re-coloured): one draw call per
 * material and limb instead of one per box.
 */
function mergeByMaterial(group: THREE.Object3D, keep: THREE.Object3D): void {
  const by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const c of [...group.children]) {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh || mesh === keep) continue;
    mesh.updateMatrix();
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrix);
    const mat = mesh.material as THREE.Material;
    (by.get(mat) ?? by.set(mat, []).get(mat)!).push(g);
    group.remove(mesh);
  }
  for (const [mat, geos] of by) {
    const merged = new THREE.Mesh(mergeGeometries(geos)!, mat);
    merged.castShadow = true;
    group.add(merged);
  }
}

/**
 * The people of Villarcayo. A population of townspeople (agents, cheap) lives
 * in the busy places, the Plaza Mayor, the shopping streets and the parks,
 * walking their routes, stopping, checking their phone or sitting on the
 * real benches. Only those near the camera are simulated, and a small pool
 * of bodies is handed to the nearest ones (object pooling: re-coloured with
 * each person's clothes), so dozens of people cost a handful of draw calls.
 *
 * Reactions (PedestrianAI): a car coming fast makes them jump aside (and
 * shout), a hit sends them flying (ragdoll), and `panicAt(x, z, r)` sends
 * everyone around running for shelter (for gunfire or chases later). Voice
 * lines are hooks: `voice(kind)` plays one of the files listed under
 * `voices` in public/config/audio.json (placeholders to replace).
 */
export class PedestrianSystem {
  readonly agents: Agent[] = [];
  private readonly pool: Model[] = [];
  private seed = 4242;
  private voices: Record<string, Howl[]> = {};
  private time = 0;
  private readonly hooks: AIHooks;
  private readonly shelters: [number, number][] = [];
  private listener = new THREE.Vector3();
  private listenerYaw = 0;

  constructor(
    private readonly world: World,
    scene: THREE.Scene,
    population: number,
    poolSize: number,
  ) {
    this.hooks = {
      voice: (k, x, z) => this.voice(k, x, z),
      shelter: (x, z) => this.shelter(x, z),
      groundAt: (x, z) => world.heightAt(x, z),
      rnd: () => this.rnd(),
    };
    // Doorways to run to: the middle of building walls that face a street.
    for (const b of world.map.buildings) {
      if (b.part && !b.hp) continue;
      if (b.o.length < 6) continue;
      let cx = 0,
        cz = 0;
      for (let i = 0; i < b.o.length; i += 2) {
        cx += b.o[i];
        cz += b.o[i + 1];
      }
      cx /= b.o.length / 2;
      cz /= b.o.length / 2;
      if (Math.hypot(cx, cz) < TOWN_R) this.shelters.push([cx, cz]);
    }
    const routes = this.collectRoutes();
    const benches = this.collectBenches();
    const sitters = Math.min(benches.length, Math.round(population * 0.22));
    for (let i = 0; i < population; i++) {
      const a: Agent = {
        x: 0,
        z: 0,
        y: 0,
        heading: 0,
        state: 'walk',
        timer: 0,
        route: null,
        s: 0,
        dir: this.rnd() < 0.5 ? 1 : -1,
        sideSign: this.rnd() < 0.5 ? 1 : -1,
        speed: WALK * (0.8 + this.rnd() * 0.4),
        look: this.rnd(),
        nightOwl: this.rnd() < 0.3,
        vx: 0,
        vy: 0,
        vz: 0,
        spin: 0,
        tumble: 0,
        tx: 0,
        tz: 0,
      };
      if (i < sitters) {
        const b = benches.splice(Math.floor(this.rnd() ** 2 * Math.min(benches.length, 40)), 1)[0];
        const c = Math.cos(b.rot),
          s = Math.sin(b.rot);
        a.seat = { x: b.x + c * b.off + s * 0.05, z: b.z - s * b.off + c * 0.05, rot: b.rot };
        a.x = a.seat.x;
        a.z = a.seat.z;
        a.heading = b.rot;
        a.state = 'sit';
      } else if (routes.length) {
        a.route = this.weighted(routes);
        a.s = this.rnd() * a.route.len[a.route.len.length - 1];
        a.state = this.rnd() < 0.15 ? 'phone' : 'walk';
        a.timer = 4 + this.rnd() * 8;
        const p = routes.length ? a.route.pts[0] : [0, 0];
        a.x = p[0];
        a.z = p[1];
        stepAgent(a, 0, [], this.hooks);
      }
      this.agents.push(a);
    }
    for (let i = 0; i < poolSize; i++) {
      const m = this.makeModel();
      scene.add(m.root);
      this.pool.push(m);
    }
  }

  /** Voice lines (paths from public/config/audio.json `voices`). */
  setVoices(conf: Record<string, string[] | string> | undefined): void {
    if (!conf) return;
    for (const [k, v] of Object.entries(conf)) {
      if (k.startsWith('_')) continue;
      this.voices[k] = (Array.isArray(v) ? v : [v]).map((src) => AudioMix.howl(src, 'voices'));
    }
  }

  /** Everyone within r metres of (x, z) panics and runs for shelter (gunfire, a chase). */
  panicAt(x: number, z: number, r: number): number {
    let n = 0;
    for (const a of this.agents)
      if (Math.hypot(a.x - x, a.z - z) < r) {
        panic(a, this.hooks);
        n++;
      }
    return n;
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /**
   * VOICE HOOK: plays a reaction line from the agent's position (volume by
   * distance, panned left/right from the camera). Replace the files in
   * public/config/audio.json → voices; nothing else changes.
   */
  private voice(kind: VoiceKind, x: number, z: number): void {
    const list = this.voices[kind];
    if (!list?.length) return;
    const d = Math.hypot(x - this.listener.x, z - this.listener.z);
    if (d > 40) return;
    // No chorus: one line at a time per person.
    const howl = list[Math.floor(Math.random() * list.length)];
    const vol = Math.max(0, 1 - d / 40) * AudioMix.settings.voices;
    const ang = Math.atan2(x - this.listener.x, z - this.listener.z) - this.listenerYaw;
    const id = howl.play();
    howl.volume(vol, id);
    howl.stereo(Math.max(-1, Math.min(1, Math.sin(ang))), id);
  }

  private shelter(x: number, z: number): { x: number; z: number } {
    let best: [number, number] = [x + 8, z],
      bd = Infinity;
    for (const s of this.shelters) {
      const d = Math.hypot(s[0] - x, s[1] - z);
      if (d < bd && d > 3) {
        bd = d;
        best = s;
      }
    }
    return { x: best[0], z: best[1] };
  }

  /** Walkable lines: footways and squares, and the sidewalks of the busy streets. */
  private collectRoutes(): Route[] {
    const out: Route[] = [];
    const ok = ['footway', 'pedestrian', 'path', 'living_street', 'residential', 'tertiary', 'secondary', 'primary'];
    for (const r of this.world.map.roads) {
      if (!ok.includes(r.k) || r.b) continue;
      const pts: [number, number][] = [];
      for (let i = 0; i < r.p.length; i += 2) pts.push([r.p[i], r.p[i + 1]]);
      if (Math.hypot(...pts[0]) > TOWN_R) continue;
      const len = [0];
      for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      if (len[len.length - 1] < 25) continue;
      const vehicle = !['footway', 'pedestrian', 'path'].includes(r.k);
      out.push({ pts, len, side: vehicle ? r.w / 2 + 1.1 : 0 });
    }
    // Strolls across the squares (Plaza Mayor...): straight walks between two points of the square.
    for (const a of this.world.map.areas) {
      if (a.k !== 'pedestrian') continue;
      const ring: [number, number][] = [];
      for (let i = 0; i < a.o.length; i += 2) ring.push([a.o[i], a.o[i + 1]]);
      const xs = ring.map((p) => p[0]),
        zs = ring.map((p) => p[1]);
      const minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minZ = Math.min(...zs),
        maxZ = Math.max(...zs);
      if (Math.hypot((minX + maxX) / 2, (minZ + maxZ) / 2) > 350) continue;
      const area = (maxX - minX) * (maxZ - minZ);
      const inside = (x: number, z: number) => {
        let c = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, zi] = ring[i],
            [xj, zj] = ring[j];
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
        }
        return c;
      };
      const n = Math.min(12, Math.round(area / 400));
      for (let k = 0, tries = 0; k < n && tries < n * 20; tries++) {
        const p0: [number, number] = [minX + this.rnd() * (maxX - minX), minZ + this.rnd() * (maxZ - minZ)];
        const p1: [number, number] = [minX + this.rnd() * (maxX - minX), minZ + this.rnd() * (maxZ - minZ)];
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (len < 15) continue;
        let ok = true;
        for (let t = 0; t <= 1 && ok; t += 0.1) ok = inside(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t);
        if (!ok) continue;
        out.push({ pts: [p0, p1], len: [0, len], side: 0 });
        k++;
      }
    }
    return out;
  }

  /** More people where there are shops and near the Plaza Mayor. */
  private weighted(routes: Route[]): Route {
    const shops = this.world.map.shops;
    const wts = routes.map((r) => {
      const m = r.pts[Math.floor(r.pts.length / 2)];
      let near = 0;
      for (const s of shops) if (Math.abs(s.x - m[0]) < 40 && Math.abs(s.z - m[1]) < 40) near++;
      return (1 + near * 0.6) / (1 + Math.hypot(m[0], m[1]) / 90) ** 2;
    });
    let r = this.rnd() * wts.reduce((a, b) => a + b, 0);
    for (let i = 0; i < routes.length; i++) if ((r -= wts[i]) <= 0) return routes[i];
    return routes[routes.length - 1];
  }

  private collectBenches(): { x: number; z: number; rot: number; off: number }[] {
    const b = this.world.map.benches;
    const out: { x: number; z: number; rot: number; off: number }[] = [];
    for (let i = 0; i < b.length; i += 2) {
      const x = b[i],
        z = b[i + 1];
      if (Math.hypot(x, z) > TOWN_R) continue;
      const hit = this.world.roads.nearest(x, z, 25);
      out.push({ x, z, rot: hit ? Math.atan2(hit.x - x, hit.z - z) : 0, off: (this.rnd() - 0.5) * 1.0 });
    }
    out.sort((a, b2) => Math.hypot(a.x, a.z) - Math.hypot(b2.x, b2.z));
    return out;
  }

  private makeModel(): Model {
    const mat = () => new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const mats = { skin: mat(), top: mat(), bottom: mat(), hair: mat() };
    const shoes = new THREE.MeshStandardMaterial({ color: '#2a2420', roughness: 0.8 });
    const root = new THREE.Group(),
      body = new THREE.Group(),
      head = new THREE.Group(),
      legL = new THREE.Group(),
      legR = new THREE.Group(),
      armL = new THREE.Group(),
      armR = new THREE.Group();
    const part = (p: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      p.add(mesh);
      return mesh;
    };
    body.position.y = 0.95;
    root.add(body);
    part(body, 0.52, 0.62, 0.28, mats.top, 0, 0.31, 0);
    part(body, 0.14, 0.08, 0.14, mats.skin, 0, 0.66, 0);
    head.position.set(0, 0.7, 0);
    body.add(head);
    part(head, 0.28, 0.3, 0.28, mats.skin, 0, 0.13, 0);
    part(head, 0.3, 0.1, 0.3, mats.hair, 0, 0.3, -0.01);
    part(head, 0.3, 0.16, 0.06, mats.hair, 0, 0.17, -0.14);
    for (const [arm, side] of [
      [armL, 1],
      [armR, -1],
    ] as const) {
      arm.position.set(side * 0.33, 0.55, 0);
      body.add(arm);
      part(arm, 0.14, 0.42, 0.16, mats.top, 0, -0.2, 0);
      part(arm, 0.12, 0.18, 0.13, mats.skin, 0, -0.5, 0);
    }
    for (const [leg, side] of [
      [legL, 1],
      [legR, -1],
    ] as const) {
      leg.position.set(side * 0.13, 0, 0);
      body.add(leg);
      part(leg, 0.2, 0.86, 0.22, mats.bottom, 0, -0.43, 0);
      part(leg, 0.2, 0.1, 0.3, shoes, 0, -0.9, 0.05);
    }
    // The phone in the right hand (shown while texting).
    const phone = part(armR, 0.08, 0.14, 0.02, new THREE.MeshBasicMaterial({ color: '#9fc6ff' }), 0, -0.62, 0.06);
    phone.visible = false;
    for (const g of [body, head, armL, armR, legL, legR]) mergeByMaterial(g, phone);
    root.visible = false;
    return { root, body, head, legL, legR, armL, armR, phone, mats, agent: null, phase: 0 };
  }

  private dress(m: Model, a: Agent): void {
    const r = (k: number) => (a.look * 9301 * (k + 1) + 0.137 * k) % 1;
    m.mats.skin.color.set(pick(SKINS, r(1)));
    m.mats.top.color.set(pick(TOPS, r(2)));
    m.mats.bottom.color.set(pick(BOTTOMS, r(3)));
    m.mats.hair.color.set(pick(HAIRS, r(4)));
    m.root.scale.setScalar(0.9 + r(5) * 0.18);
  }

  update(dt: number, camera: THREE.Vector3, cameraYaw: number, lightsOn: number, cars: readonly Vehicleish[]): void {
    this.time += dt;
    this.listener.copy(camera);
    this.listenerYaw = cameraYaw;
    const home = lightsOn > 0.6;
    // Simulate the agents near the camera; rank them for the pool of bodies.
    const near: { a: Agent; d: number }[] = [];
    for (const a of this.agents) {
      const d = Math.hypot(a.x - camera.x, a.z - camera.z);
      if (d > SIM_R) continue;
      stepAgent(a, dt, cars, this.hooks);
      const visible = !(home && !a.nightOwl && a.state !== 'ragdoll' && a.state !== 'down') && a.state !== 'hide';
      if (visible && d < SHOW_R) near.push({ a, d });
    }
    near.sort((p, q) => p.d - q.d);
    const wanted = new Set(near.slice(0, this.pool.length).map((n) => n.a));
    // Keep the bodies of agents still wanted; free the rest; give free bodies to the new ones.
    const free: Model[] = [];
    for (const m of this.pool) {
      if (m.agent && wanted.has(m.agent)) wanted.delete(m.agent);
      else {
        m.agent = null;
        m.root.visible = false;
        free.push(m);
      }
    }
    for (const a of wanted) {
      const m = free.pop();
      if (!m) break;
      m.agent = a;
      this.dress(m, a);
      m.root.visible = true;
    }
    for (const m of this.pool) if (m.agent) this.pose(m, m.agent, dt);
  }

  /** Procedural animation: walk, run, idle (breathing, looking around), phone, sit, ragdoll, lying. */
  private pose(m: Model, a: Agent, dt: number): void {
    const gy = this.world.heightAt(a.x, a.z);
    m.root.position.set(a.x, gy + a.y, a.z);
    m.root.rotation.set(0, a.heading, 0);
    m.phone.visible = a.state === 'phone';
    let legL = 0,
      legR = 0,
      armL = 0,
      armR = 0,
      lean = 0,
      headX = 0,
      headY = 0,
      bob = 0,
      bodyY = 0.95;
    const t = this.time;
    switch (a.state) {
      case 'walk':
      case 'return': {
        m.phase += dt * a.speed * 4.2;
        const s = Math.sin(m.phase) * 0.55;
        legL = s;
        legR = -s;
        armL = -s * 0.8;
        armR = s * 0.8;
        bob = Math.abs(Math.cos(m.phase)) * 0.03;
        break;
      }
      case 'flee':
      case 'panic': {
        m.phase += dt * 11;
        const s = Math.sin(m.phase) * 0.95;
        legL = s;
        legR = -s;
        armL = -s;
        armR = s;
        lean = 0.25;
        bob = Math.abs(Math.cos(m.phase)) * 0.06;
        if (a.state === 'panic') armL = armR = -2.6 + Math.sin(m.phase) * 0.2; // hands over the head
        break;
      }
      case 'idle':
        headY = Math.sin(t * 0.7 + a.look * 10) * 0.6;
        bob = Math.sin(t * 2 + a.look * 5) * 0.008;
        armL = armR = 0.05;
        break;
      case 'phone':
        armR = -1.25;
        headX = 0.45;
        bob = Math.sin(t * 2 + a.look * 5) * 0.006;
        break;
      case 'sit':
        legL = legR = -1.45;
        armL = armR = -0.35;
        lean = -0.08;
        bodyY = 0.53;
        headY = Math.sin(t * 0.4 + a.look * 7) * 0.4;
        break;
      case 'ragdoll': {
        // Tumbling with flailing limbs.
        lean = a.tumble;
        legL = Math.sin(t * 17) * 1.2;
        legR = Math.cos(t * 15) * 1.2;
        armL = -2 + Math.sin(t * 19) * 1.3;
        armR = -2 + Math.cos(t * 21) * 1.3;
        break;
      }
      case 'down':
        lean = -1.5;
        bodyY = 0.22;
        armL = -0.4;
        armR = 0.3;
        legL = 0.15;
        legR = -0.1;
        break;
    }
    const k = Math.min(1, dt * 14);
    m.legL.rotation.x += (legL - m.legL.rotation.x) * (a.state === 'ragdoll' ? 1 : k);
    m.legR.rotation.x += (legR - m.legR.rotation.x) * (a.state === 'ragdoll' ? 1 : k);
    m.armL.rotation.x += (armL - m.armL.rotation.x) * (a.state === 'ragdoll' ? 1 : k);
    m.armR.rotation.x += (armR - m.armR.rotation.x) * (a.state === 'ragdoll' ? 1 : k);
    m.head.rotation.x += (headX - m.head.rotation.x) * k;
    m.head.rotation.y += (headY - m.head.rotation.y) * Math.min(1, dt * 3);
    m.body.rotation.x = a.state === 'ragdoll' ? lean : m.body.rotation.x + (lean - m.body.rotation.x) * Math.min(1, dt * 8);
    m.body.position.y = bodyY + bob;
  }
}

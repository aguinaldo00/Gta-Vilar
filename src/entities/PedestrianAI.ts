/**
 * The brain of a townsperson, kept free of rendering so it can be tested:
 * a small state machine over a 2D position.
 *
 *  walk   along a route (sidewalks, paths, the square), easy pace
 *  idle   standing, looking around (a chat, a shop window)
 *  phone  standing, looking at the phone
 *  sit    on a bench
 *  flee   running away from a car coming fast (then back to the route)
 *  panic  running to shelter (gunfire, a chase): `panicAt`
 *  hide   in shelter, out of sight for a while
 *  ragdoll  hit by a car: thrown through the air, tumbling
 *  down   lying on the ground after the hit, then gets up angry
 *  return walking back to the route after a fright
 */
export type PedState = 'walk' | 'idle' | 'phone' | 'sit' | 'flee' | 'panic' | 'hide' | 'ragdoll' | 'down' | 'return';

/** Voice reactions (hooks for the recorded lines in public/config/audio.json). */
export type VoiceKind = 'susto' | 'cuidado' | 'insulto' | 'dolor' | 'panico' | 'saludo';

export interface Route {
  pts: [number, number][];
  len: number[];
  /** Offset to the sidewalk from the centre line (0 on footways). */
  side: number;
}

export interface Vehicleish {
  x: number;
  z: number;
  vx: number;
  vz: number;
  speed: number;
  impact: number;
  readonly radius: number;
}

export interface Agent {
  x: number;
  z: number;
  /** Height above the ground (ragdoll). */
  y: number;
  heading: number;
  state: PedState;
  timer: number;
  route: Route | null;
  s: number;
  dir: 1 | -1;
  sideSign: 1 | -1;
  speed: number;
  /** Look: a seed for clothes and build. */
  look: number;
  nightOwl: boolean;
  /** Ragdoll motion. */
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  tumble: number;
  /** Where to run (flee / panic). */
  tx: number;
  tz: number;
  /** Seat (sit). */
  seat?: { x: number; z: number; rot: number };
}

export const WALK = 1.25;
export const RUN = 5.2;
/** A car this fast (m/s) this close (m) frightens people. */
const SCARY_SPEED = 7;
const SCARY_DIST = 10;
const GRAVITY = 18;

export function pointOnRoute(r: Route, s: number): { x: number; z: number; dx: number; dz: number } {
  const L = r.len;
  let i = 1;
  while (i < L.length - 1 && L[i] < s) i++;
  const a = r.pts[i - 1],
    b = r.pts[i];
  const seg = L[i] - L[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (s - L[i - 1]) / seg));
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / seg, dz: (b[1] - a[1]) / seg };
}

/** Where on its route an agent should be (sidewalk offset to the right of travel). */
export function routeTarget(a: Agent): { x: number; z: number; fx: number; fz: number } {
  const r = a.route!;
  const q = pointOnRoute(r, a.s);
  const fx = q.dx * a.dir,
    fz = q.dz * a.dir;
  const off = r.side ? r.side : 0.6 * a.sideSign;
  return { x: q.x - fz * off, z: q.z + fx * off, fx, fz };
}

export interface AIHooks {
  voice(kind: VoiceKind, x: number, z: number): void;
  /** A shelter (doorway) near a point, for panic. */
  shelter(x: number, z: number): { x: number; z: number };
  groundAt(x: number, z: number): number;
  rnd(): number;
}

const pick = <T>(r: number, a: T[]) => a[Math.min(a.length - 1, Math.floor(r * a.length))];

/** Starts running for shelter (gunfire, a police chase...). */
export function panic(a: Agent, h: AIHooks): void {
  if (a.state === 'ragdoll' || a.state === 'down' || a.state === 'hide' || a.state === 'panic') return;
  const s = h.shelter(a.x, a.z);
  a.tx = s.x;
  a.tz = s.z;
  a.state = 'panic';
  a.timer = 25;
  h.voice('panico', a.x, a.z);
}

/** One step of an agent's behaviour. */
export function stepAgent(a: Agent, dt: number, cars: readonly Vehicleish[], h: AIHooks): void {
  // Cars: a hit throws them; a fast car coming frightens them.
  if (a.state !== 'ragdoll' && a.state !== 'hide') {
    for (const c of cars) {
      const sp = Math.abs(c.speed);
      if (sp < 1) continue;
      const dx = a.x - c.x,
        dz = a.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < c.radius * 0.6 + 0.35 && sp > 3.5) {
        // Hit: thrown along the car's motion, up, spinning.
        a.state = 'ragdoll';
        a.vx = c.vx * 1.1 + (dx / (d || 1)) * 1.5;
        a.vz = c.vz * 1.1 + (dz / (d || 1)) * 1.5;
        a.vy = 2.5 + sp * 0.28;
        a.spin = (h.rnd() - 0.5) * 14;
        a.tumble = 0;
        a.y = Math.max(a.y, 0.2);
        c.speed *= 0.82;
        c.impact = Math.max(c.impact, 3);
        h.voice('dolor', a.x, a.z);
        break;
      }
      // Speed of the car towards the person.
      const toward = (dx * c.vx + dz * c.vz) / (d || 1);
      if (
        d < SCARY_DIST &&
        sp > SCARY_SPEED &&
        toward > sp * 0.4 &&
        (a.state === 'walk' || a.state === 'idle' || a.state === 'phone' || a.state === 'sit' || a.state === 'return')
      ) {
        // Run away from the car's path: across it, to whichever side they are on.
        const nx = -c.vz / sp,
          nz = c.vx / sp;
        const side = dx * nx + dz * nz >= 0 ? 1 : -1;
        a.tx = a.x + nx * side * 7 + (dx / (d || 1)) * 3;
        a.tz = a.z + nz * side * 7 + (dz / (d || 1)) * 3;
        a.state = 'flee';
        a.timer = 2.2 + h.rnd() * 1.5;
        h.voice(h.rnd() < 0.5 ? 'susto' : 'cuidado', a.x, a.z);
      }
    }
  }

  switch (a.state) {
    case 'walk': {
      if (!a.route) break;
      a.s += a.dir * a.speed * dt;
      const end = a.route.len[a.route.len.length - 1];
      if (a.s < 0 || a.s > end) {
        a.dir = a.dir === 1 ? -1 : 1;
        a.s = Math.min(end, Math.max(0, a.s));
      }
      const t = routeTarget(a);
      a.x = t.x;
      a.z = t.z;
      a.heading = Math.atan2(t.fx, t.fz);
      // Now and then: stop to look around, or check the phone.
      if (h.rnd() < dt * 0.025) {
        a.state = h.rnd() < 0.45 ? 'phone' : 'idle';
        a.timer = 3 + h.rnd() * 9;
      }
      break;
    }
    case 'idle':
    case 'phone':
      a.timer -= dt;
      if (a.timer <= 0) a.state = a.route ? 'walk' : 'idle';
      break;
    case 'sit':
      break;
    case 'flee':
    case 'panic':
    case 'return': {
      const dx = a.tx - a.x,
        dz = a.tz - a.z;
      const d = Math.hypot(dx, dz);
      const v = a.state === 'return' ? WALK : RUN;
      if (d > 0.4) {
        const step = Math.min(d, v * dt);
        a.x += (dx / d) * step;
        a.z += (dz / d) * step;
        a.heading = Math.atan2(dx, dz);
      }
      a.timer -= dt;
      if (a.state === 'panic' && d < 1) {
        a.state = 'hide';
        a.timer = 20 + h.rnd() * 20;
      } else if (a.state === 'flee' && (a.timer <= 0 || d < 0.5)) {
        if (h.rnd() < 0.5) h.voice('insulto', a.x, a.z);
        backToRoute(a);
      } else if (a.state === 'return' && d < 0.5) {
        a.state = a.seat ? 'sit' : 'walk';
        if (a.seat) {
          a.x = a.seat.x;
          a.z = a.seat.z;
          a.heading = a.seat.rot;
        }
      } else if (a.state === 'panic' && a.timer <= 0) backToRoute(a);
      break;
    }
    case 'hide':
      a.timer -= dt;
      if (a.timer <= 0) backToRoute(a);
      break;
    case 'ragdoll': {
      a.vy -= GRAVITY * dt;
      a.x += a.vx * dt;
      a.z += a.vz * dt;
      a.y += a.vy * dt;
      a.tumble += a.spin * dt;
      if (a.y <= 0) {
        // Bounce and slide on the ground, losing energy.
        a.y = 0;
        if (Math.abs(a.vy) > 2.5) {
          a.vy = -a.vy * 0.3;
          a.spin *= 0.6;
        } else a.vy = 0;
        const k = Math.exp(-6 * dt);
        a.vx *= k;
        a.vz *= k;
        if (Math.hypot(a.vx, a.vz) < 0.3 && a.vy === 0) {
          a.state = 'down';
          a.timer = 5 + h.rnd() * 4;
        }
      }
      break;
    }
    case 'down':
      a.timer -= dt;
      if (a.timer <= 0) {
        h.voice(pick(h.rnd(), ['insulto', 'dolor'] as VoiceKind[]), a.x, a.z);
        a.tumble = 0;
        backToRoute(a);
      }
      break;
  }
}

/** After a fright, walk back to where they were going (or their bench). */
export function backToRoute(a: Agent): void {
  if (a.seat) {
    a.tx = a.seat.x;
    a.tz = a.seat.z;
  } else if (a.route) {
    const t = routeTarget(a);
    a.tx = t.x;
    a.tz = t.z;
  } else {
    a.state = 'idle';
    a.timer = 5;
    return;
  }
  a.state = 'return';
  a.timer = 30;
  a.y = 0;
}

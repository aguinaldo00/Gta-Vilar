import { SkeletonBuilder } from 'straight-skeleton';
import * as THREE from 'three';
import { Mesh3, offsetRing } from './Buildings';
import type { BuildContext } from './context';
import { type Pt, signedArea, toPts, triangulate } from './geo';
import type { MapRoof } from './mapData';

/** Eaves overhang (alero) beyond the walls, m. */
const OVERHANG = 0.35;
/** Linear value of the neutral tile texture's 50 % grey (sRGB 0.5): roof colours are divided by it. */
const TEX_MEAN = new THREE.Color().setRGB(0.5, 0.5, 0.5, THREE.SRGBColorSpace).r;
const DEFAULT_TILE = 0xa0583a;
/** Metres per texture repeat of the roof tiles (16 rows of tiles). */
const TILE_REPEAT = 4;

/** Drops near-duplicate, collinear and spike vertices: degenerate input is what breaks straight skeletons. */
export function cleanRing(r: Pt[], minLen: number, minAngle: number): Pt[] {
  const pts = r.slice();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const p = pts[(i + pts.length - 1) % pts.length],
        c = pts[i],
        n = pts[(i + 1) % pts.length];
      const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]),
        l2 = Math.hypot(n[0] - c[0], n[1] - c[1]);
      const cross = ((c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0])) / (l1 * l2 || 1);
      const dot = ((c[0] - p[0]) * (n[0] - c[0]) + (c[1] - p[1]) * (n[1] - c[1])) / (l1 * l2 || 1);
      if (l1 < minLen || (Math.abs(cross) < Math.sin(minAngle) && dot > 0) || dot < -0.995) {
        pts.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return pts;
}

/** One planar face of a hip roof: its polygon and the eave line its height is measured from. */
export interface RoofFace {
  poly: Pt[];
  /** Eave edge (start, end). */
  a: Pt;
  b: Pt;
}

const polyArea = (p: Pt[]) => Math.abs(signedArea(p));

/**
 * Straight skeleton of a polygon (outer CCW or CW, holes optional) as roof
 * faces, or null. Retries with progressively cleaned outlines and a tiny
 * jitter, and rejects results whose faces do not tile the outline.
 */
export function skeletonFaces(outer: Pt[], holes: Pt[][] = []): RoofFace[] | null {
  const area = polyArea(outer) - holes.reduce((s, h) => s + polyArea(h), 0);
  for (const [minLen, minAngle] of [
    [0.25, 0.02],
    [0.6, 0.06],
    [1.0, 0.12],
  ]) {
    const o = cleanRing(outer, minLen, minAngle);
    const hs = holes.map((h) => cleanRing(h, minLen, minAngle)).filter((h) => h.length >= 3 && polyArea(h) > 1);
    if (o.length < 3) return null;
    for (const jitter of [0, 0.013]) {
      const j = (r: Pt[]) => r.map(([x, z], k): [number, number] => [x + jitter * Math.sin(k * 1.7), z + jitter * Math.cos(k * 2.3)]);
      try {
        const sk = SkeletonBuilder.BuildFromGeoJSON([[j(o), ...hs.map(j)]]);
        const faces: RoofFace[] = [];
        let sum = 0;
        for (const e of sk.Edges) {
          const poly = e.Polygon.map((v): Pt => [v.X, v.Y]);
          sum += polyArea(poly);
          faces.push({ poly, a: [e.Edge.Begin.X, e.Edge.Begin.Y], b: [e.Edge.End.X, e.Edge.End.Y] });
        }
        if (Math.abs(sum - area) / area < 0.02) return faces;
      } catch {
        // Degenerate configuration: try a cleaner outline.
      }
    }
  }
  return null;
}

/** Distance from p to the line through a-b. */
function lineDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  return Math.abs(dx * (p[1] - a[1]) - dz * (p[0] - a[0])) / (Math.hypot(dx, dz) || 1);
}

/** Sutherland–Hodgman clip of a polygon to the side of the iso-line f(p) = 0 where f ≤ 0 (keepBelow) or ≥ 0. */
function clipBy(poly: Pt[], f: (p: Pt) => number, keepBelow: boolean): Pt[] {
  const out: Pt[] = [];
  const inside = (v: number) => (keepBelow ? v <= 0 : v >= 0);
  for (let i = 0; i < poly.length; i++) {
    const c = poly[i],
      p = poly[(i + poly.length - 1) % poly.length];
    const fc = f(c),
      fp = f(p);
    if (inside(fc)) {
      if (!inside(fp)) out.push(lerp(p, c, fp / (fp - fc)));
      out.push(c);
    } else if (inside(fp)) out.push(lerp(p, c, fp / (fp - fc)));
  }
  return out;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function triangulateFace(poly: Pt[]): Pt[][] {
  if (poly.length < 3) return [];
  const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
  return THREE.ShapeUtils.triangulateShape(contour, []).map(([a, b, c]) => [poly[a], poly[b], poly[c]]);
}

/**
 * Hip roof over an outline: every face rises from its eave edge with slope
 * `s` (m per m) and is cut flat at `rise` above the eaves (the measured
 * ridge), so deep blocks get a flat centre instead of a towering pyramid.
 * Adds the sloped faces to `tiles` and the flat parts to `flat`.
 */
export function hipRoof(tiles: Mesh3, flat: Mesh3, faces: RoofFace[], eave: number, s: number, rise: number, color: THREE.Color): void {
  const cap = rise / s;
  const tileColor = color.clone().multiplyScalar(1 / TEX_MEAN);
  for (const { poly, a, b } of faces) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tx = (b[0] - a[0]) / len,
      tz = (b[1] - a[1]) / len;
    const d = (p: Pt) => lineDist(p, a, b);
    const slopeLen = Math.sqrt(1 + s * s);
    // Tile rows run along the eaves; texture v goes up the slope.
    const uv = (p: Pt) => [((p[0] - a[0]) * tx + (p[1] - a[1]) * tz) / TILE_REPEAT, (d(p) * slopeLen) / TILE_REPEAT];
    const sloped = clipBy(poly, (p) => d(p) - cap, true);
    for (const [p, q, r] of triangulateFace(sloped)) {
      const P = [p[0], eave + d(p) * s, p[1]],
        Q = [q[0], eave + d(q) * s, q[1]],
        R = [r[0], eave + d(r) * s, r[1]];
      tiles.tri(P, Q, R, uv(p), uv(q), uv(r), [0, 1, 0], tileColor);
    }
    const top = clipBy(poly, (p) => d(p) - cap, false);
    for (const [p, q, r] of triangulateFace(top)) {
      const y = eave + rise;
      flat.tri([p[0], y, p[1]], [q[0], y, q[1]], [r[0], y, r[1]], [0, 0], [0, 0], [0, 0], [0, 1, 0], color);
    }
  }
}

/** Flat terrace over an outline (with courtyards). */
export function flatRoof(m: Mesh3, outer: Pt[], holes: Pt[][], y: number, color: THREE.Color): void {
  for (const [p, q, r] of triangulate(outer, holes)) {
    m.tri([p[0], y, p[1]], [q[0], y, q[1]], [r[0], y, r[1]], [0, 0], [0, 0], [0, 0], [0, 1, 0], color);
  }
}

function roofColor(r: MapRoof): THREE.Color {
  return new THREE.Color().setHex(r.c ?? DEFAULT_TILE, THREE.SRGBColorSpace);
}

/**
 * Roofs baked by tools/geodata/roofs.py: one per row of buildings that share
 * their eaves, with the pitch, ridge and colour measured from the LiDAR and
 * the orthophoto. The walls of the buildings underneath stop at the eaves.
 */
export function buildRoofs(ctx: BuildContext): { hipped: number; flat: number; fallback: number } {
  const stats = { hipped: 0, flat: 0, fallback: 0 };
  for (const r of ctx.map.roofs ?? []) {
    const tiles = new Mesh3();
    const flat = new Mesh3();
    let outer = toPts(r.o);
    if (signedArea(outer) < 0) outer = outer.slice().reverse();
    const holes = (r.h ?? []).map(toPts).map((h) => (signedArea(h) > 0 ? h.slice().reverse() : h));
    const color = roofColor(r);
    if (r.s > 0) {
      // A small overhang beyond the walls, as on the real houses (the eaves drop accordingly).
      const eaveRing = offsetRing(outer, OVERHANG) ?? outer;
      const drop = eaveRing === outer ? 0 : OVERHANG * r.s;
      const faces = skeletonFaces(eaveRing, holes) ?? (eaveRing !== outer ? skeletonFaces(outer, holes) : null);
      if (faces) {
        hipRoof(tiles, flat, faces, r.e - drop, r.s, r.r + drop, color);
        stats.hipped++;
      } else {
        // The rare outline no skeleton survives: a flat roof at the eaves rather than a broken one.
        flatRoof(flat, outer, holes, r.e, color);
        stats.fallback++;
      }
    } else {
      flatRoof(flat, outer, holes, r.e, color);
      stats.flat++;
    }
    if (!tiles.empty) ctx.batch.addWorld(tiles.geometry(), ctx.mats.roofTintVC);
    if (!flat.empty) ctx.batch.addWorld(flat.geometry(), ctx.mats.propsVC);
  }
  return stats;
}

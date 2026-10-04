import { Layer } from '../physics/PhysicsWorld';
import { LocalBatch } from './Batcher';
import type { BuildContext } from './context';
import { orientedBox, type Pt } from './geo';
import { Unit } from './props';

/** Terrace step: tread depth and riser height (m). */
const TREAD = 0.8;
const RISER = 0.4;

/**
 * Covered grandstand on its real footprint (OSM / LiDAR), as at the two
 * football pitches by the Nela: concrete terraces rising away from the pitch
 * with a bench on each, a back wall, side walls following the steps, and a
 * roof sloping to the back at the measured height `h`, held by columns along
 * the back and a few slim posts at the front on the low stands.
 * `face` is a point on the pitch the seats look at.
 */
export function grandstand(ctx: BuildContext, ring: Pt[], ground: number, h: number, face?: [number, number], roof = '#c4c8ca'): void {
  const o = orientedBox(ring);
  // Local frame: x along the stand, z across it; +z points at the pitch.
  let rot = o.angle,
    L = o.w,
    D = o.d;
  if (D > L) {
    rot += Math.PI / 2;
    [L, D] = [D, L];
  }
  let lb = new LocalBatch(ctx.batch, o.cx, ground, o.cz, rot);
  if (face) {
    const [fx, fz] = lb.point(0, D / 2),
      [bx, bz] = lb.point(0, -D / 2);
    if (Math.hypot(face[0] - fx, face[1] - fz) > Math.hypot(face[0] - bx, face[1] - bz)) {
      rot += Math.PI;
      lb = new LocalBatch(ctx.batch, o.cx, ground, o.cz, rot);
    }
  }
  const { mats, collision } = ctx;
  const concrete = mats.concrete;
  const seat = mats.tint('#e8e6e0');
  const steel = mats.tint('#5b6066');
  const roofMat = mats.tint(roof);

  // Terraces: a front walkway, then rows to just short of the back wall, as tall as the roof allows.
  const walk = Math.min(1.2, D * 0.18);
  const usable = D - walk - 0.3;
  const rows = Math.max(2, Math.min(Math.floor(usable / TREAD), Math.floor((h - 2.4) / RISER)));
  const tread = usable / rows;
  const front = D / 2 - walk;
  for (let r = 0; r < rows; r++) {
    const top = (r + 1) * RISER;
    const z1 = front - r * tread;
    const zc = (z1 + -D / 2 + 0.3) / 2;
    const depth = z1 - (-D / 2 + 0.3);
    // Each step as a solid block from the ground to its tread (the later, taller ones hide the inside).
    lb.add(Unit.box, concrete, 0, top / 2 - 0.3, zc, 0, L - 0.5, top + 0.6, depth);
    // Bench along the step, set back from the edge.
    lb.add(Unit.box, seat, 0, top + 0.4, z1 - tread * 0.55, 0, L - 1.2, 0.06, 0.34);
    for (let x = -L / 2 + 1.2; x <= L / 2 - 1.2; x += 2.4) lb.add(Unit.box, steel, x, top + 0.2, z1 - tread * 0.55, 0, 0.06, 0.4, 0.06);
    const [wx, wz] = lb.point(0, zc);
    collision.addBox(wx, wz, L - 0.5, depth, { rot, bottom: -0.3, top, mask: Layer.Solid });
  }
  const topStep = rows * RISER;
  // Back wall up to the roof, side walls along the profile of the steps.
  lb.add(Unit.box, concrete, 0, h / 2 - 0.3, -D / 2 + 0.15, 0, L, h + 0.6, 0.3);
  const [bwx, bwz] = lb.point(0, -D / 2 + 0.15);
  collision.addBox(bwx, bwz, L, 0.3, { rot, bottom: -0.3, top: h, mask: Layer.Solid });
  for (const sx of [-L / 2 + 0.12, L / 2 - 0.12]) {
    for (let r = 0; r < rows; r++) {
      const z1 = front - r * tread;
      lb.add(Unit.box, concrete, sx, (r + 1) * RISER + 0.5 - 0.3, z1 - tread / 2, 0, 0.24, (r + 1) * RISER + 1.6, tread);
    }
    const [sx0, sz0] = lb.point(sx, (front - D / 2) / 2);
    collision.addBox(sx0, sz0, 0.24, front + D / 2, { rot, bottom: -0.3, top: topStep + 1, mask: Layer.Solid });
  }

  // Roof: from the top of the back wall, sloping up a little towards the pitch, overhanging the front.
  const over = 0.8;
  const zFront = D / 2 + over,
    zBack = -D / 2;
  const yBack = h - 0.25,
    yFront = h;
  const len = Math.hypot(zFront - zBack, yFront - yBack);
  const pitch = Math.atan2(yFront - yBack, zFront - zBack);
  lb.add(Unit.box, roofMat, 0, (yBack + yFront) / 2, (zFront + zBack) / 2, 0, L + 0.6, 0.12, len, -pitch);
  // Fascia along the front edge.
  lb.add(Unit.box, roofMat, 0, yFront - 0.2, zFront, 0, L + 0.6, 0.45, 0.06);
  // Columns: along the back every ~5 m; slim front posts only where the roof is low (short span).
  const n = Math.max(1, Math.round(L / 5));
  for (let k = 0; k <= n; k++) {
    const x = -L / 2 + 0.3 + ((L - 0.6) * k) / n;
    lb.add(Unit.box, steel, x, h / 2, -D / 2 + 0.45, 0, 0.22, h, 0.22);
    // Cantilever beam under the roof.
    lb.add(Unit.box, steel, x, (yBack + yFront) / 2 - 0.2, (zFront + zBack) / 2, 0, 0.14, 0.3, len, -pitch);
    if (h < 5) {
      lb.add(Unit.cyl, steel, x, h / 2, D / 2 - 0.2, 0, 0.1, h, 0.1);
      const [px, pz] = lb.point(x, D / 2 - 0.2);
      collision.addCircle(px, pz, 0.1, { top: h, mask: Layer.Solid });
    }
  }
  // Rail along the front of the walkway (gap in the middle to get in).
  for (const side of [-1, 1]) {
    const x0 = side * 1.2,
      x1 = side * (L / 2 - 0.2);
    const cx = (x0 + x1) / 2,
      w = Math.abs(x1 - x0);
    lb.add(Unit.box, steel, cx, 1.0, D / 2 - 0.05, 0, w, 0.05, 0.05);
    lb.add(Unit.box, steel, cx, 0.55, D / 2 - 0.05, 0, w, 0.04, 0.04);
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1) + 0.01; x += 2) lb.add(Unit.box, steel, x, 0.5, D / 2 - 0.05, 0, 0.05, 1.0, 0.05);
    const [rx, rz] = lb.point(cx, D / 2 - 0.05);
    collision.addBox(rx, rz, w, 0.1, { rot, top: 1.05, mask: Layer.Bodies });
  }
}

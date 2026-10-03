/** Minimap draw layers, painted in ascending order. */
export const MapLayer = {
  Ground: 0,
  Water: 1,
  Road: 2,
  Block: 3,
  Building: 4,
  Landmark: 5,
} as const;

export type SketchOp =
  | { kind: 'rect'; layer: number; x0: number; z0: number; x1: number; z1: number; color: string }
  | { kind: 'circle'; layer: number; x: number; z: number; r: number; color: string }
  | { kind: 'poly'; layer: number; pts: number[]; color: string; stroke?: number };

/** World builders record a 2D top-down sketch of what they create; the minimap replays it. */
export class MapSketch {
  readonly ops: SketchOp[] = [];

  rect(layer: number, x0: number, z0: number, x1: number, z1: number, color: string): void {
    this.ops.push({ kind: 'rect', layer, x0, z0, x1, z1, color });
  }

  circle(layer: number, x: number, z: number, r: number, color: string): void {
    this.ops.push({ kind: 'circle', layer, x, z, r, color });
  }

  /** Filled polygon, or a polyline when `stroke` (width in metres) is given. */
  poly(layer: number, pts: number[], color: string, stroke?: number): void {
    this.ops.push({ kind: 'poly', layer, pts, color, stroke });
  }
}

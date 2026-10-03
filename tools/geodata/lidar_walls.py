"""
Low thin structures (garden walls, fences, hedges) from the PNOA-LiDAR point
cloud, on a 0.5 m grid.

    python3 tools/geodata/lidar_walls.py raw/lidar raw/derived/lidar_1m.npz raw/derived/lidar_walls.npz

PNOA leaves plot walls and fences unclassified (1) or files them as low and
medium vegetation (3, 4): in residential areas every property boundary shows
up as a thin line of such points 0.4-3 m above the ground. This keeps, per
0.5 m cell, the number of those points and their highest one; the map baker
turns the thin, straight runs into wall and fence polylines
(bake_terrain_buildings.py, walls.py).

Outputs: count (uint8), unclassified (uint8: of those, class 1 points, which
are mostly cars and street furniture rather than walls or hedges), top (float16, m above ground), high (bool: class 5
high vegetation, i.e. tree crowns), x0, y1, cell.
"""

import glob
import os
import sys

import laspy
import numpy as np

CELL = 0.5
LOW, HIGH = 0.35, 3.2  # m above ground


def main(src, lidar_1m, out):
    lid = np.load(lidar_1m)
    gx0, gy1, gcell = float(lid["x0"]), float(lid["y1"]), float(lid["cell"])
    dtm = lid["dtm"]
    W = int(dtm.shape[1] * gcell / CELL)
    H = int(dtm.shape[0] * gcell / CELL)
    count = np.zeros(W * H, np.uint16)
    unclassified = np.zeros(W * H, np.uint16)
    top = np.zeros(W * H, np.float32)
    high = np.zeros(W * H, bool)
    for p in sorted(glob.glob(os.path.join(src, "*.laz"))):
        las = laspy.read(p)
        x, y, z = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
        c = np.asarray(las.classification)
        gc = np.clip(((x - gx0) / gcell).astype(np.int64), 0, dtm.shape[1] - 1)
        gr = np.clip(((gy1 - y) / gcell).astype(np.int64), 0, dtm.shape[0] - 1)
        h = z - dtm[gr, gc]
        col = np.clip(((x - gx0) / CELL).astype(np.int64), 0, W - 1)
        row = np.clip(((gy1 - y) / CELL).astype(np.int64), 0, H - 1)
        idx = row * W + col
        low = np.isin(c, (1, 3, 4)) & (h > LOW) & (h < HIGH)
        np.add.at(count, idx[low], 1)
        np.add.at(unclassified, idx[low & (c == 1)], 1)
        np.maximum.at(top, idx[low], h[low].astype(np.float32))
        high[idx[c == 5]] = True
        print(f"  {os.path.basename(p)}: {low.sum():,} low points")
    np.savez_compressed(
        out,
        count=np.minimum(count, 255).astype(np.uint8).reshape(H, W),
        unclassified=np.minimum(unclassified, 255).astype(np.uint8).reshape(H, W),
        top=top.astype(np.float16).reshape(H, W),
        high=high.reshape(H, W),
        x0=gx0,
        y1=gy1,
        cell=CELL,
    )
    print(f"-> {out} ({W}x{H} cells of {CELL} m)")


if __name__ == "__main__":
    main(*sys.argv[1:4])

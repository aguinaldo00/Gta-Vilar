"""
PNOA-LiDAR (classified LAZ, ETRS89 / UTM 30N) -> 1 m rasters for the game baker.

    python3 tools/geodata/lidar_rasters.py raw/lidar raw/derived/lidar_1m.npz

Outputs (north-up rows, i.e. row 0 = northern edge, column 0 = western edge):
  dtm   ground height (class 2 mean), holes filled from the nearest ground
  dsm   surface height (max of every non-noise return)
  bld   roof height where class 6 (building) points exist, NaN elsewhere
  veg   canopy height where class 5 (high vegetation) points exist, NaN elsewhere
  ground_n  number of ground points per cell (0 = filled)
plus the grid origin and extent.
"""

import glob
import os
import sys

import laspy
import numpy as np
from scipy import ndimage

CELL = 1.0
NOISE = {7, 18}


def tile_bounds(paths):
    xs, ys = [], []
    for p in paths:
        with laspy.open(p) as f:
            h = f.header
            xs += [h.mins[0], h.maxs[0]]
            ys += [h.mins[1], h.maxs[1]]
    return np.floor(min(xs)), np.floor(min(ys)), np.ceil(max(xs)), np.ceil(max(ys))


def main(src, out):
    paths = sorted(glob.glob(os.path.join(src, "*.laz")))
    x0, y0, x1, y1 = tile_bounds(paths)
    w, h = int((x1 - x0) / CELL), int((y1 - y0) / CELL)
    print(f"grid {w}x{h} m, E {x0}-{x1}, N {y0}-{y1}")
    gsum = np.zeros(w * h)
    gcnt = np.zeros(w * h)
    dsm = np.full(w * h, -np.inf)
    bld = np.full(w * h, -np.inf)
    veg = np.full(w * h, -np.inf)
    for p in paths:
        las = laspy.read(p)
        x, y, z = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
        c = np.asarray(las.classification)
        keep = ~np.isin(c, list(NOISE))
        x, y, z, c = x[keep], y[keep], z[keep], c[keep]
        col = np.clip(((x - x0) / CELL).astype(np.int64), 0, w - 1)
        row = np.clip(((y1 - y) / CELL).astype(np.int64), 0, h - 1)
        idx = row * w + col
        g = c == 2
        np.add.at(gsum, idx[g], z[g])
        np.add.at(gcnt, idx[g], 1)
        np.maximum.at(dsm, idx, z)
        b = c == 6
        np.maximum.at(bld, idx[b], z[b])
        v = c == 5
        np.maximum.at(veg, idx[v], z[v])
        print(f"  {os.path.basename(p)}: {len(z):,} points ({b.sum():,} building, {g.sum():,} ground)")

    shape = (h, w)
    with np.errstate(invalid="ignore", divide="ignore"):
        dtm = (gsum / gcnt).reshape(shape)
    gcnt = gcnt.reshape(shape)
    # Fill cells without ground points (under roofs, water, missing tiles) from the nearest ground cell,
    # then smooth only the filled cells so the fill does not look terraced.
    missing = gcnt == 0
    _, (ri, ci) = ndimage.distance_transform_edt(missing, return_indices=True)
    filled = dtm[ri, ci]
    smooth = ndimage.uniform_filter(filled, size=5)
    dtm = np.where(missing, smooth, dtm).astype(np.float32)

    def finite(a):
        a = a.reshape(shape).astype(np.float32)
        a[~np.isfinite(a)] = np.nan
        return a

    os.makedirs(os.path.dirname(out), exist_ok=True)
    np.savez_compressed(
        out,
        dtm=dtm,
        dsm=finite(dsm),
        bld=finite(bld),
        veg=finite(veg),
        ground_n=gcnt.astype(np.uint16),
        x0=x0,
        y1=y1,
        cell=CELL,
    )
    print(f"-> {out}  DTM {np.nanmin(dtm):.1f}..{np.nanmax(dtm):.1f} m, {missing.mean() * 100:.1f}% cells filled")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

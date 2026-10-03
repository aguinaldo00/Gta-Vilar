"""
Bakes the real relief and building volumes into the game map.

    python3 tools/geodata/bake_terrain_buildings.py \
        public/maps/villarcayo.json raw/derived/lidar_1m.npz raw/ign/mdt5.tif

Inputs
  map JSON   from scripts/osm-to-map.ts (OSM in ETRS89 / UTM 30N, local origin)
  LiDAR npz  from tools/geodata/lidar_rasters.py (1 m DTM / roofs, PNOA-LiDAR)
  MDT5 tif   IGN 5 m elevation model (fills what the LiDAR tiles do not cover)

Writes
  public/maps/villarcayo.terrain.png   16-bit heights (cm, relative to the plaza) on a 2 m grid, see heightpng.py
  map JSON                             + meta.terrain, building ground/eave/top heights
                                       (LiDAR), buildings missing from OSM, river surface levels

Local frame: x = E - E0 (east), z = N0 - N (south), y = height - H0 (H0 = ground at the origin).
"""

import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import measure

from heightpng import write_height_png

TERRAIN_CELL = 2  # m, runtime heightmap resolution
MIN_ROOF_CELLS = 4
NEW_BUILDING_MIN_AREA = 20  # m²
NEW_BUILDING_MIN_HEIGHT = 2.2  # m above ground


def load_inputs(map_path, lidar_path, mdt_path):
    m = json.load(open(map_path))
    lid = np.load(lidar_path)
    mdt = Image.open(mdt_path)
    tie = mdt.tag_v2[33922]  # (i, j, k, E, N, 0) of the top-left corner
    scale = mdt.tag_v2[33550]
    return m, lid, np.array(mdt).astype(np.float32), (tie[3], tie[4], scale[0])


def game_grid(m):
    """1 m grid over the map bounds; cell (r, c) centre = (minX + c + .5, minZ + r + .5)."""
    b = m["meta"]["bounds"]
    return b["minX"], b["minZ"], int(b["maxX"] - b["minX"]), int(b["maxZ"] - b["minZ"])


def merged_dtm(m, lid, mdt, mdt_geo):
    """Ground height (absolute, m) on the 1 m game grid: LiDAR where available, MDT5 elsewhere, blended."""
    E0, N0 = m["meta"]["utmOrigin"]["E"], m["meta"]["utmOrigin"]["N"]
    minX, minZ, W, H = game_grid(m)
    E = E0 + minX + np.arange(W) + 0.5
    N = N0 - (minZ + np.arange(H) + 0.5)
    EE, NN = np.meshgrid(E, N)

    # MDT5 (integer metres) bilinearly sampled, then smoothed to remove the 1 m terracing.
    me, mn, ms = mdt_geo
    fc = (EE - me) / ms - 0.5
    fr = (mn - NN) / ms - 0.5
    base = ndimage.map_coordinates(ndimage.gaussian_filter(mdt, 1.2), [fr, fc], order=1, mode="nearest")

    # LiDAR DTM at the same cells (only where its tiles actually had ground points nearby).
    lx0, ly1 = float(lid["x0"]), float(lid["y1"])
    dtm, gn = lid["dtm"], lid["ground_n"]
    lc = np.floor(EE - lx0).astype(int)
    lr = np.floor(ly1 - NN).astype(int)
    inside = (lc >= 0) & (lc < dtm.shape[1]) & (lr >= 0) & (lr < dtm.shape[0])
    lidar = np.full(EE.shape, np.nan, np.float32)
    lidar[inside] = dtm[lr[inside], lc[inside]]
    # Covered = within 15 m of a real ground return (excludes the missing NW tile and the outside).
    has = np.zeros(EE.shape, bool)
    has[inside] = gn[lr[inside], lc[inside]] > 0
    covered = ndimage.binary_dilation(has, iterations=15) & inside
    # Feather the seam over 25 m.
    w = np.clip(ndimage.distance_transform_edt(covered) / 25.0, 0, 1)
    out = np.where(covered, w * np.nan_to_num(lidar) + (1 - w) * base, base)
    return out.astype(np.float32), covered


def lidar_on_grid(m, lid, key):
    E0, N0 = m["meta"]["utmOrigin"]["E"], m["meta"]["utmOrigin"]["N"]
    minX, minZ, W, H = game_grid(m)
    lx0, ly1 = float(lid["x0"]), float(lid["y1"])
    src = lid[key]
    c0 = int(E0 + minX - lx0)
    r0 = int(ly1 - (N0 - minZ))
    out = np.full((H, W), np.nan, np.float32)
    # Overlap of the two grids (both integer-aligned).
    rs, cs = max(0, -r0), max(0, -c0)
    re, ce = min(H, src.shape[0] - r0), min(W, src.shape[1] - c0)
    if re > rs and ce > cs:
        out[rs:re, cs:ce] = src[r0 + rs : r0 + re, c0 + cs : c0 + ce]
    return out


def polygon_mask(coords, minX, minZ, W, H, pad=0):
    """Rasterises a flat [x, z, ...] ring on the 1 m game grid; returns (mask, r0, c0) cropped to its bbox."""
    xs, zs = coords[0::2], coords[1::2]
    c0 = max(0, int(np.floor(min(xs) - minX)) - pad - 1)
    r0 = max(0, int(np.floor(min(zs) - minZ)) - pad - 1)
    c1 = min(W, int(np.ceil(max(xs) - minX)) + pad + 2)
    r1 = min(H, int(np.ceil(max(zs) - minZ)) + pad + 2)
    if c1 <= c0 or r1 <= r0:
        return None, 0, 0
    img = Image.new("L", (c1 - c0, r1 - r0), 0)
    pts = [(x - minX - c0, z - minZ - r0) for x, z in zip(xs, zs)]
    ImageDraw.Draw(img).polygon(pts, fill=1, outline=1)
    mask = np.array(img, bool)
    if pad:
        mask = ndimage.binary_dilation(mask, iterations=pad)
    return mask, r0, c0


def measure_buildings(m, dtm, roof, H0, covered):
    minX, minZ, W, H = game_grid(m)
    footprint = np.zeros((H, W), bool)
    measured = 0
    for b in m["buildings"]:
        mask, r0, c0 = polygon_mask(b["o"], minX, minZ, W, H)
        if mask is None or not mask.any():
            continue
        sl = (slice(r0, r0 + mask.shape[0]), slice(c0, c0 + mask.shape[1]))
        footprint[sl] |= mask
        ground = dtm[sl][mask]
        # Base: low ground under the walls (buildings on slopes sit on their lowest corner).
        b["gy"] = round(float(np.percentile(ground, 10)) - H0, 2)
        if not covered[sl][mask].any():
            continue
        r = roof[sl][mask]
        r = r[np.isfinite(r)]
        if r.size < max(MIN_ROOF_CELLS, 0.25 * mask.sum()) or b.get("t") in ("canopy",):
            continue
        top = float(np.percentile(r, 95)) - H0
        eave = float(np.percentile(r, 12)) - H0
        if top - b["gy"] < 1.8:
            continue
        b["top"] = round(top, 2)
        b["eave"] = round(max(b["gy"] + 1.8, min(eave, top)), 2)
        measured += 1
    return footprint, measured


def trace_new_buildings(m, dtm, roof, footprint, H0):
    """Roof cells (LiDAR class 6) that no OSM footprint covers become new buildings."""
    minX, minZ, W, H = game_grid(m)
    ndsm = roof - dtm
    cand = np.isfinite(ndsm) & (ndsm > NEW_BUILDING_MIN_HEIGHT)
    cand &= ~ndimage.binary_dilation(footprint, iterations=2)
    cand = ndimage.binary_opening(cand, iterations=1)
    labels, n = ndimage.label(cand)
    added = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        comp = labels[sl] == i
        area = int(comp.sum())
        if area < NEW_BUILDING_MIN_AREA:
            continue
        # Reject slivers along existing walls and hedges: a real building survives a 1 m erosion.
        if ndimage.binary_erosion(comp, iterations=1).sum() < 0.4 * area:
            continue
        padded = np.pad(comp, 1).astype(float)
        contours = measure.find_contours(padded, 0.5)
        if not contours:
            continue
        ring = max(contours, key=len)
        ring = measure.approximate_polygon(ring, tolerance=0.9)
        if len(ring) < 4:
            continue
        r0, c0 = sl[0].start - 1, sl[1].start - 1
        coords = []
        for rr, cc in ring[:-1]:
            coords += [round(minX + c0 + cc + 0.5, 1), round(minZ + r0 + rr + 0.5, 1)]
        heights = ndsm[sl][comp]
        top_abs = roof[sl][comp]
        gy = float(np.percentile(dtm[sl][comp], 10)) - H0
        b = {
            "o": coords,
            "t": "industrial" if area > 450 else "house",
            "src": "lidar",
            "gy": round(gy, 2),
            "top": round(float(np.percentile(top_abs, 95)) - H0, 2),
            "eave": round(max(gy + 1.8, float(np.percentile(top_abs, 12)) - H0), 2),
        }
        if float(np.percentile(heights, 95)) < 2.5:
            continue
        added.append(b)
    m["buildings"].extend(added)
    return len(added)


def lidar_trees(m, dtm, H0):
    """Individual trees from the LiDAR canopy (class 5): crown tops become [x, z, height, crown radius]."""
    minX, minZ, W, H = game_grid(m)
    veg = lidar_on_grid(m, LIDAR, "veg")
    chm = np.where(np.isfinite(veg), veg - dtm, 0).astype(np.float32)
    chm = ndimage.gaussian_filter(chm, 1.0)
    peaks = (chm == ndimage.maximum_filter(chm, size=7)) & (chm > 4)
    # Crown radius: distance to where the canopy falls below half the tree height (capped).
    out = []
    rr, cc = np.nonzero(peaks)
    for r, c in zip(rr, cc):
        h = float(chm[r, c])
        k = 6
        win = chm[max(0, r - k) : r + k + 1, max(0, c - k) : c + k + 1]
        rad = float(np.sqrt((win > h * 0.5).sum() / np.pi))
        out += [round(minX + c + 0.5, 1), round(minZ + r + 0.5, 1), round(min(h, 32), 1), round(min(max(rad, 1.5), 7), 1)]
    m["ltrees"] = out
    return len(out) // 4


def river_levels(m, dtm, H0):
    """Water surface along each river vertex: low shoreline ground nearby, never rising downstream."""
    minX, minZ, W, H = game_grid(m)
    for r in m["rivers"]:
        p = r["p"]
        hw = r.get("w", 16) / 2
        levels = []
        for i in range(0, len(p), 2):
            c, rr = int(p[i] - minX), int(p[i + 1] - minZ)
            k = int(hw + 6)
            win = dtm[max(0, rr - k) : rr + k + 1, max(0, c - k) : c + k + 1]
            levels.append(float(np.percentile(win, 8)) if win.size else np.nan)
        lv = np.array(levels)
        lv = np.where(np.isfinite(lv), lv, np.nanmean(lv))
        lv = ndimage.median_filter(lv, size=5, mode="nearest")
        # Flow direction: whichever end is lower.
        if lv[0] < lv[-1]:
            lv = np.minimum.accumulate(lv[::-1])[::-1]
        else:
            lv = np.minimum.accumulate(lv)
        r["wl"] = [round(float(v) - H0 - 0.25, 2) for v in lv]


def carve_water(m, dtm, H0):
    """Lowers the ground under rivers and pools below their surface (the LiDAR does not see the bed)."""
    minX, minZ, W, H = game_grid(m)
    yy, xx = np.mgrid[0:H, 0:W]
    for r in m["rivers"]:
        p, h, hw = r["p"], r["wl"], r.get("w", 16) / 2
        for i in range(0, len(p) - 2, 2):
            ax, az, bx, bz = p[i] - minX - 0.5, p[i + 1] - minZ - 0.5, p[i + 2] - minX - 0.5, p[i + 3] - minZ - 0.5
            k = int(hw + 3)
            r0, r1 = int(max(0, min(az, bz) - k)), int(min(H, max(az, bz) + k + 1))
            c0, c1 = int(max(0, min(ax, bx) - k)), int(min(W, max(ax, bx) + k + 1))
            if r1 <= r0 or c1 <= c0:
                continue
            X, Z = xx[r0:r1, c0:c1], yy[r0:r1, c0:c1]
            dx, dz = bx - ax, bz - az
            L2 = dx * dx + dz * dz or 1
            t = np.clip(((X - ax) * dx + (Z - az) * dz) / L2, 0, 1)
            d = np.hypot(X - ax - t * dx, Z - az - t * dz)
            surface = h[i // 2] + (h[i // 2 + 1] - h[i // 2]) * t + H0
            depth = np.where(d < hw, 1.6 * np.cos(np.clip(d / hw, 0, 1) * np.pi / 2) ** 0.6 + 0.15, 0)
            bed = surface - depth
            sub = dtm[r0:r1, c0:c1]
            inside = d < hw
            sub[inside] = np.minimum(sub[inside], bed[inside])
            # Banks: never higher than the surface right at the water's edge.
            edge = (d >= hw) & (d < hw + 2)
            sub[edge] = np.minimum(sub[edge], np.maximum(surface[edge] + 0.15, sub[edge] - 0.4))
    for a in m["areas"]:
        if a["k"] != "water":
            continue
        mask, r0, c0 = polygon_mask(a["o"], minX, minZ, W, H)
        if mask is None:
            continue
        sl = (slice(r0, r0 + mask.shape[0]), slice(c0, c0 + mask.shape[1]))
        ring = mask & ~ndimage.binary_erosion(mask, iterations=1)
        level = float(np.percentile(dtm[sl][ring], 10))
        a["wl"] = round(level - H0 - 0.2, 2)
        inner = ndimage.distance_transform_edt(mask)
        depth = np.clip(inner / 6.0, 0, 1) * 2.2 + 0.2
        sub = dtm[sl]
        sub[mask] = np.minimum(sub[mask], (level - 0.2 - depth)[mask])


def write_terrain(m, dtm, H0, out_png):
    minX, minZ, W, H = game_grid(m)
    s = TERRAIN_CELL
    cols, rows = W // s + 1, H // s + 1
    # Sample at the grid nodes (x = minX + c*s), averaging the 1 m cells around each node.
    padded = np.pad(dtm, 1, mode="edge")
    sm = ndimage.uniform_filter(padded, size=2)[1:-1, 1:-1]
    rr = np.clip(np.arange(rows) * s, 0, H - 1)
    cc = np.clip(np.arange(cols) * s, 0, W - 1)
    grid = sm[np.ix_(rr, cc)] - H0
    q = np.clip(np.round(grid * 100), -32768, 32767).astype(np.int16)
    write_height_png(q, out_png)
    m["meta"]["terrain"] = {
        "file": os.path.basename(out_png),
        "cols": int(cols),
        "rows": int(rows),
        "cell": s,
        "minX": minX,
        "minZ": minZ,
        "scale": 0.01,
        "datum": round(float(H0), 2),
        "note": "16-bit PNG: value = R*256 + G - 32768, row-major (z rows, x columns); height = value * scale; absolute = height + datum (m, orthometric)",
    }
    return grid


LIDAR = None


def main(map_path, lidar_path, mdt_path):
    global LIDAR
    m, lid, mdt, mdt_geo = load_inputs(map_path, lidar_path, mdt_path)
    LIDAR = lid
    # Start from the OSM-only buildings (re-runs must not stack LiDAR additions).
    m["buildings"] = [b for b in m["buildings"] if b.get("src") != "lidar"]
    dtm, covered = merged_dtm(m, lid, mdt, mdt_geo)
    minX, minZ, W, H = game_grid(m)
    H0 = float(dtm[-minZ, -minX])  # ground at the local origin (Plaza Mayor)
    roof = lidar_on_grid(m, lid, "bld")
    footprint, measured = measure_buildings(m, dtm, roof, H0, covered)
    added = trace_new_buildings(m, dtm, roof, footprint, H0)
    trees = lidar_trees(m, dtm, H0)
    river_levels(m, dtm, H0)
    carve_water(m, dtm, H0)
    out_png = os.path.join(os.path.dirname(map_path), os.path.splitext(os.path.basename(map_path))[0] + ".terrain.png")
    grid = write_terrain(m, dtm, H0, out_png)
    m["meta"]["sources"] = [
        "OpenStreetMap contributors (ODbL 1.0)",
        "PNOA-LiDAR 2025 © Instituto Geográfico Nacional / Junta de Castilla y León (CC BY 4.0)",
        "MDT05 © Instituto Geográfico Nacional (CC BY 4.0)",
    ]
    json.dump(m, open(map_path, "w"), separators=(",", ":"))
    print(f"datum H0 = {H0:.2f} m; relief {grid.min():.1f} .. {grid.max():.1f} m")
    print(f"buildings measured by LiDAR: {measured}; added from LiDAR: {added}; trees from LiDAR: {trees}")
    print(f"terrain {m['meta']['terrain']['cols']}x{m['meta']['terrain']['rows']} -> {out_bin} ({os.path.getsize(out_bin) // 1024} KB)")


if __name__ == "__main__":
    main(*sys.argv[1:4])

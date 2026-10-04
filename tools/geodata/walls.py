"""
Walls, fences and hedges: OpenStreetMap barriers plus the ones the LiDAR sees.

OSM maps only a few dozen barriers in Villarcayo, but every garden and plot
boundary is visible in the point cloud as a thin line of low points
(lidar_walls.py). Those cells are skeletonised and traced into polylines, and
a run is kept only if it is:
  - long (>= MIN_LENGTH) and straight (few vertices once simplified),
  - thin (a wall or fence is < ~1 m thick; hedges up to 2.2 m),
  - away from buildings (facades and eaves), tree crowns and carriageways
    (parked cars), and not already mapped in OSM.
Height is the median of the highest points along the run.

Output: m["barriers"] = [{p: [x, z, ...], k: wall|fence|hedge|retaining_wall, h, src?: "lidar"}]
"""

import math

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage.measure import approximate_polygon
from skimage.morphology import skeletonize

MIN_LENGTH = 5.0  # m
MAX_THICK_WALL = 1.1  # m
MAX_THICK_HEDGE = 2.2
MIN_HEIGHT = 0.5
VEHICLE = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service"}
NEIGH = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def trace_paths(skel):
    """Pixel skeleton -> list of paths (arrays of (row, col)) between end points and junctions."""
    pix = set(zip(*np.nonzero(skel)))

    def nb(p):
        return [(p[0] + dr, p[1] + dc) for dr, dc in NEIGH if (p[0] + dr, p[1] + dc) in pix]

    deg = {p: len(nb(p)) for p in pix}
    nodes = {p for p, d in deg.items() if d != 2}
    seen = set()
    paths = []
    for n in nodes:
        for q in nb(n):
            if (n, q) in seen:
                continue
            path = [n, q]
            seen.add((n, q))
            seen.add((q, n))
            prev, cur = n, q
            while cur not in nodes:
                nxt = [r for r in nb(cur) if r != prev and (cur, r) not in seen]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
                seen.add((prev, cur))
                seen.add((cur, prev))
                path.append(cur)
            paths.append(np.array(path))
    # Closed loops without any node (a walled square plot).
    rest = pix - {p for path in paths for p in map(tuple, path)}
    while rest:
        start = rest.pop()
        path, prev, cur = [start], None, start
        while True:
            nxt = [r for r in nb(cur) if r != prev and r in rest]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            rest.discard(cur)
            path.append(cur)
        if len(path) > 2:
            paths.append(np.array(path + [start]))
    return paths


def line_mask(shape, lines, width):
    img = Image.new("L", (shape[1], shape[0]), 0)
    d = ImageDraw.Draw(img)
    for pts, w in lines:
        if len(pts) >= 2:
            d.line(pts, fill=1, width=max(1, int(round(w if width is None else width))))
    return np.array(img, bool)


def osm_barrier_lines(m):
    return [(b["p"], b["k"]) for b in m.get("barriers", []) if not b.get("src")]


def lidar_barriers(m, walls, building_mask_1m):
    """Barrier polylines from the low-points raster (local coordinates)."""
    E0, N0 = m["meta"]["utmOrigin"]["E"], m["meta"]["utmOrigin"]["N"]
    B = m["meta"]["bounds"]
    cell = float(walls["cell"])
    x0, y1 = float(walls["x0"]), float(walls["y1"])
    c0 = int((E0 + B["minX"] - x0) / cell)
    r0 = int((y1 - (N0 - B["minZ"])) / cell)
    W = int((B["maxX"] - B["minX"]) / cell)
    H = int((B["maxZ"] - B["minZ"]) / cell)
    count = np.zeros((H, W), np.uint8)
    unc = np.zeros((H, W), np.uint8)
    top = np.zeros((H, W), np.float32)
    high = np.zeros((H, W), bool)
    rs, cs = max(0, -r0), max(0, -c0)
    re, ce = min(H, walls["count"].shape[0] - r0), min(W, walls["count"].shape[1] - c0)
    count[rs:re, cs:ce] = walls["count"][r0 + rs : r0 + re, c0 + cs : c0 + ce]
    unc[rs:re, cs:ce] = walls["unclassified"][r0 + rs : r0 + re, c0 + cs : c0 + ce]
    top[rs:re, cs:ce] = walls["top"][r0 + rs : r0 + re, c0 + cs : c0 + ce]
    high[rs:re, cs:ce] = walls["high"][r0 + rs : r0 + re, c0 + cs : c0 + ce]

    to_px = lambda x, z: ((x - B["minX"]) / cell, (z - B["minZ"]) / cell)  # noqa: E731
    # Exclusions: buildings (+0.75 m), tree crowns (+0.5 m), carriageways, OSM barriers (+1.5 m).
    bld = np.kron(building_mask_1m, np.ones((2, 2), bool))[:H, :W]
    bld = ndimage.binary_dilation(bld, iterations=2)
    trees = ndimage.binary_dilation(high, iterations=1)
    roads = []
    for r in m["roads"]:
        if r["k"] in VEHICLE and not r.get("b"):
            p = r["p"]
            roads.append(([to_px(p[i], p[i + 1]) for i in range(0, len(p), 2)], r["w"] / cell))
    carriage = line_mask((H, W), roads, None)
    osm = line_mask((H, W), [([to_px(p[i], p[i + 1]) for i in range(0, len(p), 2)], 0) for p, _ in osm_barrier_lines(m)], 3.0 / cell)

    cand = (count >= 1) & ~bld & ~trees & ~carriage & ~osm
    # Bridge single-cell gaps, drop isolated specks.
    cand = ndimage.binary_closing(cand, iterations=1) & ~bld & ~carriage
    lab, n = ndimage.label(cand, structure=np.ones((3, 3)))
    sizes = ndimage.sum(cand, lab, range(1, n + 1))
    cand &= np.isin(lab, 1 + np.nonzero(sizes >= MIN_LENGTH / cell)[0])
    skel = skeletonize(cand)
    # Distance to the nearest carriageway (m): parking lanes along the kerb.
    to_road = ndimage.distance_transform_edt(~carriage) * cell

    out = []
    for path in trace_paths(skel):
        length = float(np.sum(np.hypot(*np.diff(path, axis=0).T))) * cell
        if length < MIN_LENGTH:
            continue
        simp = approximate_polygon(path.astype(float), tolerance=1.0)  # 0.5 m
        if len(simp) - 1 > max(1, length / 4):
            continue  # wiggly: bushes, not a wall
        # Thickness: candidate cells within 1 m of this run, per metre of run.
        rr0, cc0 = path.min(axis=0) - 4
        rr1, cc1 = path.max(axis=0) + 5
        rr0, cc0 = max(0, rr0), max(0, cc0)
        win = np.zeros((rr1 - rr0, cc1 - cc0), bool)
        win[path[:, 0] - rr0, path[:, 1] - cc0] = True
        band = ndimage.distance_transform_edt(~win) <= 2.0
        sub = (slice(rr0, rr1), slice(cc0, cc1))
        cells = cand[sub][: band.shape[0], : band.shape[1]] & band[: cand[sub].shape[0], : cand[sub].shape[1]]
        thick = cells.sum() * cell * cell / length
        hs = top[sub][cells[: top[sub].shape[0], : top[sub].shape[1]]]
        if hs.size < 4:
            continue
        h = float(np.percentile(hs, 70))
        if h < MIN_HEIGHT or thick > MAX_THICK_HEDGE:
            continue
        # Share of unclassified points (class 1: street furniture, some vehicles). PNOA files
        # most parked cars as low vegetation too, so thick runs along the kerb are dropped as well.
        n_all = float(count[sub][cells[: count[sub].shape[0], : count[sub].shape[1]]].sum())
        n_unc = float(unc[sub][cells[: unc[sub].shape[0], : unc[sub].shape[1]]].sum())
        share = n_unc / max(1.0, n_all)
        if thick > MAX_THICK_WALL and (share > 0.3 or float(np.median(to_road[path[:, 0], path[:, 1]])) < 5.0):
            continue  # a row of parked cars along the kerb, not a hedge
        if share > 0.6 and h > 1.2:
            continue  # tall and unclassified: vehicles, not a wall
        kind = "hedge" if thick > MAX_THICK_WALL else ("wall" if h <= 1.3 else "fence")
        pts = []
        for r, c in simp:
            pts += [round(B["minX"] + (c + 0.5) * cell, 2), round(B["minZ"] + (r + 0.5) * cell, 2)]
        out.append({"p": pts, "k": kind, "h": round(min(h, 2.6), 2), "src": "lidar"})
    return out


def open_crossings(m):
    """
    Cuts every wall, fence and hedge where a road, lane or path crosses it.
    OSM often draws the wall around a car park or a yard as a closed line
    without its gate, and LiDAR runs can bridge an entrance: either way the
    way in was blocked. Each crossing leaves the way's width plus 0.6 m a side.
    """
    from shapely.geometry import LineString, MultiLineString
    from shapely.ops import unary_union
    from shapely.strtree import STRtree

    corridors = []
    for r in m["roads"]:
        p = r["p"]
        if len(p) < 4 or r.get("b"):
            continue
        corridors.append(LineString([(p[i], p[i + 1]) for i in range(0, len(p), 2)]).buffer(r["w"] / 2 + 0.6, cap_style=2))
    tree = STRtree(corridors)
    out, cuts = [], 0
    for b in m["barriers"]:
        p = b["p"]
        if b.get("fix"):
            out.append(b)  # checked against photos (data/corrections.json): its gaps are already right
            continue
        line = LineString([(p[i], p[i + 1]) for i in range(0, len(p), 2)])
        hits = [corridors[int(k)] for k in tree.query(line) if corridors[int(k)].intersects(line)]
        if not hits:
            out.append(b)
            continue
        rest = line.difference(unary_union(hits))
        parts = list(rest.geoms) if isinstance(rest, MultiLineString) else [rest] if not rest.is_empty else []
        cuts += 1
        for part in parts:
            if part.length < 1.0:
                continue
            nb = dict(b)
            nb["p"] = [round(v, 2) for xy in part.coords for v in xy]
            out.append(nb)
    m["barriers"] = out
    return cuts


def bake_barriers(m, walls_npz, building_mask_1m):
    m["barriers"] = [b for b in m.get("barriers", []) if not b.get("src")]
    found = lidar_barriers(m, walls_npz, building_mask_1m) if walls_npz is not None else []
    m["barriers"].extend(found)
    cuts = open_crossings(m)
    return len(found), cuts


def total_length(barriers):
    s = 0.0
    for b in barriers:
        p = b["p"]
        for i in range(2, len(p), 2):
            s += math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1])
    return s

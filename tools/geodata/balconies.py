"""
Balconies from the PNOA-LiDAR point cloud, and the flowers, pots and wooden fences of the
cadastre's facade photos (data/greenery.json).

A balcony shows up in the point cloud as a thin horizontal band of building points (class 6)
just outside the footprint (0.25-1.8 m from the wall), between the first floor and the eaves;
a block with a balcony on every floor gives one band per storey (checked against the facade
photos of the cadastre). Footprint misalignment, eaves and tree crowns also leave points
there, but spread over heights instead of in thin bands, so a band must be:
  - narrow in height (most points within +-0.3 m of its level) and above the shop awnings,
  - long enough along the wall (>= MIN_RUN m, few gaps) and densely hit.
Each band becomes a balcony [x0, z0, x1, z1, height above the building's ground, depth, flags]
on the building whose wall it stands out from (b["bal"], flat, stride 7).

Flags: 1 flowers (set by bake_greenery from the photo review), 2 glass railing (facade style 5,
built after 2000).
"""

import glob
import os

import numpy as np
from scipy import ndimage
from shapely import STRtree, points
from shapely.geometry import LineString, Point, Polygon

D_MIN, D_MAX = 0.25, 1.8  # distance out of the wall, m
MIN_H = 3.0  # above the building's ground: shop awnings and porches are lower
BAND = 0.3  # half-thickness of a band, m
MIN_RUN = 1.2  # m along the wall
MIN_DENSITY = 3.0  # points per metre of run
STRIDE = 7
# Drawn by their own code (or not drawn), or not houses: no balconies on them.
SKIP = {"church", "townhall", "torre", "canopy", "ruins", "greenhouse", "industrial"}


def load_points(laz_dir, E0, N0, datum, dtm_fn, bounds):
    """Building (class 6) points over 2.5 m above the ground: local x, z, height (local datum), height above ground."""
    import laspy

    X, Z, H = [], [], []
    for p in sorted(glob.glob(os.path.join(laz_dir, "*.laz"))):
        las = laspy.read(p)
        c = np.asarray(las.classification)
        k = c == 6
        x = np.asarray(las.x)[k] - E0
        z = N0 - np.asarray(las.y)[k]
        h = np.asarray(las.z)[k] - datum
        inb = (x > bounds["minX"]) & (x < bounds["maxX"]) & (z > bounds["minZ"]) & (z < bounds["maxZ"])
        x, z, h = x[inb], z[inb], h[inb]
        above = h - dtm_fn(x, z)
        k2 = above > 2.5
        X.append(x[k2])
        Z.append(z[k2])
        H.append(h[k2])
    return np.concatenate(X), np.concatenate(Z), np.concatenate(H)


def _runs(t, L, gap=1.0):
    """Occupied stretches along a wall from point positions t (sorted): [(t0, t1, n)]."""
    out = []
    if not len(t):
        return out
    s, prev, n = t[0], t[0], 1
    for v in t[1:]:
        if v - prev > gap:
            out.append((s, prev, n))
            s, n = v, 0
        prev = v
        n += 1
    out.append((s, prev, n))
    return [(max(0.0, a - 0.15), min(L, b + 0.15), n) for a, b, n in out]


def _levels(h):
    """Heights of the thin horizontal bands in h (sorted levels)."""
    if len(h) < 8:
        return []
    bins = np.arange(h.min() - 0.5, h.max() + 0.6, 0.1)
    hist, edges = np.histogram(h, bins)
    sm = ndimage.uniform_filter1d(hist.astype(float), 5)
    levels = []
    for i in np.argsort(sm)[::-1]:
        if sm[i] * 5 < 8:
            break
        y = (edges[i] + edges[i + 1]) / 2
        if any(abs(y - l) < 1.8 for l in levels):
            continue
        near = np.sum(np.abs(h - y) <= BAND)
        wide = np.sum(np.abs(h - y) <= 1.0)
        if near >= 8 and near >= 0.7 * wide:
            levels.append(y)
    return sorted(levels)


def detect(buildings, X, Z, H):
    """Balconies per building index: {i: [[x0, z0, x1, z1, hrel, depth], ...]}."""
    polys = [Polygon(list(zip(b["o"][0::2], b["o"][1::2]))).buffer(0) for b in buildings]
    tree = STRtree(polys)
    P = points(X, Z)
    inside = np.zeros(len(X), bool)
    pi, _ = tree.query(P, predicate="intersects")
    inside[pi] = True
    keep = ~inside
    X, Z, H = X[keep], Z[keep], H[keep]
    out = {}
    for i, b in enumerate(buildings):
        if "eave" not in b or b.get("hp") or b.get("t") in SKIP or b.get("gal") == 1:
            continue
        gy, eave = b["gy"], b["eave"]
        if eave - gy < MIN_H + 2.0:
            continue
        o = b["o"]
        n = len(o) // 2
        poly = polys[i]
        hidden = set(b.get("hid") or [])
        xs, zs = o[0::2], o[1::2]
        sel = (X > min(xs) - D_MAX) & (X < max(xs) + D_MAX) & (Z > min(zs) - D_MAX) & (Z < max(zs) + D_MAX)
        sel &= (H - gy >= MIN_H) & (H <= eave - 0.6)
        if sel.sum() < 8:
            continue
        bx, bz, bh = X[sel], Z[sel], H[sel]
        for k in range(n):
            ax, az = xs[k], zs[k]
            cx, cz = xs[(k + 1) % n], zs[(k + 1) % n]
            L = float(np.hypot(cx - ax, cz - az))
            if L < 2.0 or k in hidden:
                continue
            ux, uz = (cx - ax) / L, (cz - az) / L
            # Outward normal: the side of the edge's midpoint that is not inside the footprint.
            nx, nz = -uz, ux
            if poly.contains(Point((ax + cx) / 2 + nx * 0.3, (az + cz) / 2 + nz * 0.3)):
                nx, nz = -nx, -nz
            dx, dz = bx - ax, bz - az
            t = dx * ux + dz * uz
            d = dx * nx + dz * nz
            m = (t > 0.2) & (t < L - 0.2) & (d >= D_MIN) & (d <= D_MAX)
            if m.sum() < 8:
                continue
            te, de, he = t[m], d[m], bh[m] - gy
            for y in _levels(he):
                lm = np.abs(he - y) <= BAND
                order = np.argsort(te[lm])
                tl, dl = te[lm][order], de[lm][order]
                for t0, t1, cnt in _runs(tl, L):
                    if t1 - t0 < MIN_RUN or cnt / (t1 - t0) < MIN_DENSITY:
                        continue
                    r = (tl >= t0) & (tl <= t1)
                    depth = float(np.clip(np.percentile(dl[r], 85) + 0.1, 0.6, 1.6))
                    p0 = (ax + ux * t0, az + uz * t0)
                    p1 = (ax + ux * t1, az + uz * t1)
                    # Ends ordered so that the outward normal is (-uz, ux) of p0 -> p1.
                    if abs(-uz - nx) + abs(ux - nz) > 1e-6:
                        p0, p1 = p1, p0
                    out.setdefault(i, []).append(
                        [
                            round(p0[0], 2),
                            round(p0[1], 2),
                            round(p1[0], 2),
                            round(p1[1], 2),
                            round(float(y), 2),
                            round(depth, 2),
                        ]
                    )
    return out


def bake_balconies(m, laz_dir, dtm_fn, datum):
    """Writes b['bal'] on every building with balconies; returns (balconies, buildings).
    Flowers are set afterwards from the photo review (bake_greenery)."""
    E0, N0 = m["meta"]["utmOrigin"]["E"], m["meta"]["utmOrigin"]["N"]
    for b in m["buildings"]:
        b.pop("bal", None)
    X, Z, H = load_points(laz_dir, E0, N0, datum, dtm_fn, m["meta"]["bounds"])
    found = detect(m["buildings"], X, Z, H)
    n_bal = 0
    for i, lst in found.items():
        b = m["buildings"][i]
        flags = 2 if b.get("fs") == 5 else 0
        b["bal"] = [v for row in lst for v in (*row, flags)]
        n_bal += len(lst)
    return n_bal, len(found)


def bake_greenery(m, greenery_path):
    """Flowers, pots, front-garden flowers and wooden fences seen in the cadastre's facade photos
    (data/greenery.json, reviewed photo by photo). Per cadastral reference:
      F  flowers on the balconies (or window boxes): sets the flowers flag of its balconies;
      P  pots on the pavement by the door, G flowers in the front garden: b["grn"] on the
         largest footprint of the reference (the house, not its annexes), plus F there when
         the house has flowers but no balcony (window boxes);
      W  wooden fence or gate: the fences and walls between the house and the street get
         wood = 1.
    Returns (buildings with flowers, with pots or garden flowers, barriers turned to wood)."""
    import json as _json

    if not os.path.exists(greenery_path):
        return 0, 0, 0
    flags = _json.load(open(greenery_path))["buildings"]
    by_ref = {}
    for b in m["buildings"]:
        b.pop("grn", None)
        if b.get("cref") in flags:
            by_ref.setdefault(b["cref"], []).append(b)
    for bar in m.get("barriers") or []:
        if bar.get("wood") == 2:
            bar.pop("wood")
    vehicle = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service", "pedestrian"}
    rds = [LineString(list(zip(r["p"][0::2], r["p"][1::2]))) for r in m["roads"] if r["k"] in vehicle and len(r["p"]) >= 4]
    rtree = STRtree(rds)
    bars = [(i, LineString(list(zip(br["p"][0::2], br["p"][1::2])))) for i, br in enumerate(m.get("barriers") or []) if br["k"] in ("fence", "wall", "verja", "railing") and not br.get("src") == "step" and len(br["p"]) >= 4]
    btree = STRtree([g for _, g in bars]) if bars else None
    n_f = n_pg = n_w = 0
    for ref, fl in flags.items():
        parts = by_ref.get(ref)
        if not parts:
            continue
        # The house: the largest footprint that is drawn (outlines with parts are drawn through
        # their parts; canopies and sheds carry no flowers).
        drawn = [b for b in parts if not b.get("hp") and b.get("t") not in ("canopy", "industrial")] or parts
        main = max(drawn, key=lambda b: Polygon(list(zip(b["o"][0::2], b["o"][1::2]))).buffer(0).area)
        if "F" in fl:
            n_f += 1
            for b in parts:
                bal = b.get("bal") or []
                for k in range(STRIDE - 1, len(bal), STRIDE):
                    bal[k] = int(bal[k]) | 1
        # Flowers but no balcony the LiDAR could see: window boxes on the street front.
        boxes = "F" if "F" in fl and not any(b.get("bal") for b in parts) else ""
        pg = boxes + "".join(c for c in "PG" if c in fl)
        if pg:
            main["grn"] = pg
            n_pg += 1
        if "W" in fl and btree is not None:
            poly = Polygon(list(zip(main["o"][0::2], main["o"][1::2]))).buffer(0)
            near = rtree.query(poly.buffer(30))
            d_house = min((rds[j].distance(poly) for j in near), default=1e9)
            for j in btree.query(poly.buffer(14)):
                i, g = bars[j]
                mid = g.interpolate(0.5, normalized=True)
                d_bar = min((rds[k].distance(mid) for k in rtree.query(mid.buffer(30))), default=1e9)
                # Between the house and the street: nearer to the street than the house is.
                if d_bar < d_house and g.distance(poly) < 14:
                    m["barriers"][i]["wood"] = 2
                    n_w += 1
    return n_f, n_pg, n_w

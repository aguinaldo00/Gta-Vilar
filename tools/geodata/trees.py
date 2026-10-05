"""
Species and crown colour for every tree the LiDAR found, and the shrubs of the town.

Species codes (shared with scripts/osm-to-map.ts and src/world/TreeSpecies.ts):
  1 plane (Platanus × hispanica)      2 pollarded plane          3 Lombardy poplar
  4 black / hybrid poplar             5 white poplar             6 willow (Salix)
  7 alder (Alnus glutinosa)           8 ash (Fraxinus)           9 false acacia (Robinia)
 10 horse chestnut (Aesculus)        11 lime (Tilia)            12 catalpa
 13 oak (Quercus faginea/pyrenaica)  14 holm oak (Quercus ilex) 15 pine (Pinus sylvestris)
 16 cypress                          17 yew (Taxus)             18 fruit tree
 19 purple-leaved plum (Prunus cerasifera 'Pissardii')

What decides a species, in order (sources in the commit and the vegetation notes):
  * a species mapped in OSM within 4 m (the plane, lime, catalpas, horse chestnut and yew of
    the town are tagged), or a needle-leaved tree / conifer wood;
  * the Nela's riparian woodland: willows and alders on the bank, black and white poplars a
    little further out, ash behind them (Riberas del Nela, Natura 2000 site);
  * the parks (El Soto, El Sotillo): poplars and false acacias dominate, with planes, horse
    chestnuts and limes (the town's descriptions of El Soto);
  * the shape the LiDAR measured: tall and narrow crowns are Lombardy poplars or cypresses;
  * streets and gardens: the usual Castilian town trees (planes, false acacias, catalpas,
    limes, purple plums where the orthophoto shows a red crown, fruit trees, cypresses);
  * the countryside of Las Merindades: Portuguese oak (quejigo) and Pyrenean oak, ash in the
    hedgerows, some holm oaks, poplar plantations (tall, regular crowns).
A per-tree hash only picks between species the rules above allow, so a park is a mix and not
one tree repeated, and the result is the same on every bake.
"""

import math

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, Polygon
from shapely.strtree import STRtree

TOWN_RADIUS = 950.0


def _h01(x, z, k=0.0):
    v = math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453
    return v - math.floor(v)


def _pick(table, u):
    """table: [(code, weight), ...]; u in [0, 1)."""
    total = sum(w for _, w in table)
    acc = 0.0
    for code, w in table:
        acc += w / total
        if u < acc:
            return code
    return table[-1][0]


def _poly(a):
    return Polygon(list(zip(a["o"][0::2], a["o"][1::2]))).buffer(0)


def crown_colour(ortho, grid, x, z, r):
    """Mean orthophoto colour over the middle of the crown (0..255 RGB)."""
    minX, minZ, W, H = grid
    rr, cc = int(z - minZ), int(x - minX)
    k = max(1, int(r * 0.5))
    if ortho is None or not (0 <= rr < H and 0 <= cc < W):
        return (96, 112, 70)
    w = ortho[max(0, rr - k) : rr + k + 1, max(0, cc - k) : cc + k + 1].reshape(-1, 3).astype(np.float32)
    return tuple(int(v) for v in w.mean(0))


def classify_trees(m, ortho, grid):
    """Turns m['ltrees'] from [x, z, h, r] into [x, z, h, r, species, tint] (stride 6)."""
    lt = m.get("ltrees") or []
    if m.get("ltreeStride", 4) != 4 or not lt:
        return {}
    rivers = [(LineString(list(zip(r["p"][0::2], r["p"][1::2]))), r.get("w", 16) / 2) for r in m["rivers"] if len(r["p"]) >= 4]
    rtree = STRtree([g for g, _ in rivers]) if rivers else None
    areas = [(a, _poly(a)) for a in m["areas"]]
    atree = STRtree([p for _, p in areas])
    vehicle = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service"}
    rds = [(LineString(list(zip(r["p"][0::2], r["p"][1::2]))), r["w"] / 2) for r in m["roads"] if r["k"] in vehicle and len(r["p"]) >= 4]
    roadtree = STRtree([g for g, _ in rds])
    sp = m.get("treeSpecies") or []
    sp_pts = np.array([[sp[i], sp[i + 1]] for i in range(0, len(sp), 3)]) if sp else np.zeros((0, 2))
    sp_code = [sp[i + 2] for i in range(0, len(sp), 3)]
    sp_kd = cKDTree(sp_pts) if len(sp_pts) else None
    pines = m.get("pines") or []
    pine_kd = cKDTree(np.array(pines).reshape(-1, 2)) if pines else None

    out = []
    counts = {}
    for i in range(0, len(lt), 4):
        x, z, h, r = lt[i : i + 4]
        P = Point(x, z)
        u = _h01(x, z)
        # The LiDAR crown radius tops out at ~7 m, so the ratio alone would make every tall
        # tree "slender": a columnar crown (Lombardy poplar, cypress) is also narrow in metres.
        slender = r < 0.24 * h and r < 4.0
        rgb = crown_colour(ortho, grid, x, z, r)
        lum = 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]
        reddish = rgb[0] > rgb[1] + 4 and lum < 120
        pale = lum > 105 and abs(rgb[1] - rgb[0]) < 8

        bank = 1e9
        if rtree is not None:
            for j in rtree.query(P.buffer(60)):
                g, hw = rivers[j]
                bank = min(bank, g.distance(P) - hw)
        kinds, names = set(), set()
        forest_needle = False
        for j in atree.query(P):
            a, poly = areas[j]
            if poly.contains(P):
                kinds.add(a["k"])
                if a.get("n"):
                    names.add(a["n"])
                if a["k"] == "forest" and a.get("l") == "n":
                    forest_needle = True
        street = False
        for j in roadtree.query(P.buffer(8)):
            g, hw = rds[j]
            if g.distance(P) - hw < 4:
                street = True
                break
        town = math.hypot(x, z) < TOWN_RADIUS

        code = 0
        if sp_kd is not None:
            d, j = sp_kd.query([x, z])
            if d < 4:
                code = sp_code[j]
                if code == 1 and ("Plaza Mayor" in names):
                    code = 2
        if not code and pine_kd is not None and pine_kd.query([x, z])[0] < 4:
            code = 15
        if not code and forest_needle:
            code = 16 if (slender and h < 16) else 15
        if not code and "cemetery" in kinds:
            code = 16 if u < 0.75 else 17
        if not code and "orchard" in kinds:
            code = 18
        if not code and bank < 7:
            if h >= 17:
                code = 5 if pale or u < 0.2 else 4
            elif r >= 0.45 * h:
                code = 6
            else:
                code = _pick([(6, 45), (7, 55)], u)
        if not code and bank < 35:
            if h >= 16:
                code = 3 if slender else (5 if pale or u < 0.2 else 4)
            elif bank < 15:
                code = _pick([(7, 35), (6, 25), (8, 40)], u)
            else:
                code = _pick([(8, 55), (9, 25), (6, 20)], u) if town else _pick([(8, 70), (6, 30)], u)
        if not code and ("park" in kinds or names & {"El Soto", "El Sotillo"}):
            if h >= 17:
                code = 3 if slender else 4
            else:
                code = _pick([(9, 50), (1, 20 if r >= 4.5 else 5), (10, 15), (11, 15)], u)
        if not code and town:
            if reddish and h < 10:
                code = 19
            elif slender and h > 6:
                code = 16 if h < 15 else 3
            elif street:
                if r >= 4.5 and h >= 9:
                    code = 1
                else:
                    code = _pick([(9, 40), (12, 20), (11, 20), (1, 20)], u)
            elif h < 6:
                code = _pick([(18, 60), (19, 10), (17, 10), (16, 20)], u)
            else:
                code = _pick([(8, 20), (9, 15), (11, 15), (10, 10), (1, 10), (18, 15), (16, 10), (13, 5)], u)
        if not code:
            if slender and h > 12:
                code = 3
            elif h >= 18:
                code = 4
            elif h < 7 and r < 3:
                code = _pick([(14, 30), (13, 70)], u)
            else:
                code = _pick([(13, 65), (8, 25), (14, 10)], u)
        counts[code] = counts.get(code, 0) + 1
        tint = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
        out += [x, z, h, r, code, tint]
    m["ltrees"] = out
    m["ltreeStride"] = 6
    return counts


def lidar_shrubs(m, chm, blocked, grid, hedge_mask, limit=9000):
    """Low crowns (1–4 m) in the town that are not trees, hedges, buildings or streets: shrubs.
    Appended to the OSM shrubs as [x, z, 5, height] (code 5: found in the LiDAR, so re-bakes replace them)."""
    minX, minZ, W, H = grid
    sm = ndimage.gaussian_filter(chm, 0.8)
    peaks = (sm == ndimage.maximum_filter(sm, size=5)) & (sm > 1.0) & (sm <= 4.0)
    # Not under a tree crown (a tree's lower branches), not a hedge, not a building edge.
    tall = ndimage.maximum_filter(sm, size=7) > 4.5
    peaks &= ~tall & ~blocked & ~hedge_mask
    rr, cc = np.nonzero(peaks)
    xs = minX + cc + 0.5
    zs = minZ + rr + 0.5
    near = np.hypot(xs, zs) < 1100
    vehicle = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service", "pedestrian", "footway", "path", "track", "cycleway"}
    rds = [(LineString(list(zip(r["p"][0::2], r["p"][1::2]))), r["w"] / 2 + 0.6) for r in m["roads"] if r["k"] in vehicle and len(r["p"]) >= 4]
    rtree = STRtree([g for g, _ in rds])
    order = np.argsort(np.hypot(xs, zs))
    old = m.get("shrubs") or []
    shrubs = [v for i in range(0, len(old), 4) if old[i + 2] != 5 for v in old[i : i + 4]]
    added = 0
    for k in order:
        if added >= limit or not near[k]:
            continue
        P = Point(xs[k], zs[k])
        if any(rds[j][0].distance(P) < rds[j][1] for j in rtree.query(P.buffer(8))):
            continue
        shrubs += [round(float(xs[k]), 1), round(float(zs[k]), 1), 5, round(float(sm[rr[k], cc[k]]), 1)]
        added += 1
    m["shrubs"] = shrubs
    return added

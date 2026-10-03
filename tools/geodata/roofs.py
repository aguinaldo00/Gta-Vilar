"""
Roofs from the LiDAR: one continuous roof per row of buildings that share their eaves.

The cadastre splits most old-town blocks into many building parts. Giving each
part its own hipped roof produced a sawtooth of small pyramids along every
street. Here adjacent footprints whose eaves are at the same height (±1 m) are
merged into one roof outline, and the roof shape is measured instead of
assumed:

- pitch: the median gradient of the LiDAR roof surface (planes of a pitched
  roof vs ~0 on a terrace), ignoring the steps between roofs;
- eaves: the low edge of the roof near the outline; ridge: the 97th percentile;
- colour: the median orthophoto colour inside the outline (red tiles, grey
  slate, terraces...).

Output (written into the map JSON):
  roofs: [{o, h?, e, s, r, c}]   outline, holes, eave height (local y),
                                 slope (rise per metre, 0 = flat), rise cap (m),
                                 colour 0xRRGGBB
  buildings[i].rf                index of the roof covering that footprint
  buildings[i].eave              wall top (the roof's eaves)

The game draws each roof as a straight-skeleton hip roof with that slope,
flattened at the measured ridge (src/world/Roofs.ts).
"""

import math
import os
import re

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import MultiPolygon, Point, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.validation import make_valid

FLOOR_H = 3.1  # m, same as src/world/Materials.ts
EAVE_TOLERANCE = 1.0  # m: adjacent footprints with eaves this close share a roof
MIN_SHARED = 1.5  # m of common wall to count as adjacent
FLAT_PITCH = math.tan(math.radians(7))
MAX_PITCH = math.tan(math.radians(50))
DEFAULT_PITCH = math.tan(math.radians(28))
# Landmarks with their own models (src/world/Churches.ts, Facilities.ts, Landmarks.ts) keep their roofs.
CUSTOM_NAMES = re.compile(r"^(Iglesia de Santa Marina|Ermita de San Roque|Ermita de San Vicente|Polideportivo de Villarcayo)$")
NO_ROOF_TYPES = {"townhall", "torre", "canopy", "ruins", "greenhouse"}


def ring_pts(flat):
    return list(zip(flat[0::2], flat[1::2]))


def footprint_polygon(b):
    p = Polygon(ring_pts(b["o"]), [ring_pts(h) for h in b.get("h", [])])
    if not p.is_valid:
        p = make_valid(p)
        if isinstance(p, MultiPolygon) or p.geom_type == "GeometryCollection":
            polys = [g for g in getattr(p, "geoms", [p]) if g.geom_type == "Polygon"]
            p = max(polys, key=lambda g: g.area) if polys else Polygon()
    return p


def raster(poly, minX, minZ, W, H):
    """Polygon (with holes) on the 1 m game grid: (mask, r0, c0) cropped to its bbox."""
    x0, z0, x1, z1 = poly.bounds
    c0, r0 = max(0, int(x0 - minX) - 1), max(0, int(z0 - minZ) - 1)
    c1, r1 = min(W, int(math.ceil(x1 - minX)) + 2), min(H, int(math.ceil(z1 - minZ)) + 2)
    if c1 <= c0 or r1 <= r0:
        return None, 0, 0
    img = Image.new("L", (c1 - c0, r1 - r0), 0)
    d = ImageDraw.Draw(img)
    to = lambda ring: [(x - minX - c0 - 0.5, z - minZ - r0 - 0.5) for x, z in ring.coords]  # noqa: E731
    d.polygon(to(poly.exterior), fill=1)
    for h in poly.interiors:
        d.polygon(to(h), fill=0)
    return np.array(img, bool), r0, c0


def measure_roof(hts, mask):
    """
    Roof shape from the LiDAR roof raster cropped to one outline -> (eave, slope, rise) or None.

    The slope is the median gradient of the roof surface (a pitched roof is a set of
    planes, a flat one has ~0 gradient everywhere); steps between roofs at different
    heights and the outline cells are left out. The eaves are the low edge of the roof
    near the outline, the rise goes up to the 97th percentile (the ridge).
    """
    inner = ndimage.binary_erosion(mask, iterations=1)
    if inner.sum() < 6:
        inner = mask
    finite = hts[mask & np.isfinite(hts)]
    if finite.size < 6:
        return None
    gz, gx = np.gradient(hts)
    g = np.hypot(gx, gz)
    ok = inner & np.isfinite(g) & (g < 1.5)
    if ok.sum() >= 6:
        slope = float(np.median(g[ok]))
    else:
        slope = DEFAULT_PITCH if np.percentile(finite, 90) - np.percentile(finite, 10) > 1.0 else 0.0
    band = mask & (ndimage.distance_transform_edt(mask) <= 1.5) & np.isfinite(hts)
    low = hts[band] if band.sum() >= 3 else finite
    if slope < FLAT_PITCH:
        # Flat terrace: the level most of the roof sits at (ignores stair towers and chimneys).
        return float(np.percentile(finite, 45)), 0.0, 0.0
    eave = float(np.percentile(low, 15))
    rise = float(np.clip(np.percentile(finite, 97) - eave, 0.6, 8.0))
    return eave, min(slope, MAX_PITCH), rise


def ortho_sampler(m, ortho_dir):
    o = m["meta"].get("ortho")
    if not o or not os.path.isdir(ortho_dir):
        return None
    cache = {}

    def tile(i, j):
        if (i, j) not in cache:
            p = os.path.join(ortho_dir, f"{i}_{j}.jpg")
            cache[(i, j)] = np.asarray(Image.open(p).convert("RGB")) if os.path.exists(p) else None
        return cache[(i, j)]

    def sample(xs, zs):
        cols = []
        for x, z in zip(xs, zs):
            i, j = int((x - o["minX"]) // o["tile"]), int((z - o["minZ"]) // o["tile"])
            t = tile(i, j)
            if t is None:
                continue
            px = t.shape[0] / o["tile"]
            u = int((x - o["minX"] - i * o["tile"]) * px)
            v = int((z - o["minZ"] - j * o["tile"]) * px)
            cols.append(t[min(v, t.shape[0] - 1), min(u, t.shape[1] - 1)])
        return np.array(cols)

    return sample


def roof_colour(sample, mask, r0, c0, minX, minZ):
    if sample is None:
        return None
    inner = ndimage.binary_erosion(mask, iterations=1)
    if inner.sum() < 4:
        inner = mask
    rr, cc = np.nonzero(inner)
    if rr.size > 400:
        k = np.linspace(0, rr.size - 1, 400).astype(int)
        rr, cc = rr[k], cc[k]
    px = sample(minX + c0 + cc + 0.5, minZ + r0 + rr + 0.5)
    if px.size == 0:
        return None
    rgb = np.median(px, axis=0)
    # The orthophoto carries the sun, shade and haze of the moment: lift it towards an albedo
    # and give back some of the saturation the haze takes away.
    grey = rgb.mean()
    rgb = grey + (rgb - grey) * 1.35
    rgb = np.clip(rgb * 1.15 + 4, 0, 255).astype(int)
    return int(rgb[0]) << 16 | int(rgb[1]) << 8 | int(rgb[2])


def estimated_eave(b):
    """Wall top for footprints the LiDAR did not measure (same rules as the game's buildingHeight)."""
    if b.get("ht"):
        return b["gy"] + b["ht"]
    lv = b.get("lv")
    t = b.get("t")
    if t == "industrial":
        return b["gy"] + (lv * 4.5 if lv else 7)
    if t == "small":
        return b["gy"] + (lv * 2.8 if lv else 2.8)
    return b["gy"] + (lv or 2) * FLOOR_H + 0.5


def bake_roofs(m, dtm, roof, H0, ortho_dir):
    minX, minZ = m["meta"]["bounds"]["minX"], m["meta"]["bounds"]["minZ"]
    H, W = dtm.shape
    sample = ortho_sampler(m, ortho_dir)
    items = []  # (building index, polygon, eave)
    for i, b in enumerate(m["buildings"]):
        b.pop("rf", None)
        if b.get("hp") or b.get("t") in NO_ROOF_TYPES or CUSTOM_NAMES.match(b.get("n", "")):
            continue
        p = footprint_polygon(b)
        if p.is_empty or p.area < 4:
            continue
        if "gy" not in b:
            continue
        eave = b["eave"] if "top" in b else estimated_eave(b)
        items.append((i, p, eave))

    # Union-find over adjacent footprints with matching eaves (raised parts stay on their own).
    parent = list(range(len(items)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    tree = STRtree([p for _, p, _ in items])
    for a, (ia, pa, ea) in enumerate(items):
        if m["buildings"][ia].get("mlv"):
            continue
        for b_ in tree.query(pa.buffer(0.3)):
            b_ = int(b_)
            if b_ <= a:
                continue
            ib, pb, eb = items[b_]
            if m["buildings"][ib].get("mlv") or abs(ea - eb) > EAVE_TOLERANCE:
                continue
            if pa.boundary.intersection(pb.buffer(0.3)).length >= MIN_SHARED:
                parent[find(a)] = find(b_)

    groups = {}
    for k in range(len(items)):
        groups.setdefault(find(k), []).append(k)

    roofs = []
    stats = {"pitched": 0, "flat": 0, "estimated": 0}
    for members in groups.values():
        polys = [items[k][1] for k in members]
        u = unary_union([p.buffer(0.08, join_style=2) for p in polys]).buffer(-0.08, join_style=2)
        pieces = list(u.geoms) if isinstance(u, MultiPolygon) else [u]
        for piece in pieces:
            if piece.is_empty or piece.area < 4:
                continue
            piece = piece.simplify(0.15)
            piece = Polygon(piece.exterior, [h for h in piece.interiors if Polygon(h).area > 6])
            own = [k for k in members if piece.contains(items[k][1].representative_point())]
            if not own:
                continue
            mask, r0, c0 = raster(piece, minX, minZ, W, H)
            if mask is None or mask.sum() < 3:
                continue
            sl = (slice(r0, r0 + mask.shape[0]), slice(c0, c0 + mask.shape[1]))
            hts = roof[sl] - H0
            measured = [k for k in own if "top" in m["buildings"][items[k][0]]]
            eaves = np.array([items[k][2] for k in own])
            areas = np.array([items[k][1].area for k in own])
            fit = measure_roof(hts, mask) if measured else None
            lo_wall = max(m["buildings"][items[k][0]]["gy"] for k in own) + 1.8
            if fit is None:
                # No LiDAR here: storeys from the cadastre, a typical 28° tiled roof.
                e = float(np.average(eaves, weights=areas))
                industrial = any(m["buildings"][items[k][0]].get("t") == "industrial" for k in own)
                s, r = DEFAULT_PITCH, 1.5 if industrial else 3.5
                stats["estimated"] += 1
            else:
                e, s, r = fit
                stats["pitched" if s > 0 else "flat"] += 1
            e = max(e, lo_wall)
            out = {
                "o": [round(v, 2) for xy in list(piece.exterior.coords)[:-1] for v in xy],
                "e": round(e, 2),
                "s": round(s, 3),
                "r": round(r, 2),
            }
            if piece.interiors:
                out["h"] = [[round(v, 2) for xy in list(h.coords)[:-1] for v in xy] for h in piece.interiors]
            c = roof_colour(sample, mask, r0, c0, minX, minZ)
            if c is not None:
                out["c"] = c
            for k in own:
                b = m["buildings"][items[k][0]]
                b["rf"] = len(roofs)
                b["eave"] = out["e"]
                b["top"] = round(out["e"] + out["r"], 2)
            roofs.append(out)
    m["roofs"] = roofs
    return len(roofs), len(items), stats


def wall_top(b):
    return b.get("eave", b.get("top", estimated_eave(b) if "gy" in b else 0))


def fix_hidden_walls(m):
    """
    osm-to-map hides part walls shared with a part that the cadastre says is as
    tall or taller. With the measured heights that is sometimes false, which
    left holes in the facades: keep a wall hidden only if the footprint on the
    other side really reaches at least as high.
    """
    polys, owners = [], []
    for i, b in enumerate(m["buildings"]):
        if b.get("hp"):
            continue
        p = footprint_polygon(b)
        if not p.is_empty:
            polys.append(p)
            owners.append(i)
    tree = STRtree(polys)
    shown = 0
    for i, b in enumerate(m["buildings"]):
        if not b.get("hid"):
            continue
        pts = ring_pts(b["o"])
        own = footprint_polygon(b)
        keep = []
        for e in b["hid"]:
            (ax, az), (bx, bz) = pts[e], pts[(e + 1) % len(pts)]
            L = math.hypot(bx - ax, bz - az) or 1
            nx, nz = (bz - az) / L, -(bx - ax) / L
            mx, mz = (ax + bx) / 2, (az + bz) / 2
            probe = Point(mx + nx * 0.4, mz + nz * 0.4)
            if own.contains(probe):
                probe = Point(mx - nx * 0.4, mz - nz * 0.4)
            other = [owners[int(k)] for k in tree.query(probe) if owners[int(k)] != i and polys[int(k)].contains(probe)]
            if other and max(wall_top(m["buildings"][k]) for k in other) >= wall_top(b) - 0.3:
                keep.append(e)
            else:
                shown += 1
        if keep:
            b["hid"] = keep
        else:
            b.pop("hid")
    return shown

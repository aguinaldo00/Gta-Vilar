"""
Hedges (setos) from the LiDAR canopy model.

walls.py finds the low plot boundaries in the points 0.35-3.2 m above the
ground and leaves out anything under a tree crown, so the tall clipped hedges
of the town (arizónicas, laurel and privet screens of 2-5 m around gardens,
the school grounds and along Calle el Soto) were missing, or became a row of
"trees". Here the canopy height model (class 5 vegetation minus the ground)
is searched for long, narrow, continuous strips:

  - 0.9-6 m tall, at most ~3.5 m wide (wider blobs are tree groups and
    copses: removed by a morphological opening);
  - straight runs >= MIN_LENGTH m, with an even top: a row of separate trees
    has gaps and peaks along it, a hedge does not;
  - in the built-up area, off buildings, carriageways, water, and not on a
    boundary already found (walls.py / OSM).

Output: m["barriers"] += [{p, k: "hedge", h, src: "lidar", t: thickness}].
Returns the hedge lines so the tree detection can skip their tops.
"""

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage.measure import approximate_polygon
from skimage.morphology import disk, skeletonize

from walls import trace_paths

MIN_LENGTH = 8.0
MIN_H, MAX_H = 1.0, 5.0
URBAN = 40  # m from a building
VEHICLE = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service"}


def ortho_mosaic(m, ortho_dir, grid):
    """Orthophoto resampled to the 1 m game grid (rows = z, columns = x), or None."""
    import os

    o = m["meta"].get("ortho")
    if not o:
        return None
    minX, minZ, W, H = grid
    T = o["tile"]
    out = np.zeros((H, W, 3), np.uint8)
    for i in range(o["nx"]):
        for j in range(o["nz"]):
            p = os.path.join(ortho_dir, f"{i}_{j}.jpg")
            if not os.path.exists(p):
                continue
            t = np.asarray(Image.open(p).convert("RGB").resize((T, T), Image.BILINEAR))
            c0 = int(o["minX"] + i * T - minX)
            r0 = int(o["minZ"] + j * T - minZ)
            rs, cs = max(0, -r0), max(0, -c0)
            re, ce = min(T, H - r0), min(T, W - c0)
            if re > rs and ce > cs:
                out[r0 + rs : r0 + re, c0 + cs : c0 + ce] = t[rs:re, cs:ce]
    return out


def foliage_mask(rgb):
    """Dark foliage green (clipped hedges, shrubs); lawns are lighter, masonry and paving grey."""
    f = rgb.astype(np.float32)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    return (g - r > 5) & (g >= b) & (lum < 110) & (lum > 15)


def bake_hedges(m, dtm, veg, lowtop, ortho, building_mask, grid):
    minX, minZ, W, H = grid
    chm = np.where(np.isfinite(veg), veg - dtm, 0).astype(np.float32)
    hgt = np.maximum(ndimage.median_filter(chm, size=3), lowtop)
    tall = (hgt >= MIN_H) & (hgt <= MAX_H + 2)
    if ortho is not None:
        # Foliage in the orthophoto (dilated by a metre: hedges lean and the photo is not a true orthophoto).
        tall &= ndimage.binary_dilation(foliage_mask(ortho), iterations=1)
    # Narrow strips only: what survives an opening with a 5 m disc is a tree group or a copse.
    blobs = ndimage.binary_opening(tall, structure=disk(2))
    strips = tall & ~ndimage.binary_dilation(blobs, iterations=1)
    chm = hgt

    img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(img)
    # Every street, path and bridge deck, the river and the streams.
    for r in m["roads"]:
        p = r["p"]
        d.line([(p[i] - minX, p[i + 1] - minZ) for i in range(0, len(p), 2)], fill=1, width=int(r["w"]) + (6 if r.get("b") else 1))
    for key in ("rivers", "streams"):
        for r in m.get(key, []):
            p = r["p"]
            d.line([(p[i] - minX, p[i + 1] - minZ) for i in range(0, len(p), 2)], fill=1, width=int(r.get("w", 4)) + 10)
    for a in m["areas"]:
        if a["k"] in ("water", "pool", "farmland", "forest", "parking", "pedestrian", "pitch", "meadow", "scrub"):
            o = a["o"]
            d.polygon([(o[i] - minX, o[i + 1] - minZ) for i in range(0, len(o), 2)], fill=1)
    for b in m.get("barriers", []):
        p = b["p"]
        d.line([(p[i] - minX, p[i + 1] - minZ) for i in range(0, len(p), 2)], fill=1, width=3)
    blocked = np.asarray(img, bool) | ndimage.binary_dilation(building_mask, iterations=1)
    near = ndimage.distance_transform_edt(~building_mask) <= URBAN
    cand = strips & near & ~blocked
    cand = ndimage.binary_closing(cand, iterations=1) & ~blocked
    lab, n = ndimage.label(cand, structure=np.ones((3, 3)))
    sizes = ndimage.sum(cand, lab, range(1, n + 1))
    cand = np.isin(lab, 1 + np.nonzero(sizes >= MIN_LENGTH)[0])

    out = []
    for path in trace_paths(skeletonize(cand)):
        length = float(np.sum(np.hypot(*np.diff(path, axis=0).T)))
        if length < MIN_LENGTH:
            continue
        simp = approximate_polygon(path.astype(float), tolerance=0.9)
        if len(simp) - 1 > max(1, length / 5):
            continue  # wiggly: shrubs, not a clipped hedge
        hs = chm[path[:, 0], path[:, 1]]
        # Continuous and even: no gaps, no crowns standing out (a row of trees).
        if (hs < MIN_H).mean() > 0.12 or np.percentile(hs, 90) - np.percentile(hs, 25) > 1.6:
            continue
        h = float(np.median(hs))
        if h > MAX_H:
            continue
        # Thickness: strip cells within 2.5 m of the run, per metre.
        r0, c0 = np.maximum(path.min(axis=0) - 4, 0)
        r1, c1 = path.max(axis=0) + 5
        win = np.zeros((r1 - r0, c1 - c0), bool)
        win[path[:, 0] - r0, path[:, 1] - c0] = True
        band = ndimage.distance_transform_edt(~win) <= 2.5
        sub = cand[r0:r1, c0:c1]
        thick = float((sub & band[: sub.shape[0], : sub.shape[1]]).sum()) / length
        if thick > 3.5:
            continue
        pts = []
        for r, c in simp:
            pts += [round(minX + c + 0.5, 2), round(minZ + r + 0.5, 2)]
        out.append({"p": pts, "k": "hedge", "h": round(min(h, 4.5), 2), "src": "lidar", "t": round(min(max(thick, 0.8), 2.5), 1)})
    m["barriers"].extend(out)
    return out


def classify_by_ortho(m, sample, lowtop=None, grid=None):
    """
    Walls and fences found in the low points that are really hedges: PNOA files
    both as low vegetation, but in the orthophoto a clipped hedge is a line of
    dark foliage green, while a wall or a fence shows masonry, paving or the
    lawn's lighter green through the wire. Samples every 0.5 m on the line.
    """
    if sample is None:
        return 0
    changed = 0
    for b in m["barriers"]:
        # LiDAR walls and fences, and OSM fences (a hedge often grows along the mapped fence).
        osm_fence = not b.get("src") and b["k"] == "fence" and not b.get("fix")
        if not (osm_fence or (b.get("src") == "lidar" and b["k"] in ("wall", "fence"))):
            continue
        p = b["p"]
        xs, zs = [], []
        for i in range(2, len(p), 2):
            ax, az, bx, bz = p[i - 2], p[i - 1], p[i], p[i + 1]
            n = max(1, int(np.hypot(bx - ax, bz - az) / 0.5))
            for k in range(n):
                xs.append(ax + (bx - ax) * k / n)
                zs.append(az + (bz - az) * k / n)
        if len(xs) < 6:
            continue
        # The LiDAR line and the photo can be a metre apart (the photo is not a true
        # orthophoto): the best of the line and its parallels 0.6 and 1.2 m either side.
        x0, z0, x1, z1 = p[0], p[1], p[-2], p[-1]
        L = float(np.hypot(x1 - x0, z1 - z0)) or 1.0
        nx, nz = -(z1 - z0) / L, (x1 - x0) / L
        best = 0.0
        for o in (0.0, 0.6, -0.6, 1.2, -1.2):
            rgb = sample([x + nx * o for x in xs], [z + nz * o for z in zs]).astype(np.float32)
            if len(rgb) < 6:
                continue
            r, g, bl = rgb[:, 0], rgb[:, 1], rgb[:, 2]
            lum = 0.3 * r + 0.59 * g + 0.11 * bl
            best = max(best, float(((g - r > 6) & (g >= bl) & (lum < 105)).mean()))
        h = b.get("h", 1.5)
        if osm_fence:
            if lowtop is None:
                continue
            minX, minZ, W, H = grid
            cols = np.clip((np.array(xs) - minX).astype(int), 0, W - 1)
            rows = np.clip((np.array(zs) - minZ).astype(int), 0, H - 1)
            tops = np.maximum.reduce([lowtop[np.clip(rows + dr, 0, H - 1), np.clip(cols + dc, 0, W - 1)] for dr in (-1, 0, 1) for dc in (-1, 0, 1)])
            h = float(np.median(tops))
            if h < 1.0:
                continue  # a bare fence with low planting
        if best > 0.6 and h >= 0.8:
            b["k"] = "hedge"
            b["t"] = 1.0
            b["h"] = round(min(h, 3.5), 2)
            changed += 1
    return changed


def prune_barriers(m):
    """
    Last check on every barrier found in the LiDAR or the photo: nothing on a
    bridge deck, in the river channel or along a carriageway (railings, parked
    vans and riverside shrubs looked like walls and hedges there).
    """
    from shapely.geometry import LineString
    from shapely.strtree import STRtree

    def line(p):
        return LineString(list(zip(p[0::2], p[1::2])))

    zones = [line(r["p"]).buffer(r["w"] / 2 + 1.0) for r in m["roads"] if r.get("b") and len(r["p"]) >= 4]
    zones += [line(r["p"]).buffer(r.get("w", 16) / 2) for r in m.get("rivers", []) if len(r["p"]) >= 4]
    carriage = [line(r["p"]).buffer(r["w"] / 2 - 0.3) for r in m["roads"] if r["k"] in VEHICLE and r["k"] != "service" and len(r["p"]) >= 4]
    tz, tc = STRtree(zones), STRtree(carriage)
    # Fences checked on photos (data/corrections.json, `fix`): the LiDAR's own reading of the
    # same line (often a "hedge" where trees lean over it) is not drawn a second time.
    fixed = [line(b["p"]).buffer(1.5) for b in m["barriers"] if b.get("fix") and len(b["p"]) >= 4]
    keep, dropped = [], 0
    for b in m["barriers"]:
        if not (b.get("src") == "lidar" or b.get("t")):
            keep.append(b)
            continue
        ln = line(b["p"])
        if ln.length > 0 and any(f.intersection(ln).length > 0.6 * ln.length for f in fixed):
            dropped += 1
            continue
        if any(zones[i].intersects(ln) for i in tz.query(ln)) or any(carriage[i].intersection(ln).length > 1.5 for i in tc.query(ln)):
            dropped += 1
            continue
        keep.append(b)
    m["barriers"] = keep
    return dropped

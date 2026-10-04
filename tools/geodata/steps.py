"""
Terraces of the town: places where the ground drops by a metre or more in a
single step (the platform of Santa Marina, raised plazas, terraced gardens,
walls along the river walk).

The runtime heightmap has 2 m cells, so a vertical step in the LiDAR ground
becomes a soft ramp of a few metres and the upper level is lost. Here the
step is found on the 1 m ground model and written as a retaining wall:

  - candidate cells: the ground rises >= MIN_STEP within 2 m across them while
    staying flat (< FLAT) a little further on both sides, so a step and not a
    hillside, a river bank or an embankment;
  - only in the built-up area (near buildings), away from footprints, water,
    fields and carriageways (the ground there was smoothed on purpose);
  - skeletonised and traced into straight runs (walls.trace_paths); each run
    stores the level of its upper side (`top`, local m) and which side that is
    (`up`: +1 left of travel, -1 right), so the game draws a platform edge
    whose top is flush with the upper ground and hides the ramp.

Output: m["barriers"] += [{p, k: "retaining_wall", h, top, up, src: "step"}]
"""

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage.measure import approximate_polygon
from skimage.morphology import skeletonize

from walls import trace_paths

MIN_STEP = 0.75  # m of rise across the step
FLAT = 0.45  # m of rise allowed on each side beyond it
MIN_LENGTH = 4.0
URBAN = 30  # m from a building


def bake_steps(m, dtm, footprint, H0, grid):
    minX, minZ, W, H = grid
    g = ndimage.gaussian_filter(dtm, 0.6)
    # Rise across each cell over +-1 m and flatness beyond it, in x and z.
    best = np.zeros_like(g)
    for axis in (0, 1):
        def sh(k):
            return np.roll(g, -k, axis=axis)

        rise = sh(1) - sh(-1)
        side_a = np.abs(sh(-1) - sh(-3))
        side_b = np.abs(sh(3) - sh(1))
        across = np.abs(sh(2) - sh(-2))
        ok = (np.abs(rise) >= MIN_STEP * 0.6) & (across >= MIN_STEP) & (side_a < FLAT) & (side_b < FLAT)
        best = np.maximum(best, np.where(ok, across, 0))
    cand = best > 0
    # Built-up area only, not on buildings, water or carriageways.
    near = ndimage.distance_transform_edt(~footprint) <= URBAN
    cand &= near & ~ndimage.binary_dilation(footprint, iterations=2)
    img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(img)
    for a in m["areas"]:
        if a["k"] in ("water", "pool", "farmland", "meadow", "scrub", "forest", "orchard", "brownfield"):
            o = a["o"]
            d.polygon([(o[i] - minX, o[i + 1] - minZ) for i in range(0, len(o), 2)], fill=1)
    for key in ("rivers", "streams"):
        for r in m.get(key, []):
            p = r["p"]
            d.line([(p[i] - minX, p[i + 1] - minZ) for i in range(0, len(p), 2)], fill=1, width=int(r.get("w", 4)) + 12)
    for r in m["roads"]:
        if r.get("b") or r.get("tp"):
            continue
        p = r["p"]
        if r["k"] in ("footway", "path", "steps", "cycleway", "track", "pedestrian"):
            continue
        d.line([(p[i] - minX, p[i + 1] - minZ) for i in range(0, len(p), 2)], fill=1, width=int(r["w"] + 2))
    cand &= ~np.asarray(img, bool)
    cand = ndimage.binary_closing(cand, iterations=1)
    lab, n = ndimage.label(cand, structure=np.ones((3, 3)))
    sizes = ndimage.sum(cand, lab, range(1, n + 1))
    cand = np.isin(lab, 1 + np.nonzero(sizes >= MIN_LENGTH * 1.5)[0])
    out = []
    for path in trace_paths(skeletonize(cand)):
        length = float(np.sum(np.hypot(*np.diff(path, axis=0).T)))
        if length < MIN_LENGTH:
            continue
        simp = approximate_polygon(path.astype(float), tolerance=0.8)
        if len(simp) - 1 > max(1, length / 4):
            continue
        # Upper side and its level: sample 2.5 m to each side of every vertex.
        ups, tops, lows = [], [], []
        for i in range(len(simp)):
            a = simp[max(0, i - 1)]
            b = simp[min(len(simp) - 1, i + 1)]
            dr, dc = b - a
            L = np.hypot(dr, dc) or 1.0
            # Left of travel (x = col, z = row): (dz, -dx), i.e. (row, col) = (-dc, dr).
            nr, nc = -dc / L, dr / L
            r, c = simp[i]
            samples = []
            for s in (1, -1):
                rr = int(round(r + s * nr * 2.5))
                cc = int(round(c + s * nc * 2.5))
                samples.append(g[min(max(rr, 0), H - 1), min(max(cc, 0), W - 1)])
            ups.append(1 if samples[0] > samples[1] else -1)
            tops.append(max(samples))
            lows.append(min(samples))
        up = 1 if sum(ups) >= 0 else -1
        step = float(np.median(np.array(tops) - np.array(lows)))
        if step < MIN_STEP:
            continue
        pts = []
        for r, c in simp:
            pts += [round(minX + c + 0.5, 2), round(minZ + r + 0.5, 2)]
        out.append({"p": pts, "k": "retaining_wall", "h": round(min(step, 6.0), 2), "top": round(float(np.median(tops)) - H0, 2), "up": up, "src": "step"})
    m["barriers"].extend(out)
    return len(out)

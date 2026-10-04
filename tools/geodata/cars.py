"""
Parked cars where the LiDAR saw them (PNOA-LiDAR 2025), instead of bays
filled at random.

In car parks and along the kerbs, a parked car is a compact blob of low
points 1.0-2.6 m above the ground, about 4.5 x 1.8 m. Blobs are measured
with a principal-axis fit; a row of cars parked bumper to bumper is split
into cars of ~4.6 m. Output: m["cars"] = [x, z, heading, length, ...].
"""

import math

import numpy as np
from scipy import ndimage

from walls import VEHICLE, line_mask

PARK_KINDS = {"parking"}
GREEN_KINDS = {"grass", "park", "garden", "wood", "forest", "meadow", "farmland", "scrub", "orchard", "recreation", "allotments", "cemetery", "water", "wetland", "pitch", "sports", "playground", "village_green"}


def detect_cars(m, walls, building_mask_1m):
    E0, N0 = m["meta"]["utmOrigin"]["E"], m["meta"]["utmOrigin"]["N"]
    B = m["meta"]["bounds"]
    cell = float(walls["cell"])
    x0, y1 = float(walls["x0"]), float(walls["y1"])
    c0 = int((E0 + B["minX"] - x0) / cell)
    r0 = int((y1 - (N0 - B["minZ"])) / cell)
    W = int((B["maxX"] - B["minX"]) / cell)
    H = int((B["maxZ"] - B["minZ"]) / cell)

    def crop(a, dtype):
        out = np.zeros((H, W), dtype)
        rs, cs = max(0, -r0), max(0, -c0)
        re, ce = min(H, a.shape[0] - r0), min(W, a.shape[1] - c0)
        out[rs:re, cs:ce] = a[r0 + rs : r0 + re, c0 + cs : c0 + ce]
        return out

    count = crop(walls["count"], np.uint8)
    top = crop(walls["top"], np.float32)
    high = crop(walls["high"], bool)
    to_px = lambda x, z: ((x - B["minX"]) / cell, (z - B["minZ"]) / cell)  # noqa: E731

    # Where cars park: mapped car parks, and a 3.5 m band beside every carriageway.
    from PIL import Image, ImageDraw

    img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(img)
    green = Image.new("L", (W, H), 0)
    dg = ImageDraw.Draw(green)
    for a in m["areas"]:
        o = a["o"]
        ring = [to_px(o[i], o[i + 1]) for i in range(0, len(o), 2)]
        if a["k"] in PARK_KINDS:
            d.polygon(ring, fill=1)
        elif a["k"] in GREEN_KINDS:
            dg.polygon(ring, fill=1)
    parks = np.array(img, bool)
    greens = np.array(green, bool)
    roads = []
    for r in m["roads"]:
        # Parking aisles are mapped as service ways: cars stand right beside (and on) them.
        if r["k"] in VEHICLE and r["k"] != "service" and not r.get("b"):
            p = r["p"]
            roads.append(([to_px(p[i], p[i + 1]) for i in range(0, len(p), 2)], r["w"] / cell))
    carriage = line_mask((H, W), roads, None)
    kerb = ndimage.binary_dilation(carriage, iterations=int(3.5 / cell)) & ~ndimage.binary_erosion(carriage, iterations=int(1.0 / cell))
    # Cars stand on car parks, along kerbs, and in yards and open lots OSM does not map,
    # but not in parks, fields, woods and gardens (bushes there look like cars).
    where = (parks | kerb | ~greens) & ~carriage

    bld = np.kron(building_mask_1m, np.ones((2, 2), bool))[:H, :W]
    blob = (count >= 1) & (top > 1.0) & (top < 2.6) & where & ~ndimage.binary_dilation(bld, iterations=1) & ~high
    # Car roofs return few points per pass: grow every hit by 0.5 m so one car is one blob,
    # then take that growth off the measured size.
    grown = ndimage.binary_dilation(blob, iterations=1) & where
    lab, n = ndimage.label(grown, structure=np.ones((3, 3)))
    cars = []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        rr, cc = np.nonzero(lab[sl] == i)
        if rr.size < 14 or blob[sl][lab[sl] == i].sum() < 4:
            continue
        pts = np.stack([cc + sl[1].start + 0.5, rr + sl[0].start + 0.5], 1) * cell
        mean = pts.mean(0)
        cov = np.cov((pts - mean).T)
        evals, evecs = np.linalg.eigh(cov)
        major = evecs[:, 1]
        u = (pts - mean) @ major
        v = (pts - mean) @ evecs[:, 0]
        length = float(u.max() - u.min()) + cell - 1.0
        width = float(v.max() - v.min()) + cell - 1.0
        if not (1.1 <= width <= 2.8) or length < 2.8 or length > 40:
            continue
        # A car is a flat-topped box: its points fill most of its rectangle and share one height.
        hits = blob[sl] & (lab[sl] == i)
        tops = top[sl][hits]
        if tops.std() > 0.35 or float(np.median(tops)) > 2.3:
            continue
        if length < 6.5 and rr.size * cell * cell < 0.55 * (length + 1.0) * (width + 1.0):
            continue
        k = max(1, round(length / 4.6))
        if k == 1 and length > 6.0:
            continue
        seg = length / k
        for j in range(k):
            t = u.min() + seg * (j + 0.5)
            cx, cz = mean + major * t
            heading = math.atan2(major[0], major[1])
            if (hash((round(cx), round(cz))) & 1) == 1:
                heading += math.pi
            cars += [round(B["minX"] + cx, 2), round(B["minZ"] + cz, 2), round(heading, 3), round(min(seg, 5.2), 2)]
    m["cars"] = cars
    return len(cars) // 4

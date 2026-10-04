"""
Facade style and colour of every building, from the cadastre and its facade photo.

For each footprint of the map the cadastral building that contains it gives
the year of construction, the use and the number of dwellings
(catastro.py). The facade photo the cadastre publishes for that building
gives the colour of the wall and a hint of its material:

  - the wall colour is the largest cluster of mid-tone, low-saturation
    pixels in the middle of the photo (sky, windows, signs, cars and
    vegetation are left out);
  - brick shows up as an orange-red hue, stone masonry as a beige wall with
    strong fine-scale texture.

Styles (rows of the facade atlas in src/world/textures.ts):
  0 traditional  plastered house before 1950: tall windows, wooden shutters, iron balconies
  1 stone        stone masonry (mampostería / sillería) before 1950
  2 mid-century  1950-1975 plaster block: roller shutters, small balconies
  3 brick        exposed brick (ladrillo caravista), 1960-1995
  4 terraces     1976-2000 rendered block with continuous terraces
  5 modern       2000 onwards: large windows, glass railings
  6 civic        offices and public services: ribbon windows
  7 industrial   farm and industrial sheds (corrugated panels)
  8 galeria      whole facade of white glazed galerías (set from the photo review only)

Writes per footprint: fs (style), fc (wall colour 0xRRGGBB, when the photo
gives one), year, use; and the per-building review overrides in
data/facades.json (manual corrections from the photos) win over all of it.
"""

import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage
from shapely.geometry import Polygon
from shapely.strtree import STRtree

from roofs import footprint_polygon

STYLES = ["traditional", "stone", "mid", "brick", "terraces", "modern", "civic", "industrial", "galeria"]


def srgb_to_lab(rgb):
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], -1)


def analyse_photo(path):
    """-> {colour: 0xRRGGBB, brick: bool, stone: bool} or None."""
    try:
        im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    except Exception:  # noqa: BLE001
        return None
    h, w, _ = im.shape
    roi = im[int(h * 0.18) : int(h * 0.78), int(w * 0.22) : int(w * 0.78)]
    lab = srgb_to_lab(roi)
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    chroma = np.hypot(a, b)
    # Wall candidates: mid-tones, not sky blue, not vegetation green, not saturated signs.
    ok = (L > 38) & (L < 94) & (chroma < 38) & ~((b < -6) & (L > 60)) & ~((a < -8) & (b > 5))
    if ok.mean() < 0.15:
        return None
    px = lab[ok]
    # Coarse colour clusters on a 6-unit Lab grid; the most populated one is the wall.
    key = np.round(px / np.array([8.0, 6.0, 6.0])).astype(np.int32)
    keys, inv, counts = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    top = np.argsort(counts)[::-1][:3]
    mask_main = np.isin(inv.ravel(), top)
    wall_lab = px[mask_main]
    wall_rgb = roi[ok][mask_main]
    rgb = np.median(wall_rgb, axis=0)
    Lm, am, bm = np.median(wall_lab, axis=0)
    hue = np.degrees(np.arctan2(bm, am))
    brick = am > 11 and 20 < hue < 70 and Lm < 68
    # Stone: strong local contrast inside the wall area (joints between stones).
    grey = roi.mean(-1)
    detail = np.abs(grey - ndimage.uniform_filter(grey, 5))
    wall_px = np.zeros(ok.shape, bool)
    wall_px[ok] = mask_main
    texture = float(detail[wall_px].mean()) if wall_px.any() else 0.0
    stone = (not brick) and texture > 7.5 and 8 < bm < 30 and Lm < 82
    return {"colour": int(rgb[0]) << 16 | int(rgb[1]) << 8 | int(rgb[2]), "brick": bool(brick), "stone": bool(stone), "texture": round(texture, 1)}


def style_for(year, use, photo, dwellings=0):
    if use in ("2_agriculture", "3_industrial"):
        return 7
    if use in ("4_1_office", "4_3_publicServices"):
        return 6 if (year or 0) >= 1960 else (1 if photo and photo["stone"] else 0)
    if photo and photo["brick"] and (year or 1980) >= 1955:
        return 3
    if year is None:
        return 1 if photo and photo["stone"] else 0
    if year < 1950:
        return 1 if photo and photo["stone"] else 0
    if year < 1976:
        return 2
    if year < 2000:
        return 4
    # Recent single-family and terraced houses are rendered houses with balconies, not glass blocks.
    return 4 if dwellings <= 2 else 5


def bake_facades(m, cat_dir, overrides_path):
    path = os.path.join(cat_dir, "buildings.json")
    if not os.path.exists(path):
        return 0, 0
    cat = json.load(open(path))
    polys = [Polygon(list(zip(c["ring"][0::2], c["ring"][1::2]))).buffer(0) for c in cat]
    tree = STRtree(polys)
    photos = {}
    overrides = json.load(open(overrides_path)) if os.path.exists(overrides_path) else {}
    matched = with_photo = 0
    for b in m["buildings"]:
        for k in ("fs", "fc", "year", "use", "cref"):
            b.pop(k, None)
        if b.get("hp") and not b.get("part"):
            pass
        foot = footprint_polygon(b)
        if foot.is_empty:
            continue
        pt = foot.representative_point()
        hit = [int(i) for i in tree.query(pt) if polys[int(i)].contains(pt)]
        if not hit:
            # Traced from the LiDAR or not in the cadastre: by type only.
            b["fs"] = 7 if b.get("t") == "industrial" else 0
            continue
        c = cat[hit[0]]
        matched += 1
        ref = c["ref"]
        if ref not in photos:
            p = os.path.join(cat_dir, "fachadas", f"{ref}.jpg")
            photos[ref] = analyse_photo(p) if os.path.exists(p) else None
        ph = photos[ref]
        b["cref"] = ref
        if c["year"]:
            b["year"] = c["year"]
        if c["use"]:
            b["use"] = c["use"]
        b["fs"] = style_for(c["year"], c["use"], ph, c.get("dwellings", 0))
        if ph:
            with_photo += 1
            b["fc"] = ph["colour"]
        o = overrides.get(ref)
        if o:
            if "style" in o:
                b["fs"] = STYLES.index(o["style"])
            if "colour" in o:
                b["fc"] = int(o["colour"].lstrip("#"), 16)
            if "galeria" in o:
                b["gal"] = 1 if o["galeria"] else 0
    return matched, with_photo

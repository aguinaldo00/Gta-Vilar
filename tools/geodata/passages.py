"""
Passages through buildings (OSM tunnel=building_passage, covered=yes).

Villarcayo has streets and paths that run under buildings: the pedestrian
passage from Calle el Soto into Calle Santander, the CL-629 (Calle Obras
Públicas) under a block, covered alleys... Extruded as solids, those
buildings closed the street. Here every footprint the corridor crosses is
split in two:

  - the building itself is lifted to the passage's clear height (`lift`, m):
    its walls start there and a ceiling closes the underside;
  - the ground floor around the corridor becomes new footprints (`gf`: 1)
    that stop at that height, with the parent's style, and no roof.
"""

from shapely.geometry import LineString, MultiPolygon, Polygon

from roofs import footprint_polygon

KEEP = ("t", "n", "mat", "gy", "fs", "fc", "gal", "year", "use", "cref")


def open_passages(m):
    corridors = []
    for r in m["roads"]:
        if not r.get("tp"):
            continue
        p = r["p"]
        line = LineString([(p[i], p[i + 1]) for i in range(0, len(p), 2)])
        corridors.append((line.buffer(r["w"] / 2 + 0.3, cap_style=2), r["tp"]))
    if not corridors:
        return 0
    added, lifted = [], 0
    for b in m["buildings"]:
        if b.get("hp") or b.get("gf") or "gy" not in b:
            continue
        foot = footprint_polygon(b)
        if foot.is_empty:
            continue
        hits = [(c, h) for c, h in corridors if c.intersects(foot) and c.intersection(foot).area > 1.0]
        if not hits:
            continue
        clear = min(h for _, h in hits)
        wall_top = b.get("eave", b.get("top", b["gy"] + 6)) - b["gy"]
        if wall_top < clear + 2.0:
            continue  # a low canopy or shed over the path: leave it to the path
        b["lift"] = round(clear, 2)
        lifted += 1
        rest = foot
        for c, _ in hits:
            rest = rest.difference(c)
        pieces = list(rest.geoms) if isinstance(rest, MultiPolygon) else [rest] if isinstance(rest, Polygon) else []
        for piece in pieces:
            if piece.area < 2.0:
                continue
            piece = piece.simplify(0.05)
            gf = {k: b[k] for k in KEEP if k in b}
            gf["o"] = [round(v, 2) for xy in list(piece.exterior.coords)[:-1] for v in xy]
            if piece.interiors:
                gf["h"] = [[round(v, 2) for xy in list(h.coords)[:-1] for v in xy] for h in piece.interiors]
            gf["gf"] = 1
            gf["part"] = 1
            gf["top"] = round(b["gy"] + clear, 2)
            gf["eave"] = gf["top"]
            added.append(gf)
    m["buildings"].extend(added)
    return lifted

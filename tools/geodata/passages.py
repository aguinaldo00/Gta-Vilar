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
    that stop at that height, with the parent's style, and no roof;
  - a street with sidewalks keeps them under the building (a portico: the
    shops set back behind the kerb), with square pillars along the kerb
    every ~4 m (`m["pillars"]`: x, z, top), as under the CL-629;
  - a low building over the way (a shed, a garage over a service lane) is
    lifted as high as its walls allow, or opened when even that is too low.
"""

from shapely.geometry import LineString, MultiPolygon, Point, Polygon

from roofs import footprint_polygon

KEEP = ("t", "n", "mat", "gy", "fs", "fc", "gal", "year", "use", "cref")
SIDEWALK_W = 2.2  # as src/world/Roads.ts
PILLAR_STEP = 4.0
MIN_CLEAR = 2.4


def open_passages(m):
    corridors = []
    kerbs = []  # (line, half-width to the kerb) of passages with sidewalks
    for r in m["roads"]:
        if not r.get("tp"):
            continue
        p = r["p"]
        line = LineString([(p[i], p[i + 1]) for i in range(0, len(p), 2)])
        side = SIDEWALK_W if r.get("sw") else 0.0
        corridors.append((line.buffer(r["w"] / 2 + side + 0.3, cap_style=2), r["tp"]))
        if side:
            kerbs.append((line, r["w"] / 2 + 0.35))
    if not corridors:
        return 0
    added, lifted, dropped = [], 0, []
    pillars = []
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
        low = False
        if wall_top < clear + 2.0:
            # A low building over the way: as much clearance as its walls leave (at least 2 m of
            # building above), or the way simply cuts through it.
            clear = wall_top - 2.0
            low = clear < MIN_CLEAR
        if low:
            dropped.append(b)
        else:
            b["lift"] = round(clear, 2)
            lifted += 1
            # Pillars along the kerb under the building (portico).
            for line, half in kerbs:
                if not line.buffer(half + SIDEWALK_W).intersects(foot):
                    continue
                n = max(1, int(line.length // PILLAR_STEP))
                for k in range(n + 1):
                    d = k * line.length / n
                    a = line.interpolate(max(0.0, d - 0.5))
                    c = line.interpolate(min(line.length, d + 0.5))
                    dx, dz = c.x - a.x, c.y - a.y
                    ln = (dx * dx + dz * dz) ** 0.5 or 1.0
                    q = line.interpolate(d)
                    for sgn in (-1, 1):
                        x, z = q.x - dz / ln * half * sgn, q.y + dx / ln * half * sgn
                        if foot.buffer(-0.3).contains(Point(x, z)):
                            pillars += [round(x, 2), round(z, 2), round(b["gy"] + clear, 2)]
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
            if low:
                # The building itself, without the way through it.
                gf = {k: v for k, v in b.items() if k not in ("o", "h", "rf", "hid")}
                gf["o"] = [round(v, 2) for xy in list(piece.exterior.coords)[:-1] for v in xy]
                gf["part"] = 1
            else:
                gf["gf"] = 1
                gf["part"] = 1
                gf["top"] = round(b["gy"] + clear, 2)
                gf["eave"] = gf["top"]
            added.append(gf)
    m["buildings"] = [b for b in m["buildings"] if not any(b is d for d in dropped)]
    m["buildings"].extend(added)
    if pillars:
        m["pillars"] = pillars
    return lifted

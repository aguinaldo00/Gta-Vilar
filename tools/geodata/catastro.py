"""
Spanish cadastre (Dirección General del Catastro, INSPIRE Buildings) for the map.

    python3 tools/geodata/catastro.py public/maps/villarcayo.json raw/catastro

Reads the municipal INSPIRE download (A.ES.SDGC.BU.09473.building.gml, from
https://www.catastro.hacienda.gob.es/INSPIRE/Buildings/09/09473-.../A.ES.SDGC.BU.09473.zip)
and, for every building inside the map:
  - year of construction, current use, dwellings and building units,
  - the facade photo the cadastre publishes for it (OVCFotoFachada), downloaded
    once into raw/catastro/fachadas/<ref>.jpg (resized to 640 px, rate-limited).

Writes raw/catastro/buildings.json: [{ref, year, use, dwellings, units, ring: [x, z, ...] (local)}].
The baker (facades.py) matches these to the map footprints and derives the
facade style and colour.
"""

import io
import json
import os
import re
import sys
import time
import urllib.request

from PIL import Image

PHOTO = "http://ovc.catastro.meh.es/OVCServWeb/OVCWcfLibres/OVCFotoFachada.svc/RecuperarFotoFachadaGet?ReferenciaCatastral={}"
MAX_PX = 640


def parse(gml_path, E0, N0, bounds):
    s = open(gml_path, encoding="utf-8", errors="ignore").read()
    out = []
    for b in s.split("<bu-ext2d:Building gml:id=")[1:]:
        ref = re.search(r"<base:localId>(\w+)", b)
        pos = re.search(r'<gml:posList[^>]*>([^<]+)</gml:posList>', b)
        if not ref or not pos:
            continue
        v = [float(t) for t in pos.group(1).split()]
        ring = []
        for i in range(0, len(v) - 2, 2):  # last vertex repeats the first
            ring += [round(v[i] - E0, 2), round(N0 - v[i + 1], 2)]
        xs, zs = ring[0::2], ring[1::2]
        if max(xs) < bounds["minX"] or min(xs) > bounds["maxX"] or max(zs) < bounds["minZ"] or min(zs) > bounds["maxZ"]:
            continue
        g = lambda pat: (lambda mm: mm.group(1) if mm else None)(re.search(pat, b))  # noqa: E731
        year = g(r"<bu-core2d:beginning>(\d{4})")
        out.append(
            {
                "ref": ref.group(1),
                "year": int(year) if year else None,
                "use": g(r"<bu-ext2d:currentUse>(\w+)"),
                "dwellings": int(g(r"<bu-ext2d:numberOfDwellings>(\d+)") or 0),
                "units": int(g(r"<bu-ext2d:numberOfBuildingUnits>(\d+)") or 0),
                "ring": ring,
            }
        )
    return out


def fetch_photos(items, out_dir, delay=0.25):
    os.makedirs(out_dir, exist_ok=True)
    got = 0
    for k, it in enumerate(items):
        path = os.path.join(out_dir, f"{it['ref']}.jpg")
        if os.path.exists(path):
            continue
        for attempt in range(3):
            try:
                with urllib.request.urlopen(PHOTO.format(it["ref"]), timeout=60) as r:
                    data = r.read()
                im = Image.open(io.BytesIO(data)).convert("RGB")
                im.thumbnail((MAX_PX, MAX_PX))
                im.save(path, quality=88)
                got += 1
                break
            except Exception as e:  # noqa: BLE001
                err = e
                time.sleep(2 * (attempt + 1))
        else:
            open(path + ".missing", "w").write(str(err))
        time.sleep(delay)
        if k % 100 == 0:
            print(f"  {k}/{len(items)} photos", flush=True)
    return got


def main(map_path, cat_dir):
    m = json.load(open(map_path))
    E0, N0 = m["meta"]["utmOrigin"]["E"], m["meta"]["utmOrigin"]["N"]
    gml = [f for f in os.listdir(cat_dir) if f.endswith(".building.gml")][0]
    items = parse(os.path.join(cat_dir, gml), E0, N0, m["meta"]["bounds"])
    json.dump(items, open(os.path.join(cat_dir, "buildings.json"), "w"))
    print(f"{len(items)} cadastre buildings in the map")
    # Nearest the centre first, so the old town is ready early.
    items.sort(key=lambda it: (it["ring"][0] ** 2 + it["ring"][1] ** 2) ** 0.5)
    got = fetch_photos(items, os.path.join(cat_dir, "fachadas"))
    print(f"downloaded {got} facade photos")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

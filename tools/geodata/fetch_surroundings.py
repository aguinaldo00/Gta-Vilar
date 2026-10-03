"""
Real relief and imagery around the playable map (the hills of Las Merindades
on the horizon) from IGN services: MDT 25 m (WCS) and the PNOA orthophoto (WMS).

    python3 tools/geodata/fetch_surroundings.py public/maps/villarcayo.json

Writes public/maps/surroundings.bin (Int16, decimetres relative to the map
datum, row-major z rows x columns) and surroundings.jpg, plus meta.surroundings.
"""

import io
import json
import os
import sys
import urllib.request

import numpy as np
from PIL import Image
from scipy import ndimage

HALF = 12000  # m around the origin
DEM_CELL = 25
IMG_PX = 2048


def get(url):
    with urllib.request.urlopen(url, timeout=300) as r:
        return r.read()


def main(map_path):
    m = json.load(open(map_path))
    E0, N0 = m["meta"]["utmOrigin"]["E"], m["meta"]["utmOrigin"]["N"]
    datum = m["meta"]["terrain"]["datum"]
    e0, e1, n0, n1 = E0 - HALF, E0 + HALF, N0 - HALF, N0 + HALF
    dem = get(
        "https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage"
        f"&COVERAGEID=Elevacion25830_25&FORMAT=image/tiff&SUBSET=x({e0},{e1})&SUBSET=y({n0},{n1})"
    )
    im = Image.open(io.BytesIO(dem))
    tie, scale = im.tag_v2[33922], im.tag_v2[33550]
    a = ndimage.gaussian_filter(np.array(im).astype(np.float32), 1.0)
    # Grid node (r, c) sits at E = tieE + (c + .5) * s, N = tieN - (r + .5) * s.
    s = scale[0]
    minX = tie[3] + s / 2 - E0
    minZ = N0 - (tie[4] - s / 2)
    q = np.clip(np.round((a - datum) * 10), -32768, 32767).astype("<i2")
    out_dir = os.path.dirname(map_path)
    q.tofile(os.path.join(out_dir, "surroundings.bin"))
    img = get(
        "https://www.ign.es/wms-inspire/pnoa-ma?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=OI.OrthoimageCoverage"
        f"&STYLES=&CRS=EPSG:25830&BBOX={e0},{n0},{e1},{n1}&WIDTH={IMG_PX}&HEIGHT={IMG_PX}&FORMAT=image/jpeg"
    )
    Image.open(io.BytesIO(img)).convert("RGB").save(os.path.join(out_dir, "surroundings.jpg"), quality=82)
    m["meta"]["surroundings"] = {
        "file": "surroundings.bin",
        "image": "surroundings.jpg",
        "cols": int(a.shape[1]),
        "rows": int(a.shape[0]),
        "cell": float(s),
        "minX": float(minX),
        "minZ": float(minZ),
        "scale": 0.1,
        "imageBounds": [e0 - E0, N0 - n1, e1 - E0, N0 - n0],
        "source": "MDT25 and PNOA © Instituto Geográfico Nacional (CC BY 4.0)",
    }
    json.dump(m, open(map_path, "w"), separators=(",", ":"))
    print(f"surroundings {a.shape[1]}x{a.shape[0]} @ {s} m, relief {a.min() - datum:.0f} .. {a.max() - datum:.0f} m")


if __name__ == "__main__":
    main(sys.argv[1])

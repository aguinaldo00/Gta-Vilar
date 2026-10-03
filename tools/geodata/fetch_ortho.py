"""
Downloads the PNOA orthophoto (IGN WMS, EPSG:25830) as one JPEG per world tile.

    python3 tools/geodata/fetch_ortho.py public/maps/villarcayo.json public/maps/ortho

Tiles are TILE metres square on the local grid (x = E - E0, z = N0 - N), named
{i}_{j}.jpg for x = minX + i*TILE, z = minZ + j*TILE. Tiles near the origin are
fetched at 0.25 m/px, the rest at 0.5 m/px.
"""

import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

TILE = 256
WMS = "https://www.ign.es/wms-inspire/pnoa-ma"
FINE_RADIUS = 900  # m from the origin


def fetch(args):
    url, path = args
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return path, "cached"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                data = r.read()
            if data[:2] != b"\xff\xd8":
                raise RuntimeError(f"not a JPEG: {data[:120]!r}")
            open(path, "wb").write(data)
            return path, len(data)
        except Exception as e:  # noqa: BLE001
            err = e
    return path, f"FAILED {err}"


def main(map_path, out_dir):
    m = json.load(open(map_path))
    E0, N0 = m["meta"]["utmOrigin"]["E"], m["meta"]["utmOrigin"]["N"]
    b = m["meta"]["bounds"]
    nx = int((b["maxX"] - b["minX"] + TILE - 1) // TILE)
    nz = int((b["maxZ"] - b["minZ"] + TILE - 1) // TILE)
    os.makedirs(out_dir, exist_ok=True)
    jobs, tiles = [], []
    for j in range(nz):
        for i in range(nx):
            x0, z0 = b["minX"] + i * TILE, b["minZ"] + j * TILE
            cx, cz = x0 + TILE / 2, z0 + TILE / 2
            px = 1024 if (cx * cx + cz * cz) ** 0.5 < FINE_RADIUS else 512
            e0, e1 = E0 + x0, E0 + x0 + TILE
            n1, n0 = N0 - z0, N0 - z0 - TILE
            url = (
                f"{WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=OI.OrthoimageCoverage&STYLES=&CRS=EPSG:25830"
                f"&BBOX={e0},{n0},{e1},{n1}&WIDTH={px}&HEIGHT={px}&FORMAT=image/jpeg"
            )
            jobs.append((url, os.path.join(out_dir, f"{i}_{j}.jpg")))
            tiles.append({"i": i, "j": j, "px": px})
    with ThreadPoolExecutor(8) as ex:
        for path, res in ex.map(fetch, jobs):
            if isinstance(res, str) and res.startswith("FAILED"):
                print(path, res)
    m["meta"]["ortho"] = {
        "dir": os.path.basename(out_dir),
        "tile": TILE,
        "nx": nx,
        "nz": nz,
        "minX": b["minX"],
        "minZ": b["minZ"],
        "source": "PNOA máxima actualidad © Instituto Geográfico Nacional (CC BY 4.0)",
    }
    json.dump(m, open(map_path, "w"), separators=(",", ":"))
    total = sum(os.path.getsize(p) for _, p in jobs if os.path.exists(p))
    print(f"{nx}x{nz} tiles -> {out_dir} ({total / 1e6:.1f} MB)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

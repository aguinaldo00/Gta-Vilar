"""
Lossless 16-bit heightmaps in an ordinary 8-bit RGB PNG.

Each sample is a signed 16-bit integer stored with a +32768 offset: high byte
in red, low byte in green, blue unused. Browsers decode it exactly (opaque,
no colour profile) and every engine can read it (src/world/heightImage.ts,
or a few lines of GDScript / C# when the map is ported).
"""

import numpy as np
from PIL import Image


def write_height_png(q, path):
    u = (q.astype(np.int32) + 32768).astype(np.uint16)
    rgb = np.zeros(q.shape + (3,), np.uint8)
    rgb[..., 0] = u >> 8
    rgb[..., 1] = u & 255
    Image.fromarray(rgb, "RGB").save(path, optimize=True)


def read_height_png(path):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.int32)
    return (rgb[..., 0] * 256 + rgb[..., 1] - 32768).astype(np.int16)

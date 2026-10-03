import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** Minimal decoder for the 8-bit RGB/RGBA, non-interlaced PNGs the geodata tools write. Returns RGBA bytes. */
export function readPng(path: string): { width: number; height: number; rgba: Uint8Array } {
  const buf = readFileSync(path);
  let p = 8,
    width = 0,
    height = 0,
    channels = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error(`${path}: only 8-bit non-interlaced PNGs`);
      channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0;
      if (!channels) throw new Error(`${path}: only RGB or RGBA PNGs`);
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a),
          pb = Math.abs(q - b),
          pc = Math.abs(q - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = (raw[src + x] + pred) & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = px[i * channels];
    rgba[i * 4 + 1] = px[i * channels + 1];
    rgba[i * 4 + 2] = px[i * channels + 2];
    rgba[i * 4 + 3] = channels === 4 ? px[i * channels + 3] : 255;
  }
  return { width, height, rgba };
}

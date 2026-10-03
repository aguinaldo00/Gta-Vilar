import * as THREE from 'three';
import { Rng } from '../core/math';

type G = CanvasRenderingContext2D;

function canvasTexture(w: number, h: number, draw: (g: G, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function speckle(g: G, w: number, h: number, rng: Rng, count: number, colors: string[], size = 1): void {
  for (let i = 0; i < count; i++) {
    g.fillStyle = rng.pick(colors);
    const s = size * rng.range(0.5, 1.5);
    g.fillRect(rng.range(0, w), rng.range(0, h), s, s);
  }
}

function shade(base: [number, number, number], k: number): string {
  return `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`;
}

/** One facade bay (3.4 m x 3.1 m): plaster wall, window with sill and iron rail. */
export function facadeTexture(): THREE.CanvasTexture {
  const rng = new Rng(11);
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, rng, 900, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.08)', 'rgba(120,100,70,0.05)'], 2);
    g.fillStyle = '#ddd5c6';
    g.fillRect(36, 16, 56, 6); // lintel
    g.fillStyle = '#5e564b';
    g.fillRect(40, 22, 48, 72); // reveal
    const glass = g.createLinearGradient(0, 26, 0, 92);
    glass.addColorStop(0, '#6d8296');
    glass.addColorStop(1, '#222c36');
    g.fillStyle = glass;
    g.fillRect(44, 26, 40, 64);
    g.fillStyle = '#efece6';
    g.fillRect(62, 26, 4, 64);
    g.fillRect(44, 54, 40, 3);
    g.fillStyle = '#d6cfc1';
    g.fillRect(34, 92, 60, 6); // sill
    g.fillStyle = '#262626';
    g.fillRect(38, 72, 52, 3);
    for (let x = 40; x <= 88; x += 6) g.fillRect(x, 72, 2, 20);
  });
}

/** Sandstone ashlar (2 m x 2 m), like the Ayuntamiento and the Torre. */
export function ashlarTexture(): THREE.CanvasTexture {
  const rng = new Rng(21);
  return canvasTexture(256, 256, (g, w, h) => {
    const base: [number, number, number] = [218, 200, 160];
    g.fillStyle = '#b9a47d';
    g.fillRect(0, 0, w, h);
    const rowH = 32;
    for (let row = 0; row < h / rowH; row++) {
      const off = row % 2 ? 32 : 0;
      for (let x = -off; x < w; x += 64) {
        g.fillStyle = shade(base, rng.range(0.9, 1.04));
        g.fillRect(x + 1, row * rowH + 1, 62, rowH - 2);
      }
    }
    speckle(g, w, h, rng, 2500, ['rgba(80,60,30,0.08)', 'rgba(255,255,255,0.1)'], 2);
  });
}

/** Large granite slabs for the Plaza Mayor (4 m tile). */
export function pavingTexture(): THREE.CanvasTexture {
  const rng = new Rng(31);
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#9d968a';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        g.fillStyle = shade([206, 199, 186], rng.range(0.92, 1.03));
        g.fillRect(x * 64 + 1, y * 64 + 1, 62, 62);
      }
    }
    speckle(g, w, h, rng, 3000, ['rgba(0,0,0,0.07)', 'rgba(255,255,255,0.1)'], 1.5);
  });
}

/** Classic Spanish pavement tiles (2 m tile). */
export function sidewalkTexture(): THREE.CanvasTexture {
  const rng = new Rng(41);
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#9b978f';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        g.fillStyle = shade([196, 192, 184], rng.range(0.95, 1.03));
        g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
        g.fillStyle = 'rgba(0,0,0,0.12)';
        for (let i = 0; i < 4; i++) g.fillRect(x * 32 + 8 + (i % 2) * 14, y * 32 + 8 + Math.floor(i / 2) * 14, 3, 3);
      }
    }
  });
}

export function asphaltTexture(): THREE.CanvasTexture {
  const rng = new Rng(51);
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#4a4b4e';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, rng, 6000, ['#3d3e41', '#56575a', '#5f6063', '#333437'], 2);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(30,30,32,0.25)';
      g.beginPath();
      g.ellipse(rng.range(0, w), rng.range(0, h), rng.range(10, 40), rng.range(5, 20), rng.range(0, 3), 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Neutral detail texture; the terrain hue comes from vertex colours. */
export function groundDetailTexture(): THREE.CanvasTexture {
  const rng = new Rng(61);
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#e2e2e2';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${rng.pick(['255,255,255', '160,160,160'])},0.12)`;
      g.beginPath();
      g.arc(rng.range(0, w), rng.range(0, h), rng.range(8, 30), 0, Math.PI * 2);
      g.fill();
    }
    speckle(g, w, h, rng, 9000, ['#c8c8c8', '#f5f5f5', '#b4b4b4', '#d6d6d6'], 2);
  });
}

export function dirtTexture(): THREE.CanvasTexture {
  const rng = new Rng(71);
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#a28a64';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, rng, 2500, ['#8f774f', '#b49c74', '#7c6644'], 2);
  });
}

export function gravelTexture(): THREE.CanvasTexture {
  const rng = new Rng(81);
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#8c857a';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, rng, 4000, ['#6f695f', '#a59e92', '#5e584f', '#b8b1a5'], 2.5);
  });
}

/** Terracotta canal tiles (2 m tile). */
export function roofTexture(): THREE.CanvasTexture {
  const rng = new Rng(91);
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#9e4526';
    g.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 8 : 0;
      for (let x = -off; x < w; x += 16) {
        const grad = g.createLinearGradient(x, 0, x + 16, 0);
        const k = rng.range(0.9, 1.08);
        grad.addColorStop(0, shade([150, 64, 36], k));
        grad.addColorStop(0.5, shade([196, 96, 58], k));
        grad.addColorStop(1, shade([140, 58, 32], k));
        g.fillStyle = grad;
        g.fillRect(x + 1, row * 16, 14, 14);
      }
    }
    speckle(g, w, h, rng, 500, ['rgba(60,40,20,0.15)', 'rgba(255,230,200,0.08)'], 2);
  });
}

/** White glazed "galería" balconies typical of northern Burgos (1 m x 1.4 m pane). */
export function galeriaTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 96, (g, w, h) => {
    g.fillStyle = '#f7f6f1';
    g.fillRect(0, 0, w, h);
    const glass = g.createLinearGradient(0, 0, w, h);
    glass.addColorStop(0, '#9fb4c4');
    glass.addColorStop(1, '#4e6372');
    g.fillStyle = glass;
    g.fillRect(6, 6, w - 12, 26);
    g.fillRect(6, 38, (w - 16) / 2, h - 46);
    g.fillRect(10 + (w - 16) / 2, 38, (w - 16) / 2, h - 46);
  });
}

export function clockTexture(): THREE.CanvasTexture {
  const t = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#2b2b2b';
    g.beginPath();
    g.arc(128, 128, 126, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f1ecdc';
    g.beginPath();
    g.arc(128, 128, 116, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2b2b2b';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const long = i % 5 === 0;
      g.lineWidth = long ? 6 : 2;
      g.beginPath();
      g.moveTo(128 + Math.sin(a) * (long ? 88 : 100), 128 - Math.cos(a) * (long ? 88 : 100));
      g.lineTo(128 + Math.sin(a) * 110, 128 - Math.cos(a) * 110);
      g.stroke();
    }
    const hand = (a: number, len: number, wdt: number) => {
      g.lineWidth = wdt;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(128, 128);
      g.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len);
      g.stroke();
    };
    hand((10 / 12) * Math.PI * 2 + 0.09, 55, 8);
    hand((2 / 12) * Math.PI * 2, 85, 5);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function flagTexture(kind: 'es' | 'cyl' | 'eu'): THREE.CanvasTexture {
  const t = canvasTexture(96, 64, (g, w, h) => {
    if (kind === 'es') {
      g.fillStyle = '#c60b1e';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffc400';
      g.fillRect(0, h / 4, w, h / 2);
    } else if (kind === 'cyl') {
      // Castilla y León: quartered castle (red) and lion (white) fields.
      const q = [
        ['#b5121b', '#f4f1ea'],
        ['#f4f1ea', '#b5121b'],
      ];
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          g.fillStyle = q[i][j];
          g.fillRect((j * w) / 2, (i * h) / 2, w / 2, h / 2);
        }
      g.fillStyle = '#f2c230';
      g.fillRect(16, 10, 16, 14);
      g.fillRect(64, 42, 16, 14);
      g.fillStyle = '#7b2a6f';
      g.fillRect(64, 8, 14, 18);
      g.fillRect(16, 40, 14, 18);
    } else {
      g.fillStyle = '#1f3d99';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffcc00';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.beginPath();
        g.arc(w / 2 + Math.sin(a) * 18, h / 2 - Math.cos(a) * 18, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Wrought iron railing with scrolls (transparent background, used with alphaTest). */
export function ironworkTexture(): THREE.CanvasTexture {
  const t = canvasTexture(256, 96, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#3e6e66';
    g.fillStyle = '#3e6e66';
    g.lineWidth = 6;
    g.fillRect(0, 0, w, 8);
    g.fillRect(0, h - 8, w, 8);
    g.lineWidth = 4;
    for (let x = 0; x <= w; x += 64) {
      g.fillRect(x - 2, 0, 5, h);
      for (const dir of [1, -1]) {
        g.beginPath();
        g.arc(x + 32, h / 2 + dir * 16, 14, 0, Math.PI * 1.6 * dir, dir < 0);
        g.stroke();
      }
    }
  });
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function corrugatedTexture(): THREE.CanvasTexture {
  const rng = new Rng(101);
  return canvasTexture(128, 128, (g, w, h) => {
    for (let x = 0; x < w; x += 8) {
      const grad = g.createLinearGradient(x, 0, x + 8, 0);
      grad.addColorStop(0, '#9a9c97');
      grad.addColorStop(0.5, '#c4c6c0');
      grad.addColorStop(1, '#7c7e79');
      g.fillStyle = grad;
      g.fillRect(x, 0, 8, h);
    }
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${rng.int(110, 150)},${rng.int(50, 70)},${rng.int(20, 35)},${rng.range(0.06, 0.2)})`;
      g.beginPath();
      g.ellipse(rng.range(0, w), rng.range(0, h), rng.range(4, 18), rng.range(8, 30), 0, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Ploughed / crop rows, tinted per field via the material colour. */
export function fieldTexture(): THREE.CanvasTexture {
  const rng = new Rng(111);
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#d9d9d9';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) {
      g.fillStyle = '#9e9e9e';
      g.fillRect(0, y, w, 3);
    }
    speckle(g, w, h, rng, 1500, ['#bdbdbd', '#f0f0f0', '#8a8a8a'], 2);
  });
}

export function woodTexture(): THREE.CanvasTexture {
  const rng = new Rng(121);
  return canvasTexture(128, 128, (g, w, h) => {
    for (let y = 0; y < h; y += 16) {
      g.fillStyle = shade([150, 108, 70], rng.range(0.85, 1.05));
      g.fillRect(0, y, w, 15);
      g.fillStyle = 'rgba(40,25,10,0.5)';
      g.fillRect(0, y + 15, w, 1);
    }
    speckle(g, w, h, rng, 600, ['rgba(60,35,15,0.25)'], 3);
  });
}

/** Mottled bark of the pollarded plane trees ("plátanos") in the plaza. */
export function barkTexture(): THREE.CanvasTexture {
  const rng = new Rng(131);
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#d7d2c0';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = rng.pick(['#a9a690', '#8f8f78', '#e6e2d3', '#b8b49c']);
      g.beginPath();
      g.ellipse(rng.range(0, w), rng.range(0, h), rng.range(4, 16), rng.range(3, 10), rng.range(0, 3), 0, Math.PI * 2);
      g.fill();
    }
  });
}

export function signTexture(text: string, bg: string, fg: string, w = 512, h = 96): THREE.CanvasTexture {
  const t = canvasTexture(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = fg;
    g.lineWidth = 6;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = fg;
    g.font = `bold ${Math.floor(h * 0.5)}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2, w - 30);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/**
 * Tangent-space normal map from a texture's luminance (bright = raised):
 * window recesses sink, frames and tile ridges stand out.
 */
export function normalMapFrom(tex: THREE.CanvasTexture, strength = 2): THREE.CanvasTexture {
  const src = tex.image as HTMLCanvasElement;
  const w = src.width,
    h = src.height;
  const data = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const out = g.createImageData(w, h);
  const at = (x: number, y: number) => lum[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * Facade atlas, two cells of one bay (3.4 m x 3.1 m):
 * left = upper storey (window with stone surround, wooden shutters, iron
 * balcony rail, sill and weathering); right = ground floor (sandstone plinth,
 * doorway or shop front). The facade shader picks the cell by storey.
 */
export function facadeAtlasTexture(): THREE.CanvasTexture {
  const rng = new Rng(17);
  const C = 256;
  return canvasTexture(C * 4, C, (g) => {
    const plaster = (x0: number) => {
      g.fillStyle = '#f2eee6';
      g.fillRect(x0, 0, C, C);
      for (let i = 0; i < 1800; i++) {
        g.fillStyle = rng.pick(['rgba(0,0,0,0.035)', 'rgba(255,255,255,0.06)', 'rgba(140,110,70,0.04)', 'rgba(90,80,60,0.03)']);
        const s = rng.range(1, 4);
        g.fillRect(x0 + rng.range(0, C), rng.range(0, C), s, s);
      }
      // Faint damp stains near the ground and under the cornice.
      const grad = g.createLinearGradient(0, C * 0.75, 0, C);
      grad.addColorStop(0, 'rgba(90,80,60,0)');
      grad.addColorStop(1, 'rgba(90,80,60,0.10)');
      g.fillStyle = grad;
      g.fillRect(x0, C * 0.75, C, C * 0.25);
    };
    const stoneFrame = (x: number, y: number, w: number, h: number, t: number) => {
      g.fillStyle = '#d9cba9';
      g.fillRect(x - t, y - t, w + 2 * t, h + 2 * t);
      g.strokeStyle = 'rgba(80,60,30,0.35)';
      g.lineWidth = 1;
      for (let yy = y - t; yy < y + h + t; yy += 18) g.strokeRect(x - t, yy, w + 2 * t, 18);
    };

    // ---- Upper storey.
    plaster(0);
    const wx = 78,
      wy = 40,
      ww = 100,
      wh = 150;
    stoneFrame(wx, wy, ww, wh, 10);
    // Shutters (contraventanas), opened against the wall.
    const shutter = rng.pick(['#5a3b22', '#3f5a3a', '#6b4a2b']);
    for (const sx of [wx - 52, wx + ww + 12]) {
      g.fillStyle = shutter;
      g.fillRect(sx, wy - 6, 40, wh + 8);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let yy = wy; yy < wy + wh; yy += 8) g.fillRect(sx + 3, yy, 34, 2);
    }
    g.fillStyle = '#3b3229';
    g.fillRect(wx, wy, ww, wh);
    const glass = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
    glass.addColorStop(0, '#8aa2b6');
    glass.addColorStop(0.45, '#33424f');
    glass.addColorStop(1, '#1b232b');
    g.fillStyle = glass;
    g.fillRect(wx + 6, wy + 6, ww - 12, wh - 12);
    g.fillStyle = '#efe9dd';
    g.fillRect(wx + ww / 2 - 3, wy + 6, 6, wh - 12);
    g.fillRect(wx + 6, wy + 58, ww - 12, 5);
    // Sill and wrought-iron balcony rail.
    g.fillStyle = '#cfc3a6';
    g.fillRect(wx - 18, wy + wh + 8, ww + 36, 10);
    g.fillStyle = '#1f1f1f';
    g.fillRect(wx - 14, wy + 100, ww + 28, 4);
    g.fillRect(wx - 14, wy + wh + 2, ww + 28, 4);
    for (let x = wx - 12; x <= wx + ww + 12; x += 9) g.fillRect(x, wy + 100, 3, wh - 98);
    // Weathering streaks below the sill.
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(110,95,70,0.08)';
      g.fillRect(wx + rng.range(0, ww), wy + wh + 18, rng.range(2, 5), rng.range(15, 50));
    }

    // ---- Ground floor.
    plaster(C);
    // Sandstone plinth (zócalo).
    g.fillStyle = '#c9b48a';
    g.fillRect(C, C - 64, C, 64);
    g.strokeStyle = 'rgba(70,55,30,0.45)';
    for (let yy = C - 64; yy < C; yy += 21) {
      for (let xx = C + ((yy / 21) % 2) * 20; xx < C * 2; xx += 40) g.strokeRect(xx, yy, 40, 21);
    }
    // Doorway / shop front with a stone frame.
    const dx = C + 70,
      dy = 30,
      dw = 116,
      dh = C - 30;
    stoneFrame(dx, dy, dw, dh, 12);
    const door = rng.pick(['#4a2f1c', '#5b3a22', '#2f3d2f']);
    g.fillStyle = door;
    g.fillRect(dx, dy, dw, dh);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (const px of [dx + 10, dx + dw / 2 + 4]) {
      g.fillRect(px, dy + 14, dw / 2 - 14, dh * 0.4);
      g.fillRect(px, dy + 26 + dh * 0.4, dw / 2 - 14, dh * 0.45);
    }
    const fan = g.createLinearGradient(0, dy, 0, dy + 26);
    fan.addColorStop(0, '#9fb2c0');
    fan.addColorStop(1, '#3b4855');
    g.fillStyle = fan;
    g.fillRect(dx + 6, dy + 2, dw - 12, 10);

    // ---- Ground floor variant: barred window over the stone plinth.
    const X = C * 2;
    plaster(X);
    g.fillStyle = '#c9b48a';
    g.fillRect(X, C - 64, C, 64);
    g.strokeStyle = 'rgba(70,55,30,0.45)';
    for (let yy = C - 64; yy < C; yy += 21) {
      for (let xx = X + ((yy / 21) % 2) * 20; xx < X + C; xx += 40) g.strokeRect(xx, yy, 40, 21);
    }
    const bx = X + 84,
      by = 56,
      bw = 88,
      bh = 110;
    stoneFrame(bx, by, bw, bh, 10);
    const gl = g.createLinearGradient(bx, by, bx + bw, by + bh);
    gl.addColorStop(0, '#7f96a8');
    gl.addColorStop(1, '#1f2830');
    g.fillStyle = gl;
    g.fillRect(bx, by, bw, bh);
    g.fillStyle = '#1b1b1b';
    for (let x = bx + 6; x < bx + bw; x += 14) g.fillRect(x, by - 4, 4, bh + 8);
    g.fillRect(bx - 4, by + bh / 2 - 2, bw + 8, 4);
    // Unused 4th cell: plain plaster (kept so the atlas is a power of two wide).
    plaster(C * 3);
  });
}

/** Terracotta "teja árabe": staggered curved tiles with moss and soot. */
export function roofTilesTexture(): THREE.CanvasTexture {
  const rng = new Rng(93);
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#7d3a22';
    g.fillRect(0, 0, w, h);
    for (let row = 0; row < 16; row++) {
      const off = row % 2 ? 8 : 0;
      for (let x = -off; x < w; x += 16) {
        const k = rng.range(0.82, 1.1);
        const grad = g.createLinearGradient(x, 0, x + 16, 0);
        grad.addColorStop(0, `rgb(${110 * k},${46 * k},${26 * k})`);
        grad.addColorStop(0.45, `rgb(${196 * k},${98 * k},${60 * k})`);
        grad.addColorStop(1, `rgb(${104 * k},${42 * k},${24 * k})`);
        g.fillStyle = grad;
        g.fillRect(x + 1, row * 16 + 1, 14, 15);
        g.fillStyle = 'rgba(40,20,10,0.35)';
        g.fillRect(x + 1, row * 16 + 14, 14, 2);
      }
    }
    for (let i = 0; i < 70; i++) {
      g.fillStyle = rng.pick(['rgba(90,100,50,0.18)', 'rgba(40,35,30,0.15)', 'rgba(230,200,160,0.10)']);
      g.beginPath();
      g.ellipse(rng.range(0, w), rng.range(0, h), rng.range(4, 18), rng.range(3, 10), 0, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/**
 * The same roof tiles in neutral grey with a mean of 50 % (sRGB), so the
 * vertex colour sets the real colour of each roof (sampled from the
 * orthophoto: red tiles, dark slate, faded terracotta...).
 */
export function neutralRoofTilesTexture(): THREE.CanvasTexture {
  const src = roofTilesTexture().image as HTMLCanvasElement;
  return canvasTexture(src.width, src.height, (g, w, h) => {
    g.drawImage(src, 0, 0);
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    const k = 128 / (sum / (d.length / 4));
    for (let i = 0; i < d.length; i += 4) {
      const l = Math.min(255, (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) * k);
      d[i] = d[i + 1] = d[i + 2] = l;
    }
    g.putImageData(img, 0, 0);
  });
}

/** Ground detail: grass blades, soil and pebbles, neutral enough to be tinted by land use. */
export function grassDetailTexture(): THREE.CanvasTexture {
  const rng = new Rng(63);
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#d0d0d0';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = rng.pick(['rgba(255,255,255,0.10)', 'rgba(110,110,110,0.10)']);
      g.beginPath();
      g.arc(rng.range(0, w), rng.range(0, h), rng.range(10, 60), 0, Math.PI * 2);
      g.fill();
    }
    g.lineCap = 'round';
    for (let i = 0; i < 14000; i++) {
      const x = rng.range(0, w),
        y = rng.range(0, h);
      const l = rng.range(3, 9);
      const a = rng.range(-0.6, 0.6) - Math.PI / 2;
      g.strokeStyle = rng.pick(['#e8e8e8', '#b8b8b8', '#f4f4f4', '#a0a0a0', '#cccccc']);
      g.lineWidth = rng.range(0.6, 1.4);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    for (let i = 0; i < 300; i++) {
      g.fillStyle = rng.pick(['#9a9a9a', '#e0e0e0', '#888888']);
      g.beginPath();
      g.ellipse(rng.range(0, w), rng.range(0, h), rng.range(1, 3), rng.range(1, 2.5), rng.range(0, 3), 0, Math.PI * 2);
      g.fill();
    }
  });
}

/**
 * Tree atlas: an alpha-tested cluster of leaves (u < 0.75) for crown cards and
 * an opaque bark strip (u > 0.8) for trunks, so a whole tree is one material.
 */
export function treeAtlasTexture(): THREE.CanvasTexture {
  const rng = new Rng(77);
  const t = canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cw = w * 0.75;
    for (let i = 0; i < 1500; i++) {
      const r = Math.sqrt(rng.next()) * (cw * 0.47);
      const a = rng.range(0, Math.PI * 2);
      const x = cw / 2 + Math.cos(a) * r,
        y = h / 2 + Math.sin(a) * r * 0.95;
      const k = rng.range(0.55, 1.2) * (1.05 - (r / cw) * 0.5);
      g.fillStyle = `rgb(${Math.round(112 * k)},${Math.round(150 * k)},${Math.round(62 * k)})`;
      g.beginPath();
      g.ellipse(x, y, rng.range(3.5, 7), rng.range(2, 3.6), rng.range(0, Math.PI), 0, Math.PI * 2);
      g.fill();
    }
    for (let y = 0; y < h; y++) {
      const k = 0.75 + 0.25 * Math.sin(y * 0.7) + rng.range(-0.1, 0.1);
      g.fillStyle = `rgb(${Math.round(92 * k)},${Math.round(76 * k)},${Math.round(58 * k)})`;
      g.fillRect(w * 0.8, y, w * 0.2, 1);
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** River stones seen through shallow water. */
export function riverbedTexture(): THREE.CanvasTexture {
  const rng = new Rng(55);
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#8a7c63';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const k = rng.range(0.7, 1.25);
      g.fillStyle = `rgb(${Math.round(150 * k)},${Math.round(138 * k)},${Math.round(118 * k)})`;
      g.beginPath();
      g.ellipse(rng.range(0, w), rng.range(0, h), rng.range(2, 9), rng.range(2, 6), rng.range(0, 3), 0, Math.PI * 2);
      g.fill();
    }
  });
}

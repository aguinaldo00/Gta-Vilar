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
      const q = [['#b5121b', '#f4f1ea'], ['#f4f1ea', '#b5121b']];
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        g.fillStyle = q[i][j];
        g.fillRect(j * w / 2, i * h / 2, w / 2, h / 2);
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

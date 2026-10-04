import * as THREE from 'three';
import { Rng } from '../core/math';

type G = CanvasRenderingContext2D;

/**
 * Facade styles of the town, one row of the atlas each (index = MapBuilding.fs,
 * chosen per building from the cadastre year and use and its facade photo in
 * tools/geodata/facades.py).
 */
export const FACADE_STYLES = ['traditional', 'stone', 'mid', 'brick', 'terraces', 'modern', 'civic', 'industrial', 'galeria'] as const;
export const N_STYLES = FACADE_STYLES.length;
/** Atlas columns: upper storey, ground-floor door, ground-floor window, upper storey (variant). */
export const N_CELLS = 4;
/** Cell size in pixels: one bay (u = 1) by one storey (v = 1). */
const C = 256;

/** Default wall colours per style when there is no facade photo. */
export const STYLE_COLOURS: string[][] = [
  ['#efe9dc', '#e8d7b5', '#f5f2ea', '#dcc39b', '#ead0bb'],
  ['#d6c7a4', '#cdbd99', '#c9b892', '#d9cfb5'],
  ['#e9e4d8', '#e0d2b8', '#d8cdb8', '#efe6cf'],
  ['#b0664a', '#a35a42', '#b8735a', '#9c5a46'],
  ['#e7e1d4', '#d9cdb5', '#efe7d3', '#cfc4ae'],
  ['#f1efea', '#e4e2dc', '#d8d6cf', '#f3ecdc'],
  ['#d8d3c8', '#c9c2b4', '#b23d33', '#e2dccf'],
  ['#d9dbd6', '#cfd2cc', '#e2ddd0'],
  ['#efe9dc', '#e6d8b9', '#f4f0e6'],
];

/** One cell's painter: draws into (x0, y0)-(x0 + C, y0 + C); y grows downwards (top of the storey first). */
type Painter = (g: G, x0: number, y0: number, rng: Rng) => void;

// ------------------------------------------------------------------ walls (neutral, tinted per building)

function plaster(g: G, x0: number, y0: number, rng: Rng, base = 238): void {
  g.fillStyle = `rgb(${base},${base},${base})`;
  g.fillRect(x0, y0, C, C);
  for (let i = 0; i < 1400; i++) {
    const v = base + rng.range(-14, 10);
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    const s = rng.range(1, 4);
    g.fillRect(x0 + rng.range(0, C), y0 + rng.range(0, C), s, s);
  }
}

function brickWall(g: G, x0: number, y0: number, rng: Rng): void {
  g.fillStyle = 'rgb(205,205,205)';
  g.fillRect(x0, y0, C, C);
  const bh = 11,
    bw = 32;
  for (let r = 0; r * bh < C; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let x = -off; x < C; x += bw) {
      const v = Math.round(rng.range(212, 250));
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x0 + x + 1, y0 + r * bh + 1, bw - 2, bh - 2);
    }
  }
}

function stoneWall(g: G, x0: number, y0: number, rng: Rng): void {
  // Mampostería: irregular stones in courses with darker mortar.
  g.fillStyle = 'rgb(170,170,170)';
  g.fillRect(x0, y0, C, C);
  let y = 0;
  while (y < C) {
    const h = rng.range(14, 26);
    let x = -rng.range(0, 20);
    while (x < C) {
      const w = rng.range(18, 42);
      const v = Math.round(rng.range(205, 245));
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath();
      g.roundRect(x0 + x + 1.5, y0 + y + 1.5, w - 3, h - 3, 4);
      g.fill();
      x += w;
    }
    y += h;
  }
}

function corrugated(g: G, x0: number, y0: number): void {
  for (let x = 0; x < C; x += 16) {
    const grad = g.createLinearGradient(x0 + x, 0, x0 + x + 16, 0);
    grad.addColorStop(0, 'rgb(215,215,215)');
    grad.addColorStop(0.5, 'rgb(250,250,250)');
    grad.addColorStop(1, 'rgb(200,200,200)');
    g.fillStyle = grad;
    g.fillRect(x0 + x, y0, 16, C);
  }
}

// ------------------------------------------------------------------ details (keep their own colour)

function glass(g: G, x: number, y: number, w: number, h: number): void {
  const gr = g.createLinearGradient(x, y, x + w, y + h);
  gr.addColorStop(0, '#8ea6b8');
  gr.addColorStop(0.45, '#34444f');
  gr.addColorStop(1, '#1a2229');
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
}

function frame(g: G, x: number, y: number, w: number, h: number, colour: string, t: number, mullions = 1, transom = 0): void {
  g.fillStyle = colour;
  g.fillRect(x - t, y - t, w + 2 * t, h + 2 * t);
  glass(g, x, y, w, h);
  g.fillStyle = colour;
  for (let k = 1; k <= mullions; k++) g.fillRect(x + (w * k) / (mullions + 1) - t / 2, y, t, h);
  if (transom) g.fillRect(x, y + transom, w, t);
}

/** Roller shutter (persiana) pulled `down` of the way. */
function persiana(g: G, x: number, y: number, w: number, h: number, down: number, colour = '#cfc9bd'): void {
  g.fillStyle = colour;
  g.fillRect(x, y, w, h * down);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let yy = y + 4; yy < y + h * down; yy += 6) g.fillRect(x, yy, w, 1.5);
}

function railing(g: G, x: number, y: number, w: number, h: number, colour = '#1f1f1f', gap = 9): void {
  g.fillStyle = colour;
  g.fillRect(x, y, w, 4);
  g.fillRect(x, y + h - 4, w, 4);
  for (let xx = x + 2; xx < x + w; xx += gap) g.fillRect(xx, y, 3, h);
}

function stoneSurround(g: G, x: number, y: number, w: number, h: number, t: number): void {
  g.fillStyle = '#d9cba9';
  g.fillRect(x - t, y - t, w + 2 * t, h + 2 * t);
  g.strokeStyle = 'rgba(80,60,30,0.35)';
  g.lineWidth = 1;
  for (let yy = y - t; yy < y + h + t; yy += 18) g.strokeRect(x - t, yy, w + 2 * t, 18);
}

function woodDoor(g: G, x: number, y: number, w: number, h: number, colour: string): void {
  g.fillStyle = colour;
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (const px of [x + 8, x + w / 2 + 4]) {
    g.fillRect(px, y + 12, w / 2 - 12, h * 0.4);
    g.fillRect(px, y + 24 + h * 0.4, w / 2 - 12, h * 0.42);
  }
}

function plinth(g: G, x0: number, y0: number, colour = '#c9b48a', h = 56): void {
  g.fillStyle = colour;
  g.fillRect(x0, y0 + C - h, C, h);
  g.strokeStyle = 'rgba(70,55,30,0.4)';
  g.lineWidth = 1;
  for (let yy = y0 + C - h; yy < y0 + C; yy += 19)
    for (let xx = x0 + ((yy / 19) % 2) * 20; xx < x0 + C; xx += 40) g.strokeRect(xx, yy, 40, 19);
}

function shutters(g: G, x: number, y: number, w: number, h: number, colour: string): void {
  for (const sx of [x - w / 2 - 8, x + w + 8]) {
    g.fillStyle = colour;
    g.fillRect(sx, y - 4, w / 2, h + 6);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let yy = y; yy < y + h; yy += 8) g.fillRect(sx + 3, yy, w / 2 - 6, 2);
  }
}

// ------------------------------------------------------------------ styles: [upper, door, ground window, upper B]

const SHUTTERS = ['#5a3b22', '#3f5a3a', '#6b4a2b', '#7a2e24'];
const DOORS = ['#4a2f1c', '#5b3a22', '#2f3d2f', '#3a2a20'];

const STYLES: { wall: Painter; cells: [Painter, Painter, Painter, Painter] }[] = [
  // 0 traditional: tall window in a stone surround, wooden shutters, iron balcony.
  {
    wall: (g, x, y, r) => plaster(g, x, y, r),
    cells: [
      (g, x, y, r) => {
        stoneSurround(g, x + 82, y + 40, 92, 150, 9);
        shutters(g, x + 82, y + 40, 92, 150, r.pick(SHUTTERS));
        frame(g, x + 82, y + 40, 92, 150, '#efe9dd', 5, 1, 56);
        g.fillStyle = '#cfc3a6';
        g.fillRect(x + 62, y + 196, 132, 10);
        railing(g, x + 66, y + 140, 124, 54);
      },
      (g, x, y, r) => {
        plinth(g, x, y);
        stoneSurround(g, x + 70, y + 34, 116, C - 34, 11);
        woodDoor(g, x + 70, y + 34, 116, C - 34, r.pick(DOORS));
      },
      (g, x, y) => {
        plinth(g, x, y);
        stoneSurround(g, x + 84, y + 60, 88, 104, 9);
        glass(g, x + 84, y + 60, 88, 104);
        railing(g, x + 82, y + 56, 92, 112, '#1b1b1b', 14);
      },
      (g, x, y, r) => {
        stoneSurround(g, x + 88, y + 52, 80, 124, 9);
        shutters(g, x + 88, y + 52, 80, 124, r.pick(SHUTTERS));
        frame(g, x + 88, y + 52, 80, 124, '#efe9dd', 5, 1);
        g.fillStyle = '#cfc3a6';
        g.fillRect(x + 76, y + 180, 104, 9);
      },
    ],
  },
  // 1 stone masonry: dressed-stone jambs and lintel, wooden windows, iron balcony on a stone slab.
  {
    wall: (g, x, y, r) => stoneWall(g, x, y, r),
    cells: [
      (g, x, y) => {
        g.fillStyle = '#e4dccb';
        g.fillRect(x + 72, y + 30, 112, 22);
        g.fillRect(x + 72, y + 30, 18, 168);
        g.fillRect(x + 166, y + 30, 18, 168);
        frame(g, x + 90, y + 52, 76, 140, '#6b4a2b', 5, 1, 50);
        g.fillStyle = '#e4dccb';
        g.fillRect(x + 56, y + 198, 144, 14);
        railing(g, x + 60, y + 146, 136, 52);
      },
      (g, x, y, r) => {
        g.fillStyle = '#e4dccb';
        g.beginPath();
        g.arc(x + 128, y + 96, 66, Math.PI, 0);
        g.fill();
        g.fillRect(x + 62, y + 96, 132, C - 96);
        g.fillStyle = r.pick(DOORS);
        g.beginPath();
        g.arc(x + 128, y + 100, 52, Math.PI, 0);
        g.fill();
        woodDoor(g, x + 76, y + 100, 104, C - 100, r.pick(DOORS));
      },
      (g, x, y) => {
        g.fillStyle = '#e4dccb';
        g.fillRect(x + 86, y + 70, 84, 94);
        frame(g, x + 98, y + 82, 60, 72, '#5a3b22', 4, 1);
        railing(g, x + 96, y + 80, 64, 76, '#1b1b1b', 12);
      },
      (g, x, y) => {
        g.fillStyle = '#e4dccb';
        g.fillRect(x + 82, y + 50, 92, 120);
        frame(g, x + 96, y + 64, 64, 92, '#6b4a2b', 4, 1);
        g.fillStyle = 'rgba(200,40,60,0.9)';
        for (let k = 0; k < 7; k++) g.fillRect(x + 92 + k * 10, y + 156, 6, 6);
      },
    ],
  },
  // 2 mid-century (1950-75): plain plaster, roller shutters, a small projecting balcony.
  {
    wall: (g, x, y, r) => plaster(g, x, y, r, 236),
    cells: [
      (g, x, y) => {
        frame(g, x + 84, y + 54, 88, 132, '#f0f0ea', 5, 1);
        persiana(g, x + 84, y + 54, 88, 132, 0.45);
        g.fillStyle = '#d8d3c6';
        g.fillRect(x + 74, y + 192, 108, 9);
      },
      (g, x, y) => {
        plinth(g, x, y, '#b9b2a2', 40);
        g.fillStyle = '#6f6a62';
        g.fillRect(x + 62, y + 40, 132, C - 40);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        for (let yy = y + 50; yy < y + C; yy += 10) g.fillRect(x + 64, yy, 128, 2);
      },
      (g, x, y) => {
        plinth(g, x, y, '#b9b2a2', 40);
        frame(g, x + 80, y + 66, 96, 104, '#e8e6df', 5, 1);
        persiana(g, x + 80, y + 66, 96, 104, 0.6);
      },
      (g, x, y) => {
        frame(g, x + 82, y + 30, 92, 166, '#f0f0ea', 5, 1, 0);
        persiana(g, x + 82, y + 30, 92, 166, 0.35);
        g.fillStyle = '#cfc9bb';
        g.fillRect(x + 54, y + 196, 148, 12);
        railing(g, x + 56, y + 142, 144, 54, '#2a2a2a', 11);
      },
    ],
  },
  // 3 exposed brick: aluminium windows with roller shutters, concrete sills and slab edges.
  {
    wall: (g, x, y, r) => brickWall(g, x, y, r),
    cells: [
      (g, x, y) => {
        g.fillStyle = '#d9d6cf';
        g.fillRect(x, y + C - 16, C, 16);
        frame(g, x + 70, y + 50, 116, 120, '#c8ccce', 5, 1);
        persiana(g, x + 70, y + 50, 116, 120, 0.4, '#d4d0c6');
        g.fillStyle = '#d9d6cf';
        g.fillRect(x + 62, y + 174, 132, 9);
      },
      (g, x, y) => {
        g.fillStyle = '#7b7f82';
        g.fillRect(x + 70, y + 46, 116, C - 46);
        glass(g, x + 80, y + 56, 96, C - 120);
        g.fillStyle = '#d9d6cf';
        g.fillRect(x, y, C, 16);
      },
      (g, x, y) => {
        g.fillStyle = '#d9d6cf';
        g.fillRect(x, y, C, 16);
        frame(g, x + 70, y + 64, 116, 110, '#c8ccce', 5, 1);
        persiana(g, x + 70, y + 64, 116, 110, 0.5, '#d4d0c6');
      },
      (g, x, y) => {
        g.fillStyle = '#d9d6cf';
        g.fillRect(x, y + C - 16, C, 16);
        frame(g, x + 60, y + 30, 136, 176, '#c8ccce', 5, 1);
        persiana(g, x + 60, y + 30, 136, 176, 0.3, '#d4d0c6');
        g.fillStyle = 'rgba(40,40,40,0.95)';
        g.fillRect(x + 40, y + 206, 176, 10);
        railing(g, x + 44, y + 150, 168, 58, '#2a2a2a', 10);
      },
    ],
  },
  // 4 terraces (1976-2000): continuous balcony slab with railing across the bay, glazed door.
  {
    wall: (g, x, y, r) => plaster(g, x, y, r, 234),
    cells: [
      (g, x, y) => {
        frame(g, x + 64, y + 34, 80, 168, '#d8dbdc', 5, 0);
        persiana(g, x + 64, y + 34, 80, 168, 0.3, '#d6d2c8');
        frame(g, x + 162, y + 58, 60, 90, '#d8dbdc', 4, 0);
        g.fillStyle = '#c9c4b8';
        g.fillRect(x, y + 206, C, 16);
        railing(g, x, y + 150, C, 58, '#30302e', 12);
      },
      (g, x, y) => {
        g.fillStyle = '#5f6366';
        g.fillRect(x + 40, y + 50, 176, C - 50);
        g.fillStyle = 'rgba(255,255,255,0.14)';
        for (let yy = y + 60; yy < y + C; yy += 12) g.fillRect(x + 42, yy, 172, 2);
        g.fillStyle = '#c9c4b8';
        g.fillRect(x, y, C, 18);
      },
      (g, x, y) => {
        g.fillStyle = '#c9c4b8';
        g.fillRect(x, y, C, 18);
        frame(g, x + 60, y + 60, 136, 120, '#d8dbdc', 5, 1);
      },
      (g, x, y) => {
        frame(g, x + 70, y + 50, 116, 120, '#d8dbdc', 5, 1);
        persiana(g, x + 70, y + 50, 116, 120, 0.25, '#d6d2c8');
        g.fillStyle = '#c9c4b8';
        g.fillRect(x + 60, y + 174, 136, 9);
      },
    ],
  },
  // 5 modern (2000+): floor-to-ceiling windows, dark frames, glass railings.
  {
    wall: (g, x, y, r) => plaster(g, x, y, r, 244),
    cells: [
      (g, x, y) => {
        frame(g, x + 44, y + 22, 168, 196, '#3a3d40', 4, 1);
        g.fillStyle = 'rgba(190,215,225,0.55)';
        g.fillRect(x + 30, y + 150, 196, 70);
        g.fillStyle = '#d5d3cc';
        g.fillRect(x, y + 220, C, 14);
      },
      (g, x, y) => {
        frame(g, x + 36, y + 24, 184, C - 24, '#3a3d40', 5, 1);
      },
      (g, x, y) => {
        frame(g, x + 36, y + 30, 184, 190, '#3a3d40', 5, 2);
      },
      (g, x, y) => {
        frame(g, x + 70, y + 40, 116, 150, '#3a3d40', 4, 0);
        g.fillStyle = '#5e6266';
        g.fillRect(x + 200, y + 20, 26, 210);
      },
    ],
  },
  // 6 civic / offices: ribbon windows across the whole bay.
  {
    wall: (g, x, y, r) => plaster(g, x, y, r, 232),
    cells: [
      (g, x, y) => {
        frame(g, x, y + 66, C, 108, '#9aa0a4', 4, 2);
      },
      (g, x, y) => {
        frame(g, x + 20, y + 20, 216, C - 20, '#7d8387', 5, 1);
      },
      (g, x, y) => {
        frame(g, x, y + 56, C, 120, '#9aa0a4', 4, 2);
      },
      (g, x, y) => {
        frame(g, x, y + 66, C, 108, '#9aa0a4', 4, 2);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(x, y + 66, C, 30);
      },
    ],
  },
  // 7 industrial: corrugated cladding, high strip window, sectional door.
  {
    wall: (g, x, y) => corrugated(g, x, y),
    cells: [
      (g, x, y) => {
        frame(g, x + 30, y + 40, 196, 40, '#8c9093', 3, 3);
      },
      (g, x, y) => {
        g.fillStyle = '#9da3a6';
        g.fillRect(x + 24, y + 40, 208, C - 40);
        g.fillStyle = 'rgba(0,0,0,0.2)';
        for (let yy = y + 70; yy < y + C; yy += 34) g.fillRect(x + 24, yy, 208, 3);
      },
      (g, x, y) => {
        frame(g, x + 60, y + 90, 136, 50, '#8c9093', 3, 1);
      },
      () => {},
    ],
  },
  // 8 galería: the white glazed galleries of northern Burgos (Plaza Mayor), full width.
  {
    wall: (g, x, y, r) => plaster(g, x, y, r),
    cells: [
      (g, x, y) => {
        g.fillStyle = '#f7f6f1';
        g.fillRect(x, y + 8, C, C - 8);
        for (let k = 0; k < 4; k++) {
          for (const [py, ph] of [
            [24, 70],
            [104, 104],
          ]) {
            glass(g, x + 10 + k * 62, y + py, 52, ph);
          }
        }
        g.fillStyle = '#eceae2';
        g.fillRect(x, y + C - 30, C, 30);
        for (let k = 0; k < 4; k++) g.fillRect(x + 10 + k * 62, y + C - 26, 52, 2);
      },
      (g, x, y, r) => {
        plinth(g, x, y);
        stoneSurround(g, x + 70, y + 34, 116, C - 34, 11);
        woodDoor(g, x + 70, y + 34, 116, C - 34, r.pick(DOORS));
      },
      (g, x, y) => {
        plinth(g, x, y);
        stoneSurround(g, x + 76, y + 46, 104, 130, 9);
        frame(g, x + 76, y + 46, 104, 130, '#efe9dd', 5, 1);
      },
      (g, x, y) => {
        g.fillStyle = '#f7f6f1';
        g.fillRect(x, y + 8, C, C - 8);
        for (let k = 0; k < 3; k++) glass(g, x + 14 + k * 80, y + 24, 68, 176);
        g.fillStyle = '#efeee8';
        for (let k = 0; k < 3; k++) g.fillRect(x + 14 + k * 80, y + 92, 68, 5);
      },
    ],
  },
];

/**
 * Facade atlas: N_STYLES rows x N_CELLS columns of one bay by one storey, and a
 * mask of the same layout: white where the wall shows (tinted with the
 * building's colour), black on the details that keep their own colour
 * (windows, shutters, doors, railings, galleries). The mask is a texture of
 * its own: an alpha channel on a canvas loses precision on upload.
 */
export function facadeStylesTexture(): { map: THREE.CanvasTexture; mask: THREE.CanvasTexture; relief: THREE.CanvasTexture } {
  const W = C * N_CELLS,
    H = C * N_STYLES;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const wallOnly = document.createElement('canvas');
  wallOnly.width = W;
  wallOnly.height = H;
  const w = wallOnly.getContext('2d', { willReadFrequently: true })!;
  STYLES.forEach((style, row) => {
    for (let col = 0; col < N_CELLS; col++) {
      const x0 = col * C,
        y0 = row * C;
      // Same seed for both passes so the wall is identical and only the details differ.
      style.wall(w, x0, y0, new Rng(row * 31 + col));
      style.wall(g, x0, y0, new Rng(row * 31 + col));
      g.save();
      g.beginPath();
      g.rect(x0, y0, C, C);
      g.clip();
      style.cells[col](g, x0, y0, new Rng(row * 97 + col * 13 + 5));
      g.restore();
    }
  });
  const a = g.getImageData(0, 0, W, H).data;
  const refImg = w.getImageData(0, 0, W, H);
  const ref = refImg.data;
  // Relief (for the normal map): the wall's own grain (joints of bricks and stones), flat on the
  // windows, doors and railings so their glass does not sparkle.
  const reliefCanvas = document.createElement('canvas');
  reliefCanvas.width = W;
  reliefCanvas.height = H;
  const reliefImg = new ImageData(new Uint8ClampedArray(ref), W, H);
  for (let i = 0; i < a.length; i += 4) {
    const diff = Math.abs(a[i] - ref[i]) + Math.abs(a[i + 1] - ref[i + 1]) + Math.abs(a[i + 2] - ref[i + 2]);
    if (diff > 6) reliefImg.data[i] = reliefImg.data[i + 1] = reliefImg.data[i + 2] = 200;
  }
  reliefCanvas.getContext('2d')!.putImageData(reliefImg, 0, 0);
  const maskImg = w.createImageData(W, H);
  const m = maskImg.data;
  for (let i = 0; i < a.length; i += 4) {
    const diff = Math.abs(a[i] - ref[i]) + Math.abs(a[i + 1] - ref[i + 1]) + Math.abs(a[i + 2] - ref[i + 2]);
    const v = diff > 6 ? 0 : 255;
    m[i] = m[i + 1] = m[i + 2] = v;
    m[i + 3] = 255;
  }
  w.putImageData(maskImg, 0, 0);
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: tex(canvas, true), mask: tex(wallOnly, false), relief: tex(reliefCanvas, true) };
}

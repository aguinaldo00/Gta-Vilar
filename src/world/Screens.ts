import * as THREE from 'three';
import { Layer } from '../physics/PhysicsWorld';
import { LocalBatch } from './Batcher';
import type { BuildContext } from './context';
import type { MapFurniture, MapShop } from './mapData';
import { Unit } from './props';

/** What a slide can show: the game state at this frame. */
export interface ScreenInfo {
  /** Seconds since the slide started. */
  t: number;
  /** Local wall-clock time. */
  date: Date;
  zone: string;
  /** Player speed (km/h) and the best of the session. */
  speed: number;
  topSpeed: number;
  /** Metres travelled this session. */
  distance: number;
  shops: MapShop[];
}

/**
 * A slide of the digital screen. `draw` paints a 512x288 canvas (redrawn a
 * few times a second); a `live` slide shows the broadcast camera instead and
 * `draw` paints only its overlay on a transparent canvas. Add your own with
 * `game.screens.add(...)`.
 */
export interface Slide {
  name: string;
  seconds: number;
  live?: boolean;
  draw: (g: CanvasRenderingContext2D, info: ScreenInfo) => void;
}

const W = 512,
  H = 288;
const SKY = new THREE.Color('#9fc4e8');
const FONT = 'Arial, Helvetica, sans-serif';

function frameBg(g: CanvasRenderingContext2D, top: string, bottom: string): void {
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, top);
  gr.addColorStop(1, bottom);
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
}

function ticker(g: CanvasRenderingContext2D, text: string, t: number): void {
  g.fillStyle = 'rgba(0,0,0,0.65)';
  g.fillRect(0, H - 34, W, 34);
  g.fillStyle = '#ffd34d';
  g.font = `bold 20px ${FONT}`;
  g.textBaseline = 'middle';
  const w = g.measureText(text).width + 80;
  const x = W - ((t * 90) % (w + W));
  g.fillText(text, x, H - 17);
}

/** Default programme: clock and welcome, live feed, local shops, session figures. */
export const DEFAULT_SLIDES: Slide[] = [
  {
    name: 'welcome',
    seconds: 8,
    draw: (g, i) => {
      frameBg(g, '#0b3d6b', '#071d33');
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `bold 92px ${FONT}`;
      g.fillText(i.date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }), W / 2, 104);
      g.font = `24px ${FONT}`;
      g.fillText(i.date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }), W / 2, 172);
      g.font = `bold 22px ${FONT}`;
      g.fillStyle = '#9ed0ff';
      g.fillText('AYUNTAMIENTO DE VILLARCAYO', W / 2, 214);
      ticker(g, 'Bienvenidos a Villarcayo de Merindad de Castilla la Vieja · Las Merindades · 596 m', i.t);
    },
  },
  {
    name: 'live',
    seconds: 10,
    live: true,
    draw: (g, i) => {
      g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(12, 12, 236, 34);
      g.fillStyle = Math.floor(i.t * 2) % 2 ? '#ff3030' : '#7a1010';
      g.beginPath();
      g.arc(30, 29, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = `bold 18px ${FONT}`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText('EN DIRECTO · VILLARCAYO TV', 46, 30);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(12, H - 46, W - 24, 34);
      g.fillStyle = '#ffffff';
      g.font = `18px ${FONT}`;
      g.fillText(`${i.zone}  ·  ${Math.round(i.speed)} km/h`, 24, H - 29);
    },
  },
  {
    name: 'shops',
    seconds: 7,
    draw: (g, i) => {
      frameBg(g, '#5a1e1e', '#2a0c0c');
      const pick = i.shops.length ? i.shops[Math.floor(i.date.getTime() / 7000) % i.shops.length] : null;
      g.fillStyle = '#f3e3b5';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `bold 22px ${FONT}`;
      g.fillText('COMERCIO LOCAL', W / 2, 52);
      g.fillStyle = '#ffffff';
      g.font = `bold 44px ${FONT}`;
      const name = pick?.n ?? 'Villarcayo';
      g.fillText(name.length > 20 ? `${name.slice(0, 19)}…` : name, W / 2, 128);
      g.font = `22px ${FONT}`;
      g.fillStyle = '#f3e3b5';
      g.fillText('Compra en tu pueblo', W / 2, 186);
      ticker(g, 'Bares, tiendas y servicios de Villarcayo, en el mapa del juego', i.t);
    },
  },
  {
    name: 'stats',
    seconds: 6,
    draw: (g, i) => {
      frameBg(g, '#123b2a', '#071a12');
      g.fillStyle = '#ffffff';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = `bold 24px ${FONT}`;
      g.fillText('HOY EN VILLARCAYO', 32, 48);
      g.font = `26px ${FONT}`;
      g.fillText(`Velocidad máxima: ${Math.round(i.topSpeed)} km/h`, 32, 116);
      g.fillText(`Recorrido: ${(i.distance / 1000).toFixed(1)} km`, 32, 166);
      g.fillText(`Ahora en: ${i.zone}`, 32, 216);
    },
  },
];

interface Screen {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  mat: THREE.MeshBasicMaterial;
  overlay: THREE.Mesh;
  overlayCanvas: HTMLCanvasElement;
  panel: THREE.Group;
  pos: THREE.Vector3;
}

/**
 * The Ayuntamiento's digital screen (OSM advertising=billboard,
 * animated=digital_messages, beside the Plaza Mayor) as a lit LED panel that
 * runs a programme of slides, one of them a live feed of the player from a
 * broadcast camera. Static billboards get a poster.
 */
export class DigitalScreens {
  readonly slides: Slide[] = [...DEFAULT_SLIDES];
  private readonly screens: Screen[] = [];
  private readonly feed: THREE.WebGLRenderTarget | null;
  private readonly feedCam = new THREE.PerspectiveCamera(55, W / H, 0.5, 400);
  private slide = 0;
  private slideT = 0;
  private redraw = 0;
  private feedT = 0;
  private topSpeed = 0;
  private distance = 0;
  private readonly last = new THREE.Vector3(Number.NaN, 0, 0);

  constructor(
    ctx: BuildContext,
    private readonly shops: MapShop[],
    live: boolean,
  ) {
    this.feed = live ? new THREE.WebGLRenderTarget(320, 180) : null;
    if (this.feed) this.feed.texture.colorSpace = THREE.SRGBColorSpace;
    for (const f of ctx.map.furniture ?? []) if (f.k === 'billboard') this.build(ctx, f);
  }

  /** Adds a slide to the programme (e.g. from the console: game.world.screens.add({...})). */
  add(slide: Slide): void {
    this.slides.push(slide);
  }

  private build(ctx: BuildContext, f: MapFurniture): void {
    const digital = f.t === 'digital';
    const y = ctx.terrain.heightAt(f.x, f.z);
    const lb = new LocalBatch(ctx.batch, f.x, y, f.z, f.a);
    const pw = digital ? 2.4 : 4.0,
      ph = pw * (H / W),
      cy = digital ? 1.2 + ph / 2 : 2.2 + ph / 2;
    // Totem: posts and a dark casing.
    for (const x of [-pw / 2 + 0.15, pw / 2 - 0.15]) lb.add(Unit.box, ctx.mats.tint('#2b2f33'), x, cy / 2, 0, 0, 0.14, cy, 0.14);
    lb.add(Unit.box, ctx.mats.tint('#1b1e21'), 0, cy, 0, 0, pw + 0.16, ph + 0.16, 0.22);
    ctx.collision.addBox(f.x, f.z, pw + 0.2, 0.3, { rot: f.a, top: cy + ph / 2, mask: Layer.Solid });

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Lit panel: unaffected by the sun, slightly over-bright so it blooms.
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) });
    const panel = new THREE.Group();
    panel.position.set(f.x, y + cy, f.z);
    panel.rotation.y = f.a;
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
      m.position.z = side * 0.115;
      if (side < 0) m.rotation.y = Math.PI;
      panel.add(m);
    }
    // Transparent overlay for the live slide's captions (front only).
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = W;
    overlayCanvas.height = H;
    const overlayTex = new THREE.CanvasTexture(overlayCanvas);
    overlayTex.colorSpace = THREE.SRGBColorSpace;
    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(pw, ph),
      new THREE.MeshBasicMaterial({ map: overlayTex, transparent: true, toneMapped: false, depthWrite: false }),
    );
    overlay.position.z = 0.12;
    overlay.visible = false;
    panel.add(overlay);
    ctx.scene.add(panel);
    if (!digital) {
      // Static billboard: a poster of a local shop.
      const shop = this.shops.length ? this.shops[Math.floor(Math.abs(f.x * 7 + f.z * 13)) % this.shops.length] : null;
      DEFAULT_SLIDES[2].draw(g, { t: 0, date: new Date(0), zone: '', speed: 0, topSpeed: 0, distance: 0, shops: shop ? [shop] : [] });
      tex.needsUpdate = true;
      return;
    }
    this.screens.push({ canvas, g, tex, mat, overlay, overlayCanvas, panel, pos: panel.position.clone() });
  }

  update(
    dt: number,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    viewer: THREE.Vector3,
    player: THREE.Vector3,
    heading: number,
    speed: number,
    zone: string,
  ): void {
    if (!Number.isNaN(this.last.x)) this.distance += Math.min(50, this.last.distanceTo(player));
    this.last.copy(player);
    this.topSpeed = Math.max(this.topSpeed, speed);
    if (!this.screens.length) return;
    const near = this.screens.some((s) => s.pos.distanceTo(viewer) < 150);
    if (!near) return;
    this.slideT += dt;
    let slide = this.slides[this.slide % this.slides.length];
    if (slide.live && !this.feed) {
      this.slide++;
      this.slideT = 0;
      slide = this.slides[this.slide % this.slides.length];
    }
    if (this.slideT > slide.seconds) {
      this.slide = (this.slide + 1) % this.slides.length;
      this.slideT = 0;
      slide = this.slides[this.slide];
      if (slide.live && !this.feed) this.slide = (this.slide + 1) % this.slides.length;
    }
    const info: ScreenInfo = {
      t: this.slideT,
      date: new Date(),
      zone,
      speed,
      topSpeed: this.topSpeed,
      distance: this.distance,
      shops: this.shops,
    };
    this.redraw -= dt;
    if (slide.live && this.feed) {
      // Broadcast camera: behind and above the player, at 8 frames per second.
      this.feedT -= dt;
      if (this.feedT <= 0) {
        this.feedT = 0.125;
        this.feedCam.position.set(player.x - Math.sin(heading) * 9, player.y + 5, player.z - Math.cos(heading) * 9);
        this.feedCam.lookAt(player.x, player.y + 1.2, player.z);
        const prevTarget = renderer.getRenderTarget();
        const prevBg = scene.background;
        scene.background = SKY;
        // The panels show this very texture: hide them while it is drawn (no feedback loop).
        for (const s of this.screens) s.panel.visible = false;
        renderer.setRenderTarget(this.feed);
        renderer.render(scene, this.feedCam);
        renderer.setRenderTarget(prevTarget);
        for (const s of this.screens) s.panel.visible = true;
        scene.background = prevBg;
      }
      for (const s of this.screens) {
        if (s.mat.map !== this.feed.texture) {
          s.mat.map = this.feed.texture;
          s.mat.needsUpdate = true;
        }
        s.overlay.visible = true;
        if (this.redraw <= 0) {
          slide.draw(s.overlayCanvas.getContext('2d')!, info);
          (s.overlay.material as THREE.MeshBasicMaterial).map!.needsUpdate = true;
        }
      }
    } else if (this.redraw <= 0) {
      for (const s of this.screens) {
        if (s.mat.map !== s.tex) {
          s.mat.map = s.tex;
          s.mat.needsUpdate = true;
        }
        s.overlay.visible = false;
        s.g.save();
        slide.draw(s.g, info);
        s.g.restore();
        s.tex.needsUpdate = true;
      }
    }
    if (this.redraw <= 0) this.redraw = 0.2;
  }
}

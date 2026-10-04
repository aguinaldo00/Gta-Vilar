/**
 * "Where am I" for reporting a detail to fix: P copies the player's place
 * (game coordinates, UTM, latitude / longitude with a map link), which way
 * the camera looks, on foot or in which car, the zone, hour and weather, and
 * shows it on screen for a few seconds (for a screenshot when the clipboard
 * is not allowed, as in some embedded viewers).
 */

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

/** Compass point for a direction in the map plane (x east, z south). */
export function compass(dx: number, dz: number): string {
  const deg = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

/** ETRS89 / UTM zone 30N → latitude, longitude (degrees). */
export function utmToLatLon(E: number, N: number, zone = 30): [number, number] {
  const a = 6378137,
    f = 1 / 298.257222101,
    k0 = 0.9996;
  const e2 = f * (2 - f),
    ep2 = e2 / (1 - e2);
  const x = E - 500000,
    y = N;
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1),
    c = Math.cos(p1),
    t = Math.tan(p1);
  const N1 = a / Math.sqrt(1 - e2 * s * s);
  const T1 = t * t,
    C1 = ep2 * c * c;
  const R1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5;
  const D = x / (N1 * k0);
  const lat =
    p1 -
    ((N1 * t) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / c;
  return [(lat * 180) / Math.PI, (zone - 1) * 6 - 180 + 3 + (lon * 180) / Math.PI];
}

export interface PlaceInfo {
  x: number;
  z: number;
  /** Direction the camera looks (map plane). */
  lookX: number;
  lookZ: number;
  /** Vehicle name, or null on foot. */
  vehicle: string | null;
  zone: string;
  hours: number;
  weather: string;
  origin: { E: number; N: number };
}

export function reportText(p: PlaceInfo): string {
  const E = p.origin.E + p.x,
    N = p.origin.N - p.z;
  const [lat, lon] = utmToLatLon(E, N);
  const hh = String(Math.floor(p.hours)).padStart(2, '0'),
    mm = String(Math.floor((p.hours % 1) * 60)).padStart(2, '0');
  return [
    `Villarcayo: x=${p.x.toFixed(1)} z=${p.z.toFixed(1)} mirando ${compass(p.lookX, p.lookZ)}`,
    `${p.vehicle ? `en ${p.vehicle}` : 'a pie'} · ${p.zone} · ${hh}:${mm} · ${p.weather}`,
    `UTM 30N ${E.toFixed(0)} ${N.toFixed(0)} · ${lat.toFixed(6)}, ${lon.toFixed(6)}`,
    `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`,
  ].join('\n');
}

/** Copies the text and shows it in a box at the bottom of the screen. */
export class PositionReport {
  private readonly box: HTMLDivElement;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.box = document.createElement('div');
    this.box.id = 'where';
    parent.appendChild(this.box);
  }

  show(text: string): void {
    let copied = false;
    const done = (ok: boolean) => {
      copied = ok;
      this.box.dataset.state = ok ? 'Copiado: pégalo en tu mensaje' : 'Haz una captura o copia el texto';
    };
    try {
      void navigator.clipboard?.writeText(text).then(
        () => done(true),
        () => done(false),
      );
    } catch {
      done(false);
    }
    if (!copied) this.box.dataset.state = 'Copiando…';
    this.box.textContent = text;
    this.box.classList.add('show');
    (window as unknown as { __where?: string }).__where = text;
    console.info(`[posición]\n${text}`);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.box.classList.remove('show'), 9000);
  }
}

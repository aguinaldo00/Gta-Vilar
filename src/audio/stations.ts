/**
 * Radio stations: Spanish national stations by their public live streams,
 * and three local stations of the valley made up for the game, whose music
 * is generated live (src/audio/RadioSynth.ts).
 *
 * Logos are original monochrome name plates in the spirit of GTA IV's radio
 * HUD (white and grey, no colour), not the stations' trademarks. To use the
 * official artwork instead, drop `public/radio/<id>.svg` (or .png): the panel
 * shows it in greyscale when the file exists.
 */

export interface StreamSource {
  url: string;
  /** HLS playlist (played natively by Safari, through hls.js elsewhere). */
  hls?: boolean;
}

export type SynthStyle = 'folk' | 'chill' | 'rock';

export interface Station {
  id: string;
  name: string;
  /** Second line under the name (genre, dial). */
  tagline: string;
  /** Live stream sources, tried in order; or a generated local station. */
  streams?: StreamSource[];
  synth?: SynthStyle;
  /** What the presenter says when you tune in (local stations). */
  ident?: string;
  /** Inline SVG (uses currentColor). */
  logo: string;
}

/** Logo canvas: 240 × 120, everything centred on x = 120 with at least 10 units of margin. */
const svg = (body: string) =>
  `<svg viewBox="0 0 240 120" xmlns="http://www.w3.org/2000/svg" fill="currentColor" stroke="currentColor">${body}</svg>`;
/**
 * A centred word: `y` is its visual middle (dominant-baseline central), and the
 * letter-spacing SVG adds after the last letter is compensated, so spaced
 * words sit truly in the middle.
 */
const word = (
  text: string,
  x: number,
  y: number,
  size: number,
  opts: { weight?: number; family?: string; italic?: boolean; ls?: number; fill?: string } = {},
) =>
  `<text x="${x + (opts.ls ?? 0) / 2}" y="${y}" text-anchor="middle" dominant-baseline="central" stroke="none" font-family="${opts.family ?? "'Arial Black', 'Helvetica Neue', Arial, sans-serif"}" font-weight="${opts.weight ?? 900}" font-size="${size}"${opts.italic ? ' font-style="italic"' : ''}${opts.ls ? ` letter-spacing="${opts.ls}"` : ''}${opts.fill ? ` fill="${opts.fill}"` : ''}>${text}</text>`;
const SERIF = 'Georgia, serif';
/** Wavy line from x0 to x1 (periods of 36), centred vertically on y. */
const wave = (x0: number, x1: number, y: number, w: number, extra = '') => {
  let d = `M${x0} ${y}`;
  for (let x = x0; x < x1 - 1; x += 36) d += ` q9 -10 18 0 t18 0`;
  return `<path d="${d}" fill="none" stroke-width="${w}" stroke-linecap="round"${extra}/>`;
};
/** Five-pointed star centred on (cx, cy). */
const star = (cx: number, cy: number, r: number) => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="none" stroke-width="5" stroke-linejoin="round"/>`;
};

export const STATIONS: Station[] = [
  {
    id: 'los40',
    name: 'Los 40 Principales',
    tagline: 'Éxitos',
    streams: [{ url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/LOS40.mp3' }],
    logo: svg(
      `<rect x="62" y="8" width="116" height="104" rx="20" fill="none" stroke-width="6"/>${word('LOS', 120, 34, 20, { ls: 6 })}${word('40', 120, 76, 54)}`,
    ),
  },
  {
    id: 'ser',
    name: 'Cadena SER',
    tagline: 'Hablada',
    streams: [{ url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/CADENASER.mp3' }],
    logo: svg(`${word('cadena', 120, 28, 24, { weight: 400, family: SERIF, italic: true })}${word('SER', 120, 80, 62, { ls: 4 })}`),
  },
  {
    id: 'cope',
    name: 'COPE',
    tagline: 'Hablada',
    streams: [{ url: 'https://flucast23-h-cloud.flumotion.com/cope/net1.mp3' }],
    logo: svg(`<rect x="22" y="22" width="196" height="76" rx="8" fill="none" stroke-width="5"/>${word('COPE', 120, 60, 44, { ls: 3 })}`),
  },
  {
    id: 'ondacero',
    name: 'Onda Cero',
    tagline: 'Hablada',
    streams: [
      { url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/OCAAC.aac' },
      { url: 'https://atres-live.ondacero.es/live/ondacero/master.m3u8', hls: true },
    ],
    logo: svg(
      `<circle cx="120" cy="42" r="28" fill="none" stroke-width="8"/>${wave(30, 84, 42, 5)}${wave(156, 210, 42, 5)}${word('onda cero', 120, 98, 22, { weight: 700 })}`,
    ),
  },
  {
    id: 'kiss',
    name: 'Kiss FM',
    tagline: 'Música de los 80, 90 y hoy',
    streams: [{ url: 'https://kissfm.kissfmradio.cires21.com/kissfm.mp3' }],
    logo: svg(`${word('KISS', 120, 48, 56, { italic: true, ls: 2 })}${word('FM', 120, 98, 20, { ls: 10 })}`),
  },
  {
    id: 'rockfm',
    name: 'Rock FM',
    tagline: 'Rock clásico',
    streams: [
      { url: 'https://flucast23-h-cloud.flumotion.com/cope/rockfm.mp3' },
      { url: 'https://rockfm-cope.flumotion.com/playlist.m3u8', hls: true },
    ],
    logo: svg(
      `<path d="M24 14 L216 14 L202 106 L38 106 Z" fill="none" stroke-width="5" stroke-linejoin="round"/>${word('ROCK', 120, 52, 44, { family: 'Impact, "Arial Black", sans-serif', weight: 400, ls: 4 })}${word('FM', 120, 88, 16, { ls: 6 })}`,
    ),
  },
  {
    id: 'dial',
    name: 'Cadena Dial',
    tagline: 'Música en español',
    streams: [{ url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/CADENADIAL.mp3' }],
    logo: svg(
      `${word('cadena', 120, 28, 22, { weight: 400, family: SERIF, italic: true })}${word('Dial', 120, 78, 56, { family: SERIF, weight: 700, italic: true })}`,
    ),
  },
  {
    id: 'europafm',
    name: 'Europa FM',
    tagline: 'Música',
    streams: [
      { url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/EFMAAC.aac' },
      { url: 'https://atres-live.europafm.com/live/europafm/master.m3u8', hls: true },
    ],
    logo: svg(
      `${Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return `<circle cx="${(120 + Math.cos(a) * 66).toFixed(1)}" cy="${(50 + Math.sin(a) * 38).toFixed(1)}" r="4" stroke="none"/>`;
      }).join('')}${word('europa', 120, 50, 26, { weight: 700 })}${word('FM', 120, 108, 16, { ls: 6 })}`,
    ),
  },
  {
    id: 'rne',
    name: 'RNE',
    tagline: 'Radio Nacional',
    streams: [
      { url: 'https://dispatcher.rndfnk.com/crtve/rne1/main/mp3/high' },
      { url: 'https://rtvelivestream.rtve.es/rtvesec/rne/rne_r1_main.m3u8', hls: true },
    ],
    logo: svg(
      `<rect x="48" y="18" width="144" height="84" rx="42" fill="none" stroke-width="6"/>${word('rne', 120, 58, 50, { weight: 900 })}`,
    ),
  },
  {
    id: 'los40classic',
    name: 'Los 40 Classic',
    tagline: 'Éxitos de siempre',
    streams: [{ url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/LOS40_CLASSIC.mp3' }],
    logo: svg(
      `<rect x="68" y="6" width="104" height="82" rx="18" fill="none" stroke-width="6"/>${word('LOS', 120, 28, 16, { ls: 5 })}${word('40', 120, 62, 42)}${word('CLASSIC', 120, 106, 15, { ls: 5 })}`,
    ),
  },
  {
    id: 'los40dance',
    name: 'Los 40 Dance',
    tagline: 'Electrónica',
    streams: [{ url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/LOS40_DANCE.mp3' }],
    logo: svg(
      `<rect x="68" y="6" width="104" height="82" rx="18" fill="none" stroke-width="6"/>${word('LOS', 120, 28, 16, { ls: 5 })}${word('40', 120, 62, 42)}${word('DANCE', 120, 106, 15, { ls: 6 })}`,
    ),
  },
  {
    id: 'cadena100',
    name: 'Cadena 100',
    tagline: 'Música',
    streams: [
      { url: 'https://flucast23-h-cloud.flumotion.com/cope/cadena100.mp3' },
      { url: 'https://cadena100-cope.flumotion.com/playlist.m3u8', hls: true },
    ],
    logo: svg(`${word('cadena', 120, 28, 22, { weight: 400, family: SERIF, italic: true })}${word('100', 120, 80, 58, { ls: 2 })}`),
  },
  {
    id: 'megastar',
    name: 'MegaStar FM',
    tagline: 'Nuevos éxitos',
    streams: [{ url: 'https://flucast23-h-cloud.flumotion.com/cope/megastar.mp3' }],
    logo: svg(`${star(120, 46, 38)}${word('MEGASTAR', 120, 106, 15, { ls: 4 })}`),
  },
  {
    id: 'marca',
    name: 'Radio Marca',
    tagline: 'Deportes',
    streams: [{ url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/RADIOMARCA_NACIONAL.mp3' }],
    logo: svg(
      `<rect x="20" y="24" width="200" height="72" fill="none" stroke-width="5"/>${word('MARCA', 120, 60, 40, { italic: true, ls: 2 })}`,
    ),
  },
  {
    id: 'rne3',
    name: 'Radio 3',
    tagline: 'RNE · Alternativa',
    streams: [
      { url: 'https://dispatcher.rndfnk.com/crtve/rner3/main/mp3/high' },
      { url: 'https://rtvelivestream.rtve.es/rtvesec/rne/rne_r3_main.m3u8', hls: true },
    ],
    logo: svg(`<circle cx="120" cy="60" r="46" fill="none" stroke-width="6"/>${word('3', 120, 62, 58)}`),
  },
  {
    id: 'merindades',
    name: 'Radio Merindades',
    tagline: 'Folk castellano · 98.4',
    synth: 'folk',
    ident: 'Radio Merindades. Música de la tierra, desde Villarcayo.',
    logo: svg(
      `<path d="M24 80 L64 34 L86 58 L120 18 L154 58 L176 34 L216 80 Z" stroke="none" opacity="0.85"/><path d="M24 88 L216 88" stroke-width="3"/>${word('RADIO MERINDADES', 120, 106, 14, { ls: 3 })}`,
    ),
  },
  {
    id: 'nela',
    name: 'Nela FM',
    tagline: 'Chill desde el río · 101.2',
    synth: 'chill',
    ident: 'Nela FM. Relájate, que el río baja tranquilo.',
    logo: svg(
      `${word('nela', 120, 42, 54, { family: SERIF, weight: 700, italic: true })}${wave(48, 192, 84, 4)}${wave(48, 192, 100, 3, ' opacity="0.6"')}`,
    ),
  },
  {
    id: 'corregimiento',
    name: 'Corregimiento Rock',
    tagline: 'Rock de la Torre · 104.7',
    synth: 'rock',
    ident: 'Corregimiento Rock. ¡Sube el volumen, Villarcayo!',
    logo: svg(
      `<path d="M102 88 L102 34 L96 34 L96 12 L106 12 L106 20 L115 20 L115 12 L125 12 L125 20 L134 20 L134 12 L144 12 L144 34 L138 34 L138 88 Z" stroke="none"/><rect x="114" y="46" width="12" height="18" fill="#000" stroke="none" opacity="0.6"/>${word('CORREGIMIENTO', 120, 106, 13, { ls: 3 })}`,
    ),
  },
];

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

const svg = (body: string, w = 240, h = 110) =>
  `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" fill="currentColor" stroke="currentColor">${body}</svg>`;
const word = (
  text: string,
  x: number,
  y: number,
  size: number,
  opts: { weight?: number; family?: string; italic?: boolean; ls?: number; fill?: string } = {},
) =>
  `<text x="${x}" y="${y}" text-anchor="middle" stroke="none" font-family="${opts.family ?? "'Arial Black', 'Helvetica Neue', Arial, sans-serif"}" font-weight="${opts.weight ?? 900}" font-size="${size}"${opts.italic ? ' font-style="italic"' : ''}${opts.ls ? ` letter-spacing="${opts.ls}"` : ''}${opts.fill ? ` fill="${opts.fill}"` : ''}>${text}</text>`;

export const STATIONS: Station[] = [
  {
    id: 'los40',
    name: 'Los 40 Principales',
    tagline: 'Los 40 Principales · Éxitos',
    streams: [{ url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/LOS40.mp3' }],
    logo: svg(
      `<rect x="40" y="8" width="160" height="94" rx="18" fill="none" stroke-width="6"/>${word('LOS', 120, 40, 22, { ls: 6 })}${word('40', 120, 92, 58)}`,
    ),
  },
  {
    id: 'ser',
    name: 'Cadena SER',
    tagline: 'Hablada',
    streams: [{ url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/CADENASER.mp3' }],
    logo: svg(
      `${word('cadena', 120, 36, 24, { weight: 400, family: 'Georgia, serif', italic: true })}${word('SER', 120, 96, 66, { ls: 4 })}`,
    ),
  },
  {
    id: 'cope',
    name: 'COPE',
    tagline: 'Hablada',
    streams: [{ url: 'https://flucast23-h-cloud.flumotion.com/cope/net1.mp3' }],
    logo: svg(`<rect x="30" y="20" width="180" height="70" rx="6" fill="none" stroke-width="5"/>${word('COPE', 120, 78, 56, { ls: 3 })}`),
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
      `<circle cx="58" cy="55" r="34" fill="none" stroke-width="9"/><path d="M98 55 q14 -22 28 0 t28 0 t28 0" fill="none" stroke-width="6"/>${word('onda cero', 150, 102, 22, { weight: 700 })}`,
    ),
  },
  {
    id: 'kiss',
    name: 'Kiss FM',
    tagline: 'Música de los 80, 90 y hoy',
    streams: [{ url: 'https://kissfm.kissfmradio.cires21.com/kissfm.mp3' }],
    logo: svg(`${word('KISS', 120, 70, 64, { italic: true, ls: 2 })}${word('F M', 120, 100, 20, { ls: 10 })}`),
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
      `<path d="M28 18 L212 18 L200 92 L40 92 Z" fill="none" stroke-width="5"/>${word('ROCK', 120, 70, 50, { family: 'Impact, "Arial Black", sans-serif', weight: 400, ls: 4 })}${word('FM', 196, 44, 16, { ls: 2 })}`,
    ),
  },
  {
    id: 'dial',
    name: 'Cadena Dial',
    tagline: 'Música en español',
    streams: [{ url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/CADENADIAL.mp3' }],
    logo: svg(
      `${word('cadena', 120, 36, 22, { weight: 400, family: 'Georgia, serif', italic: true })}${word('Dial', 120, 94, 62, { family: 'Georgia, serif', weight: 700, italic: true })}`,
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
      `${Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return `<circle cx="${(120 + Math.cos(a) * 44).toFixed(1)}" cy="${(52 + Math.sin(a) * 40).toFixed(1)}" r="4" stroke="none"/>`;
      }).join('')}${word('europa', 120, 60, 30, { weight: 700 })}${word('FM', 120, 104, 18, { ls: 8 })}`,
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
      `<rect x="44" y="14" width="152" height="82" rx="41" fill="none" stroke-width="6"/>${word('rne', 120, 76, 56, { weight: 900 })}`,
    ),
  },
  {
    id: 'los40classic',
    name: 'Los 40 Classic',
    tagline: 'Éxitos de siempre',
    streams: [{ url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/LOS40_CLASSIC.mp3' }],
    logo: svg(
      `<rect x="40" y="8" width="160" height="80" rx="18" fill="none" stroke-width="6"/>${word('LOS', 120, 36, 18, { ls: 6 })}${word('40', 120, 80, 46)}${word('CLASSIC', 120, 106, 16, { ls: 6 })}`,
      240,
      112,
    ),
  },
  {
    id: 'los40dance',
    name: 'Los 40 Dance',
    tagline: 'Electrónica',
    streams: [{ url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/LOS40_DANCE.mp3' }],
    logo: svg(
      `<rect x="40" y="8" width="160" height="80" rx="18" fill="none" stroke-width="6"/>${word('LOS', 120, 36, 18, { ls: 6 })}${word('40', 120, 80, 46)}${word('DANCE', 120, 106, 16, { ls: 8 })}`,
      240,
      112,
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
    logo: svg(
      `${word('cadena', 120, 34, 22, { weight: 400, family: 'Georgia, serif', italic: true })}${word('100', 120, 96, 64, { ls: 2 })}`,
    ),
  },
  {
    id: 'megastar',
    name: 'MegaStar FM',
    tagline: 'Nuevos éxitos',
    streams: [{ url: 'https://flucast23-h-cloud.flumotion.com/cope/megastar.mp3' }],
    logo: svg(
      `<path d="M120 10 L132 44 L168 44 L139 64 L150 98 L120 78 L90 98 L101 64 L72 44 L108 44 Z" fill="none" stroke-width="5"/>${word('MEGASTAR', 120, 108, 16, { ls: 4 })}`,
      240,
      112,
    ),
  },
  {
    id: 'marca',
    name: 'Radio Marca',
    tagline: 'Deportes',
    streams: [{ url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/RADIOMARCA_NACIONAL.mp3' }],
    logo: svg(
      `<rect x="24" y="22" width="192" height="66" fill="none" stroke-width="5"/>${word('MARCA', 120, 74, 46, { italic: true, ls: 2 })}`,
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
    logo: svg(`<circle cx="120" cy="55" r="42" fill="none" stroke-width="6"/>${word('3', 120, 80, 66)}`),
  },
  {
    id: 'merindades',
    name: 'Radio Merindades',
    tagline: 'Folk castellano · 98.4',
    synth: 'folk',
    ident: 'Radio Merindades. Música de la tierra, desde Villarcayo.',
    logo: svg(
      `<path d="M20 78 L62 30 L84 54 L112 18 L150 66 L172 44 L220 78 Z" stroke="none" opacity="0.85"/><path d="M20 84 L220 84" stroke-width="3"/>${word('RADIO MERINDADES', 120, 104, 15, { ls: 3 })}`,
    ),
  },
  {
    id: 'nela',
    name: 'Nela FM',
    tagline: 'Chill desde el río · 101.2',
    synth: 'chill',
    ident: 'Nela FM. Relájate, que el río baja tranquilo.',
    logo: svg(
      `${word('nela', 120, 62, 58, { family: 'Georgia, serif', weight: 700, italic: true })}<path d="M40 78 q20 -12 40 0 t40 0 t40 0 t40 0" fill="none" stroke-width="4"/><path d="M40 92 q20 -12 40 0 t40 0 t40 0 t40 0" fill="none" stroke-width="3" opacity="0.6"/>`,
    ),
  },
  {
    id: 'corregimiento',
    name: 'Corregimiento Rock',
    tagline: 'Rock de la Torre · 104.7',
    synth: 'rock',
    ident: 'Corregimiento Rock. ¡Sube el volumen, Villarcayo!',
    logo: svg(
      `<path d="M96 96 L96 30 L90 30 L90 14 L100 14 L100 22 L110 22 L110 14 L120 14 L120 22 L130 22 L130 14 L140 14 L140 22 L150 22 L150 14 L150 30 L144 30 L144 96 Z" stroke="none"/><rect x="114" y="50" width="12" height="18" fill="#000" stroke="none" opacity="0.6"/>${word('CORREGIMIENTO', 120, 108, 13, { ls: 3 })}`,
      240,
      114,
    ),
  },
];

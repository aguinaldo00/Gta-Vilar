// Writes an HTML sheet with every radio logo (white on dark, with its box) for a visual check:
//   node tools/qa/logos.ts out.html
import { writeFileSync } from 'node:fs';
import { STATIONS } from '../../src/audio/stations.ts';

const cells = STATIONS.map(
  (s) => `<figure><div class="logo">${s.logo}</div><figcaption>${s.name}<br><small>${s.tagline}</small></figcaption></figure>`,
).join('');
writeFileSync(
  process.argv[2] ?? 'logos.html',
  `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#2a3038;color:#f4f4f4;font:12px Arial;display:grid;grid-template-columns:repeat(6,200px);gap:12px;padding:12px}
  figure{margin:0;text-align:center} .logo{width:150px;height:70px;margin:0 auto;outline:1px dashed #6a7480;color:#f4f4f4}
  .logo svg{width:100%;height:100%;overflow:visible} small{color:#aaa}
  </style>${cells}`,
);

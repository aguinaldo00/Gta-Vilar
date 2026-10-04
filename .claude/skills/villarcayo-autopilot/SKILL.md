---
name: villarcayo-autopilot
description: Seguir mejorando GTA Villarcayo de forma autónoma (física, color, cielo, texturas, fidelidad al pueblo real) con un ciclo fijo de cambio → captura → comprobación → commit. Usar cuando el usuario pida "continúa", "sigue mejorando", o una mejora general sin detalles.
---

# Villarcayo autopilot

Juego web tipo GTA del pueblo real de Villarcayo (Burgos). Stack: TypeScript + Vite + Three.js + Rapier, Howler.js, hls.js.
Habla con el usuario en **español**.

## Reglas que no se rompen

1. **Fidelidad al pueblo real.** Nada inventado: cada comercio, banco, farola, valla, árbol o cartel sale de OSM / Catastro / LiDAR / ortofoto o de una foto del usuario.
   - Sin referencia → no se añade. Se pregunta al usuario o se deja anotado.
   - Las correcciones con foto van en `data/corrections.json`, nunca escritas a mano en el código.
2. **Atribución.** Mantener ODbL (OpenStreetMap), IGN/PNOA y Catastro en créditos y README.
3. **Datos horneados.**
   - Si tocas `tools/geodata/*`, ejecuta `tools/geodata/bake_all.sh` entero. Un horneado parcial pierde `meta.ortho` / `surroundings`, y `tests/unit/map.test.ts` lo detecta.
   - Después ejecuta `npm run map`.
4. **Lluvia.** Las partículas de lluvia están desactivadas a propósito (`RainFX.particles = false`). El usuario quiere más adelante una lluvia realista "tipo Cyberpunk/RTX". No reactivar las gotas simples.
   - Lo mojado (suelo que brilla, menos agarre) sí funciona.
5. **Audio.** Los ficheros de sonido los pone el usuario. En `public/config/audio.json` se dejan rutas de marcador; nunca se generan ni se descargan audios con licencia dudosa.
6. **Git.**
   - Trabajar solo en la rama de desarrollo indicada en la sesión. No abrir PR salvo que se pida.
   - Mensajes de commit en inglés, claros, con los trailers de la sesión. Sin identificadores de modelo.
7. **Artefacto publicado.** Tras cada entrega, republicar `dist/` en el artefacto del proyecto (ver «Publicar»).

## Ciclo de trabajo

Para cada mejora, en pasos pequeños:

1. **Elegir** una cosa del backlog de abajo, o lo que pida el usuario. Decirle en una línea qué vas a hacer.
2. **Leer** el código implicado antes de tocarlo:

   | Área | Ficheros |
   |---|---|
   | Vehículos y física | `src/entities/Vehicle.ts`, `public/config/vehicles.json` |
   | Mundo y superficies | `src/world/World.ts` (`surfaceAt`, `wetness`) |
   | Cielo y luz | `src/world/Environment.ts` (`setTime`, `applyWeather`, cúpula), `src/world/Climate.ts` |
   | Fachadas | `src/world/Buildings.ts` (`photoColour`), `src/world/facadeStyles.ts`, `src/world/Materials.ts` |
   | Carreteras | `src/world/textures.ts` (`asphaltTexture`), `roadAtlasMaterial` en `Materials.ts` |
   | Peatones | `src/entities/PedestrianAI.ts`, `PedestrianSystem.ts` |
   | Menú y llegada | `src/ui/MainMenu.ts`, `src/ui/ArrivalSequence.ts`, `index.html` |

3. **Cambiar** lo mínimo, imitando el estilo del código: comentarios en inglés y la misma densidad.
4. **Comprobar en rápido:** `npm run check` (tsc + biome + vitest).
   - Si cambias lógica pura (IA, clima, física), añade un test unitario en `tests/unit/`.
5. **Mirar el resultado.** Nada visual se da por bueno sin captura.
   ```sh
   npm run build && (npx vite preview --port 4173 > /tmp/preview.log 2>&1 &)
   HOURS=13 node tools/qa/look.cjs <dir> plaza 70 50 30 0 0 calle 40 30 5 10 -5
   HOURS=20.9 node tools/qa/look.cjs <dir> plaza 70 50 30 0 0            # atardecer / hora azul
   HOURS=13 WEATHER=nublado node tools/qa/look.cjs <dir> plaza 70 50 30 0 0
   node tools/qa/drive.cjs                                               # 0–50 km/h y frenada, seco/mojado
   ```
   - Abre las PNG y míralas de verdad. `ERRORS` solo debe traer fallos de certificado de recursos externos.
   - Referencia de física (berlina): 0–50 km/h ≈ 1,8 s; 50→0 ≈ 8 m en seco y ≈ 10 m en mojado.
   - Vistas útiles (x z altura objetivoX objetivoZ):
     - plaza aérea `70 50 30 0 0`;
     - calle del Ayuntamiento `40 30 5 10 -5`.
6. **e2e antes de entregar.** Lanza `timeout 1300 npx playwright test` en segundo plano; con SwiftShader tarda.
   - `tests/e2e` fija `hours = 13`.
7. **Commit y push** a la rama de la sesión: `git push -u origin <rama>`, con reintentos solo si falla la red.
8. **Publicar** y escribir un informe breve en español: qué cambió, cómo se comprobó, qué queda pendiente y qué fotos harían falta.

## Publicar

- `npm run build` y luego republicar `dist/index.html` con todos sus ficheros en el artefacto del proyecto.
  - Usar la misma URL que en entregas anteriores.
  - Al republicar, quitar los `assets/index-*.js` viejos (`null` en `files`).
- La página publicada bloquea medios externos (CSP), así que la radio cae sola a las emisoras locales generadas. Es lo esperado.

## Backlog (ordenado; actualizar al terminar cada punto)

1. **Física.**
   - Suspensión visual: cabeceo al frenar o acelerar y balanceo en curva, en el `rig`.
   - Daños por impacto: abolladuras, faros rotos.
   - Neumáticos que derrapan dejando marcas.
   - Peatones: ragdoll con más articulaciones.
2. **Color.**
   - Variación de suciedad en la base de las fachadas (zócalo más oscuro, regueros bajo las ventanas).
   - Tejados con musgo y desgaste según la orientación.
3. **Cielo.**
   - Nubes volumétricas baratas (capa de ruido en la cúpula) que se muevan con el viento.
   - Halo del sol con niebla.
   - Luna visible.
4. **Carreteras.**
   - Pasos de cebra y líneas gastadas.
   - Tapas de alcantarilla.
   - Charcos en los baches cuando está mojado (preparación para la lluvia RTX).
5. **Lluvia RTX (cuando el usuario lo pida).**
   - Reflejos en pantalla (SSR) sobre el suelo mojado.
   - Gotas con refracción en cámara, salpicaduras, halos de farolas.
6. **Zonas rotas.** Pedir capturas al usuario y corregirlas con datos.

## Errores que ya pasaron (no repetir)

- **`pkill -f "vite preview"` mata tu propia shell.** Para pararlo, busca el PID con `pgrep -f "vite preview"` y usa `kill <pid>`.
- **Índices con `% 3` sobre valores fraccionarios producen colores NaN.** Usa enteros.
- **`roof.clone()` pierde `userData.redirect`.** Al clonar, cópialo a mano.
- **Biome rechaza:**
  - callbacks de `forEach` que devuelven valor;
  - el operador coma;
  - `any`.
  - Las clases solo estáticas necesitan `biome-ignore`.
- **El rellenado de contornos (`fill`) rompía Santa Marina.** Los hitos (church, townhall, torre) se excluyen.
- **No poner setos sobre el puente.** Clasificar las barreras con la ortofoto (`tools/geodata/hedges.py`).

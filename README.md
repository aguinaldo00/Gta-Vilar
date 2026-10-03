# Villarcayo Sandbox

A browser-based 3D open-world sandbox in the spirit of the early 3D-era *Grand Theft Auto* games, set in **Villarcayo de Merindad de Castilla la Vieja (Burgos, Spain)**. The town is built **from real OpenStreetMap data**: the actual streets, the footprint and height of each of its 1,592 buildings, the course of the Río Nela, parks, trees, street lamps and pedestrian crossings. Built with **TypeScript + Three.js** and bundled with Vite.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle in dist/
npm run map        # regenerate src/world/data/villarcayo.json from data/villarcayo.osm
```

![Aerial view of central Villarcayo](docs/vista-aerea.jpg)

## Controls

| Action | Keyboard / mouse | Touch (phones and tablets) |
| --- | --- | --- |
| Walk / drive | **W A S D** / arrows | Joystick (left half of the screen) |
| Run | **Shift** | Push the joystick all the way |
| Jump / handbrake (drift) | **Space** | **SALTAR / FRENO** button |
| Steal / get out of a vehicle | **F** / **E** | **ROBAR / SALIR** button |
| Camera | Mouse (click to lock the pointer) | Drag on the right half of the screen |
| Back to the Plaza Mayor | **R** | |
| Help / mute | **H** / **M** | |

## Where the map comes from

The data pipeline runs in two steps. The browser never parses OSM.

1. **`data/villarcayo.osm`**: an OpenStreetMap export of the bounding box 42.92577–42.95111 N, 3.59137–3.55109 W (≈ 3.3 × 2.8 km).
2. **`scripts/osm-to-map.ts`** (Node, no dependencies) reads the XML, projects coordinates and writes **`src/world/data/villarcayo.json`** (≈ 390 KB). Its processing steps:
   - simplifies geometry (Douglas–Peucker, 0.25–0.5 m)
   - clips everything to the bounds
   - assembles multipolygons (buildings with courtyards, the Plaza Mayor, farmland)
   - infers sidewalks
   - marks road junctions

**Projection.** Equirectangular around the **centroid of the Plaza Mayor** (`place=square`, 42.939036 N, 3.571694 W). +X is east, +Z is south, in metres: `x = (lon − lon0)·cos(lat0)·π/180·R`, `z = −(lat − lat0)·π/180·R`, with R = 6 371 008.8 m. At town scale the distortion is negligible.

### What comes from OSM and what is assumed

| Element | From OSM | Assumed / modelled by hand |
| --- | --- | --- |
| Streets | Course, type, name, `width`/`lanes`, bridges, tunnels (excluded), `sidewalk` tags | Width by type when untagged (primary 7.5 m … footway 2 m); sidewalks inferred on streets lined with buildings |
| Buildings | Real footprint (with courtyards), `building:levels`, `height`, type, material. **3,383 building parts** (`building:part`, from the Spanish cadastre) with their own number of storeys and `building:min_level`, so each building is drawn as its real stepped volume | 3.1 m per storey; 2–3 storeys when an outline has neither levels nor parts; roof shape (hipped on rectangular plots, sloping edges elsewhere, flat terraces on one-storey annexes); facade colour; galerías on 50 % of old-town houses |
| Río Nela | Centre line, weirs (Presa de Churruca, Presa Danvila), natural pools (`leisure=swimming_area`) | Channel width (16 m) and bed profile; the depth of the pools |
| Parks, fields, forest | Land-use polygons (El Soto, Parque El Soto, farmland, meadows, sports pitches…) | Infill tree density inside forests and parks |
| Trees, lamps, benches, crossings | 481 trees (including tree rows), 740 street lamps, 84 benches, 219 zebra crossings at their real positions | Bench orientation (facing the nearest street); tree species (pollarded plane trees inside the Plaza Mayor, poplars by the river) |
| Ayuntamiento | Footprint and position (`amenity=townhall`) | Façade modelled from the photos: soportales, balcony, clock and bell gable; front turned towards the templete |
| Torre del Corregimiento | Footprint and 4 storeys | Battlements, windows, door |
| Templete, fountain, statue | Position and size (`leisure=bandstand`, `amenity=fountain`, `memorial=bench` "Al músico") | 3D design (octagonal kiosk from the photo) |
| Old railway | Route of the Vía Verde Santander–Mediterráneo, station building "Antigua Estación de Horna-Villarcayo", Mikado locomotive | The locomotive model and the short stretch of track under it |
| Terrain | — | **Flat.** The OSM export carries no elevation, so only the river channel is carved |

## Graphics and quality levels

The look is inspired by modern open-world games (warm low sun, hazy distance, wind in the grass), within what a browser can do:

- **PBR materials** (`MeshStandardMaterial`) lit by an environment map baked from the sky. Facades, stone, tiles and paving have normal maps generated from their textures.
- **Facade atlas.** Upper storeys show stone-framed windows with wooden shutters and iron rails. The ground floor alternates doorways and barred windows over a sandstone plinth.
- **Physically based sky** (Preetham scattering with procedural clouds) and a ring of hazy mountains in a separate background pass with its own far plane. The mountains are a backdrop; the OSM data has no elevation.
- **Grass.** Wind-blown tufts around the camera in one draw call. A density mask keeps them off roads, buildings, paving and water, and fields turn golden.
- **Trees.** Crowns are made of alpha-tested leaf cards with volume-like normals and wind sway, and their shadows respect the leaf cut-outs.
- **Water.** It shows Fresnel sky reflection, sun glint, waves flowing downstream, colour and transparency from the real channel depth, foam at the edges, and boulders along the banks.
- **Post-processing** (desktop only): multisampled HDR, subtle bloom, ACES tone mapping and a warm cinematic grade with vignette.

| | Desktop (high) | Phones and tablets |
| --- | --- | --- |
| Post-processing | MSAA ×4, bloom, colour grade | No (direct render with tone mapping) |
| Shadow map | 4096 px, trees cast shadows | 1024 px, no tree shadows |
| Grass | 40 m radius, 0.5 m spacing | 24 m radius, 0.8 m spacing |
| Infill trees | 4,200 | 1,800 |
| Haze / draw distance | 620 m | 420 m |
| Pixel ratio | up to 1.5 | up to 1.25 |

## Performance

Measured with `renderer.info` (Chromium, 1280×720 desktop; Pixel 7 emulation), counting every pass of a frame. "Shadows" is the shadow-map pass.

| View | Desktop: draw calls (total) | Desktop: triangles (main / shadows) | Mobile: draw calls (total) | Mobile: triangles (main / shadows) |
| --- | --- | --- | --- | --- |
| Plaza Mayor | 164 | 410k / 112k | 133 | 243k / 69k |
| Densest street in the centre | 169 | 404k / 71k | 134 | 239k / 54k |
| El Soto (river and pools) | 112 | 318k / 67k | 91 | 223k / 11k |
| Old station | 106 | 229k / 16k | 83 | 84k / 9k |

On phones, every view stays within the budget of fewer than 150 draw calls and fewer than 300k visible triangles. The desktop "high" level spends more on grass, trees and shadows and is meant for a desktop GPU. The figures were measured in a software renderer; frame rates have to be checked on real hardware.

How the budget is met:

- **Merged static geometry:** the batcher merges geometry per material in 384 m chunks, so distant chunks are culled by the frustum.
- **Vertex colours:** buildings, roofs and every plain-coloured prop share vertex-coloured materials.
- **Road atlas:** asphalt, sidewalk, paving, dirt, gravel and paint share one texture atlas (one draw call per chunk).
- **Instancing:** trees and riverside rocks are `InstancedMesh`es in cells; so are the four wheels of each vehicle. Grass is one instanced draw.
- **Merged vehicles and player:** each vehicle and the player are merged into a handful of meshes.
- **Hidden walls:** walls shared between building parts are not built.
- **Background pass:** the sky and mountains live in a separate pass with their own far plane.

**Collision** follows the building footprints. Each wall is a thin box collider in a spatial hash; the visual geometry is never used for collision.

## Verification

The `.osm` file rendered directly (without the converter), the in-game minimap, and an overlay of the OSM street centre lines on the minimap:

![Comparison of OpenStreetMap and the minimap](docs/comparacion-osm-minimapa.jpg)

The Plaza Mayor, framed like the reference photos:

| Ayuntamiento | Templete and Ayuntamiento |
| --- | --- |
| ![Ayuntamiento](docs/plaza-ayuntamiento.jpg) | ![Templete](docs/plaza-templete.jpg) |

## Architecture

```
scripts/osm-to-map.ts        OSM XML → projected, simplified JSON
data/villarcayo.osm          OpenStreetMap export (source)
src/
├── main.ts / Game.ts        Renderer, fixed-step (60 Hz) loop on requestAnimationFrame, per-device quality
├── core/                    Input (keyboard, pointer lock, virtual joystick), maths, mergeColoured
├── physics/CollisionWorld   2.5D colliders (rotated boxes and circles with a height range), spatial hash, raycasts
├── entities/                Player, Vehicle (arcade physics with drifting), vehicle models, skid marks
├── camera/FollowCamera      Third-person orbit camera, pulls back and widens the FOV when driving
├── world/
│   ├── data/villarcayo.json Map generated from OSM
│   ├── mapData.ts           Types and loading of the JSON
│   ├── World.ts             Builds everything; heightAt / waterAt / zoneAt (real street names) / roadSpawn
│   ├── Terrain.ts           Heights (river channel, pools, bridge decks), ground mesh and land-use texture
│   ├── Roads.ts             Streets, sidewalks, markings, zebra crossings, bridges; road network index
│   ├── Buildings.ts         Footprint extrusion, roofs, galerías, wall colliders
│   ├── Hydro.ts             Río Nela, pools, streams, swimming pools, weirs
│   ├── Vegetation.ts        Leaf-card trees (instanced, wind), street lamps and benches at their OSM positions
│   ├── Grass.ts             Wind-blown grass around the camera with an OSM-derived density mask
│   ├── Landmarks.ts         Ayuntamiento, Torre, templete, fountain, "Al músico", bell towers, Mikado
│   ├── Batcher.ts           Merging per material and chunk
│   └── Environment (sky, IBL, sun, mountains) / Materials (PBR) / textures / geo / geometry / props / Water
├── render/Pipeline.ts       Background (sky + mountains) and town passes; HDR composer with bloom and grade
├── ui/                      HUD, minimap (vector OSM data), touch controls
└── audio/GameAudio.ts       Synthesised engine and tyre screech
```

`window.__game` exposes the running `Game`, and `game.update(dt)` advances the simulation deterministically (useful for tests).

## Licence and attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License (ODbL 1.0). The attribution is also shown on the game's start screen.

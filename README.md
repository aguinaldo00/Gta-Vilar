# Villarcayo Sandbox

A browser-based 3D open-world sandbox in the spirit of the early 3D-era *Grand Theft Auto* games, set in **Villarcayo de Merindad de Castilla la Vieja (Burgos, Spain)**. The town is built **from real open data**: OpenStreetMap streets and footprints, the real relief and building heights measured by the **PNOA-LiDAR** point cloud, and the **PNOA orthophoto** on the ground, the roofs and the surrounding hills of Las Merindades. It also includes the course of the Río Nela, parks, trees, street lamps and pedestrian crossings. Built with **TypeScript + Three.js + Rapier** and bundled with Vite.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle in dist/
npm run check      # typecheck + Biome lint/format check + unit tests (Vitest)
npm run test:e2e   # real-browser tests (Playwright, after npm run build)
npm run map        # regenerate public/maps/villarcayo.json from data/villarcayo.osm
bash tools/geodata/bake_all.sh   # full geodata bake (OSM + LiDAR + MDT + orthophoto), see below
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
2. **`scripts/osm-to-map.ts`** (Node, no dependencies) reads the XML, projects coordinates and writes **`public/maps/villarcayo.json`** (loaded at runtime; ≈ 1.3 MB once the LiDAR measurements and tree crowns are baked in). Its processing steps:
   - simplifies geometry (Douglas–Peucker, 0.25–0.5 m)
   - clips everything to the bounds
   - assembles multipolygons (buildings with courtyards, the Plaza Mayor, farmland)
   - infers sidewalks
   - marks road junctions

**Projection.** Exact transverse Mercator into **ETRS89 / UTM 30N (EPSG:25830)**, the grid of the Spanish IGN data, with a local origin at E 453 356, N 4 754 203 (the Plaza Mayor): `x = E − 453356` (east), `z = 4754203 − N` (south), in metres. Heights are metres above a datum of 595.94 m (the ground of the plaza), so the OSM, LiDAR, MDT and orthophoto layers line up without any resampling.

3. **`tools/geodata/`** (Python: laspy, numpy, scipy, scikit-image, pillow) bakes the IGN data into the same map. `bake_all.sh` runs every step; the raw downloads stay in `raw/`, which is not committed.
   - `lidar_rasters.py`: the **PNOA-LiDAR 2025** classified point clouds (LAZ, 1 km tiles around the town) → 1 m rasters: bare ground (class 2), surface, building roofs (class 6) and vegetation (class 5).
   - `bake_terrain_buildings.py`:
     - ground model: LiDAR blended over a 25 m feather into the **MDT05** where there is no point cloud → `public/maps/villarcayo.terrain.bin` (Int16 cm, 2 m grid)
     - every OSM building measured from its roof points (ground level, eave height, ridge height)
     - buildings that exist in the LiDAR but not in OSM traced from the roof raster (202 added)
     - 10,452 tree crowns detected in the canopy model, with their height and radius
     - Río Nela water levels sampled along the channel, flowing monotonically downstream, with the bed carved under them
   - `fetch_ortho.py`: **PNOA orthophoto** tiles (WMS) → `public/maps/ortho/{i}_{j}.jpg`, 256 m tiles, draped on the ground and on the roofs.
   - `fetch_surroundings.py`: 24 × 24 km of **MDT25** + orthophoto → `public/maps/surroundings.*`, the real valley and hills on the horizon.

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
| Shops, bars and services | **224 establishments** (`shop`, `amenity` bar/pub/restaurant/café/bank/pharmacy/post office/police…, `office`, `craft`, `healthcare`, hotels, including closed ones such as Bar Capitol) with their real name, snapped to the street-facing wall of their building | Shop front by trade (shop window, door or roller shutter, awning, terrace), sign colours (brand colours for banks and chains, otherwise by trade) |
| Churches | Footprints and positions of Santa Marina, its campanile (`tower:type=bell_tower`), the Ermita de San Roque and the Ermita de San Vicente | Santa Marina as the 1967 "tent" with the stained-glass gables and the concrete campanile with three crosses (from published descriptions); stone hermitages with espadaña |
| Sports | 29 pitches with their sport: football (Campo El Soto, Campo Genín), futsal, basketball, tennis, pádel, frontones, Bolera Nela, petanque, table tennis; Polideportivo; sports-ground fences | Court markings, goals, hoops, nets, frontón walls, the nine bolos; the polideportivo's vaulted roof |
| Parkings, fuel, buses | 37 car parks (with `orientation`), Estación de Servicio Rivera, Estación de Autobuses, bus stops | Bay layout and parked cars; canopy, pumps and totem; bus shelters |
| Picnic, playgrounds, pines | 7 picnic tables + picnic sites (riverside tables in El Soto), 13 playgrounds, conifers (`leaf_type=needleleaved`) | Extra tables around each picnic site; swings and slide; hedges on field boundaries; field patchwork where OSM has no land use |
| Terrain and heights | — (from the **PNOA-LiDAR** and **MDT05/MDT25**) | Real relief at 2 m; building walls up to the measured eave and roofs up to the measured ridge; river levels and bed depth from the LiDAR ground. Façades are still stylised (no open data on façade colour or window layout); the orthophoto on roofs has some relief displacement; the NW LiDAR tile is missing, so that corner uses the 5 m MDT |

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
| Grass | 40 m radius, 0.5 m spacing | 24 m radius, 0.9 m spacing |
| Trees (of the 10,452 LiDAR crowns) | about 8,400 | about 3,600 (lighter crowns) |
| Parked cars | about 2 of 3 bays taken | about 1 of 2 bays taken |
| Haze / draw distance | 620 m | 380 m |
| Pixel ratio | up to 1.5 | up to 1.25 |

## Performance

Measured with `renderer.info` (Chromium, 1280×720 desktop; Pixel 7 emulation), counting every pass of a frame. "Shadows" is the shadow-map pass.

| View | Desktop: draw calls (total) | Desktop: triangles (main / shadows) | Mobile: draw calls (total) | Mobile: triangles (main / shadows) |
| --- | --- | --- | --- | --- |
| Plaza Mayor | 220 | 864k / 202k | 171 | 365k / 124k |
| Densest street in the centre | 217 | 815k / 144k | 171 | 361k / 92k |
| El Soto (river and pools) | 153 | 702k / 152k | 116 | 272k / 42k |
| Old station | 150 | 571k / 38k | 106 | 168k / 16k |

The real relief costs geometry: the orthophoto ground patches, the 10,000 LiDAR tree crowns and the MDT25 landscape on the horizon added about 70k triangles to the mobile main pass, which now goes over the 300k budget in the two densest views (365k) while staying under 150 draw calls. The biggest remaining items there are the merged props (parked cars, lamps, furniture: about 107k) and the trees; they are the first candidates for LODs in the graphics phase. The desktop "high" level spends more on grass, trees and shadows and is meant for a desktop GPU. The figures were measured in a software renderer; frame rates have to be checked on real hardware.

## Architecture

The game is split so that gameplay never depends on a concrete engine or on hard-coded data:

- **Data, not code:** tuning lives in `public/config/*.json`, validated at boot. A typo or an out-of-range value fails with its exact path. The map lives in `public/maps/` and is loaded at runtime.
- **Physics behind an interface:** gameplay talks to `PhysicsWorld`, and the Rapier backend implements it. Swapping the backend, or porting to Godot or Unity physics, does not touch gameplay.
- **Systems, not a god object:** `Game` is only the composition root. Gameplay rules live in `systems/` and communicate through a typed `EventBus`.
- **Input as actions:** gameplay reads named actions (`use`, `jump`…). Keys and touch buttons are bindings in `input.json`.

```
public/
├── config/                  game.json · vehicles.json · quality.json · input.json (runtime data)
└── maps/                    villarcayo.json (OSM + LiDAR measurements), villarcayo.terrain.bin (heightmap),
                             ortho/ (orthophoto tiles), surroundings.bin/.jpg (MDT25 horizon), fetched at boot
tools/geodata/               Python bake of the IGN data (LiDAR, MDT, orthophoto) into public/maps
src/
├── main.ts                  Boot: loads config + map + Rapier, then builds the Game
├── Game.ts                  Composition root: renderer, world, entities, systems, frame loop
├── config/                  Config schema (validated) and loader
├── core/                    FixedStepLoop, EventBus + GameEvents, validation helpers, maths
├── input/                   RawInput (keyboard, pointer lock, virtual keys) → InputActions
├── physics/                 PhysicsWorld interface (layers, characters, vehicles, queries) + RapierPhysics
├── systems/                 Locomotion (fixed-step movement), VehicleInteraction (steal / get out)
├── entities/                Player, Vehicle (arcade handling with drifting), vehicle models, skid marks
├── camera/FollowCamera      Third-person orbit camera, pulls back and widens the FOV when driving
├── world/
│   ├── mapData.ts           Map types, validation and runtime loading
│   ├── World.ts             Builds everything; heightAt / heightGrid / waterAt / zoneAt / roadSpawn
│   ├── Terrain.ts           TerrainModel (heightmap sampling, bridge decks, river levels), orthophoto tiles, ground mesh
│   ├── Roads.ts             Streets, sidewalks, markings, zebra crossings, bridges; road network index
│   ├── Buildings.ts         Footprint extrusion, roofs, galerías, wall colliders
│   ├── Hydro.ts             Río Nela, pools, streams, swimming pools, weirs
│   ├── Vegetation.ts        Leaf-card trees (instanced, wind), street lamps and benches at their OSM positions
│   ├── Grass.ts             Wind-blown grass around the camera with an OSM-derived density mask
│   ├── Landmarks.ts         Ayuntamiento, Torre, templete, fountain, "Al músico", bell towers, Mikado
│   ├── Churches.ts          Santa Marina (tent church + campanile), Ermitas de San Roque and San Vicente
│   ├── Commerce.ts          Shop fronts and signs with the real names (one sign atlas), terraces
│   ├── Facilities.ts        Polideportivo, petrol station, bus station, car parks with parked cars, fences
│   ├── Sports.ts            Courts and pitches by sport, picnic tables, playgrounds
│   ├── Batcher.ts           Merging per material and chunk
│   └── Environment (sky, IBL, sun, mountains) / Materials (PBR) / textures / geo / geometry / props / Water
├── render/Pipeline.ts       Background (sky + mountains) and town passes; HDR composer with bloom and grade
├── ui/                      HUD, minimap (vector map data), touch controls
└── audio/GameAudio.ts       Synthesised engine and tyre screech
tests/
├── unit/                    Vitest: geometry, maths, config validation, map file, loop/events, Rapier backend
└── e2e/                     Playwright: boot + drive, player physics (walls, jump, swim), vehicle crashes
```

`window.__game` exposes the running `Game`, and `game.update(dt)` advances the simulation deterministically (used by the e2e tests).

## Licence and attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License (ODbL 1.0).

Elevation, LiDAR and orthophoto: PNOA-LiDAR 2025, MDT05, MDT25 and PNOA orthophoto © [Instituto Geográfico Nacional](https://www.ign.es) (CNIG), with the Junta de Castilla y León for the LiDAR, under CC BY 4.0 ([scne.es](https://www.scne.es)).

Both attributions are also shown on the game's start screen.

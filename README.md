# Villarcayo Sandbox

A browser-based 3D open-world vertical slice in the spirit of the early 3D-era *Grand Theft Auto* games, set in a stylised low-poly replica of **Villarcayo (Burgos, Spain)**. Built with **TypeScript + Three.js** and bundled with Vite. It uses no external assets: every texture is generated procedurally on a canvas at startup.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle in dist/
```

## Controls

| Key | On foot | In a vehicle |
| --- | --- | --- |
| **W A S D** / arrows | Walk (camera-relative) | Throttle / brake-reverse / steer |
| **Shift** | Run | — |
| **Space** | Jump | Handbrake (drift) |
| **F** / **E** | Steal the nearest vehicle | Get out (bail out if moving fast) |
| **Mouse** | Orbit camera (click to lock pointer, or drag) | Orbit; auto-recentres behind the car |
| **R** | Respawn in the Plaza Mayor | |
| **H** / **M** | Help panel / mute | |

## The map

| Place | What's there |
| --- | --- |
| **Plaza Mayor** | Paved square with the octagonal *kiosko* (you can climb its steps), pollarded plane trees, benches, lamps, flagpoles and a seated bronze statue. |
| **Ayuntamiento** | Sandstone town hall with a five-arch arcade you can walk through, iron balconies, waving flags and the clock gable with its iron bell cage. |
| **Torre del Corregimiento** | Crenellated medieval stone tower right behind the town hall. |
| **Camino Real** | The main east–west road. It runs through town past the plaza, crosses the railway at a level crossing and the Río Nela on a stone bridge. |
| **Parque El Soto** | Riverside woodland on the east edge: poplar-lined banks, a footpath, a footbridge, parking and picnic tables. |
| **Río Nela & piscinas naturales** | Animated flowing water. Two stone weirs hold back the turquoise natural pools, which have a jetty, diving board, sunbeds and a lifeguard chair. You wade in the river and swim in the pools. |
| **Vía Santander–Mediterráneo** | Abandoned line on the western outskirts: weed-grown track and siding, the "VILLARCAYO" station and platform, rusty wagons, a water tower and a goods shed. |
| Town & countryside | Generated blocks of Merindades-style houses with white glazed *galerías*, crop fields with hay bales, and hills closing the valley. |

Vehicles: three **sedans** (*berlina*: red, blue, yellow), a **van** (*furgoneta*) and two **tractors** are parked around the plaza, the station and El Soto.

## Architecture

```
src/
├── main.ts                  Entry: creates Game, wires the start screen
├── Game.ts                  Renderer, fixed-step (60 Hz) loop on requestAnimationFrame,
│                            input → entities → camera → HUD orchestration
├── core/
│   ├── Input.ts             Keyboard (by KeyboardEvent.code) + pointer-lock mouse
│   └── math.ts              clamp/damp/angle helpers, seeded RNG
├── physics/
│   └── CollisionWorld.ts    2.5D static colliders (rotated boxes + circles with a vertical
│                            extent) in a spatial hash; circle resolution, step-up support,
│                            camera raycasts
├── entities/
│   ├── Player.ts            Blocky avatar: idle/walk/run/jump/wade/swim/knocked states,
│   │                        procedural limb swing
│   ├── Vehicle.ts           Arcade car physics: forward/lateral velocity split, grip &
│   │                        handbrake drifting, impulse collisions, terrain limits
│   ├── VehicleModels.ts     Low-poly sedan / van / tractor rigs (steering + rolling wheels)
│   ├── vehicleSpecs.ts      Per-vehicle handling tuning
│   └── SkidMarks.ts         Instanced tyre marks ring buffer
├── camera/FollowCamera.ts   Orbit follow camera: pulls back and widens FOV when driving,
│                            auto-recentres, avoids clipping into buildings
├── world/
│   ├── layout.ts            Villarcayo geography: streets, landmarks, river curve, terrain
│   ├── World.ts             Builds everything; heightAt / waterAt / zoneAt queries
│   ├── Town.ts              Streets, sidewalks, blocks and procedural houses
│   ├── Landmarks.ts         Ayuntamiento, Torre, kiosko, plaza props
│   ├── Soto.ts              River, pools, bridges, woodland
│   ├── Railway.ts           Track, station, wagons, water tower, warehouse
│   ├── Countryside.ts       Fields, avenue, hills, map bounds
│   ├── Environment.ts       Sky dome, sun + shadows, mountains, clouds
│   ├── Terrain.ts / Water.ts / textures.ts / Materials.ts / geometry.ts / props.ts
│   └── Batcher.ts           Merges static geometry per material (≈ one draw call each)
├── ui/HUD.ts, ui/Minimap.ts Zone titles, prompts, speedometer, rotating radar
└── audio/GameAudio.ts       Synthesised engine and tyre-screech sounds (WebAudio)
```

### Design notes

- **Fixed timestep.** Physics advances in 1/60 s steps inside the `requestAnimationFrame` loop. Rendering, the camera and the HUD update once per frame.
- **Collisions are 2.5D.** Every obstacle is a footprint (box or circle) with a `[bottom, top]` height range. Bodies are circles: the player is one, and vehicles are a chain of circles along their length. Low colliders within step height are walkable, which is how the kiosko stairs and station platform work. Colliders above head height, such as the town hall's upper floor and the galerías, let bodies pass underneath. Layer masks decide what blocks the player, vehicles and the camera.
- **Drifting** comes from keeping the world-space velocity and decomposing it against the heading each step. The handbrake or a hard turn at speed lowers lateral grip, so the heading turns faster than the velocity follows.
- **Ground** is an analytic height function (flat town, carved river channel, edge hills) plus raised rectangles for sidewalks, decks and ballast. Vehicles refuse terrain that is too low (the river) or too steep (the hills).
- `window.__game` exposes the running `Game` for debugging and automated tests. `game.update(dt)` advances the simulation deterministically.

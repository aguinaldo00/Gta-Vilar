import { arr, bool, num, obj, oneOf, record, str, type Validator } from '@/core/validate';

/** Procedural vehicle model built by VehicleModels (to be replaced by GLB paths). */
export const VEHICLE_MODELS = ['sedan', 'van', 'tractor'] as const;

const vehicleSpec = obj({
  label: str,
  model: oneOf(...VEHICLE_MODELS),
  length: num(0.5, 20),
  width: num(0.5, 5),
  height: num(0.5, 6),
  wheelBase: num(0.5, 10),
  /** m/s */
  maxSpeed: num(0, 120),
  maxReverse: num(0, 40),
  accel: num(0),
  brake: num(0),
  rolling: num(0),
  steerMax: num(0, 1.5),
  steerSpeed: num(0),
  /** How much steering lock fades with speed. */
  steerFalloff: num(0, 1),
  maxYawRate: num(0),
  /** Lateral grip (1/s). Higher = less sliding. */
  grip: num(0),
  /** Lateral grip with the handbrake pulled. */
  driftGrip: num(0),
  mass: num(1),
  camDistance: num(1, 40),
  camHeight: num(0, 10),
  /** Fake gearbox for the engine sound. */
  gears: num(1, 8),
  /** Engine tone at idle (Hz). */
  engineHz: num(10, 200),
  /** Leaves tyre marks when sliding (not tractors on soft tyres). */
  skidMarks: bool,
  /** Minimap marker colour. */
  mapColor: str,
});
export type VehicleSpec = ReturnType<typeof vehicleSpec> & { id: string };

const quality = obj({
  pixelRatio: num(0.5, 3),
  groundTexture: num(256, 16384),
  fogDensity: num(0, 0.1),
  drawDistance: num(50, 5000),
  shadowMapSize: num(256, 8192),
  treeShadows: bool,
  grassRadius: num(0, 200),
  grassSpacing: num(0.1, 5),
  treeBudget: num(0),
  postFX: bool,
  detail: oneOf(0, 1),
});
export type Quality = ReturnType<typeof quality>;

const point = obj({ x: num(), z: num() });

const game = obj({
  simulation: obj({ fixedStep: num(1 / 240, 1 / 15), maxSubSteps: num(1, 20) }),
  player: obj({ spawn: obj({ x: num(), z: num(), facing: num() }), enterReach: num(0.5, 5) }),
  camera: obj({ fov: num(20, 120), near: num(0.01, 5), walkDistance: num(1, 30), walkHeight: num(0, 5) }),
  vehicles: arr(obj({ type: str, color: str, near: point, mainRoad: bool })),
});
export type GameConfig = ReturnType<typeof game>;

const input = obj({
  /** Action → KeyboardEvent.code list. */
  bindings: record(arr(str)),
});
export type InputConfig = ReturnType<typeof input>;

export const SCHEMAS = {
  game,
  input,
  quality: obj({ desktop: quality, touch: quality }),
  vehicles: record(vehicleSpec),
} satisfies Record<string, Validator<unknown>>;

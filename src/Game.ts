import * as THREE from 'three';
import { GameAudio } from './audio/GameAudio';
import { FollowCamera } from './camera/FollowCamera';
import { Input } from './core/Input';
import { clamp } from './core/math';
import { Player } from './entities/Player';
import { SkidMarks } from './entities/SkidMarks';
import { type DriveControls, PARKED, Vehicle } from './entities/Vehicle';
import type { VehicleKind } from './entities/vehicleSpecs';
import { CollisionWorld, type Contact, Layer } from './physics/CollisionWorld';
import { Pipeline } from './render/Pipeline';
import { HUD } from './ui/HUD';
import { Minimap } from './ui/Minimap';
import { TouchControls } from './ui/TouchControls';
import { type Quality, World } from './world/World';

const FIXED_STEP = 1 / 60;
const MAX_STEPS = 5;
const ENTER_REACH = 1.6;
/** Plaza Mayor, between the templete and the Ayuntamiento, looking at the town hall. */
const SPAWN = { x: 4, z: 14, facing: Math.PI };

const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  use: ['KeyF', 'KeyE'],
};

/** Vehicles are parked on the real street nearest to each of these points. */
const VEHICLE_SPAWNS: { kind: VehicleKind; color: string; x: number; z: number; main: boolean }[] = [
  { kind: 'sedan', color: '#b3261e', x: 30, z: 10, main: true },
  { kind: 'tractor', color: '#2e7d32', x: -25, z: 30, main: true },
  { kind: 'van', color: '#ecebe6', x: -60, z: -40, main: true },
  { kind: 'sedan', color: '#1f4e9a', x: 80, z: 60, main: true },
  { kind: 'sedan', color: '#e0b020', x: -200, z: -250, main: true },
  { kind: 'tractor', color: '#c0392b', x: -640, z: 1150, main: false },
];

declare global {
  interface Window {
    __game?: Game;
  }
}

/**
 * Owns the renderer and the main loop. Physics runs at a fixed 60 Hz inside a
 * requestAnimationFrame loop; camera, HUD and animation run per frame.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  readonly collision = new CollisionWorld();
  readonly world: World;
  readonly player = new Player();
  readonly vehicles: Vehicle[] = [];
  readonly followCam: FollowCamera;
  private readonly skids: SkidMarks;
  private readonly hud = new HUD();
  private readonly minimap: Minimap;
  private readonly audio = new GameAudio();
  private readonly touch: TouchControls | null;
  private readonly contacts: Contact[] = [];
  private last = -1;
  private acc = 0;
  private time = 0;
  private jumpQueued = false;
  private running = false;
  readonly quality: Quality;
  readonly pipeline: Pipeline;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const isTouch = TouchControls.supported();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.25 : 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.65;
    container.appendChild(this.renderer.domElement);

    this.input = new Input(this.renderer.domElement);
    this.touch = isTouch ? new TouchControls(this.input) : null;
    // Draw distance is the main performance knob: phones see less far.
    const quality: Quality = isTouch
      ? {
          groundTexture: 2048,
          fogDensity: 0.0033,
          drawDistance: 380,
          shadowMapSize: 1024,
          treeShadows: false,
          grassRadius: 24,
          grassSpacing: 0.9,
          treeBudget: 1800,
          postFX: false,
          detail: 0,
        }
      : {
          groundTexture: 4096,
          fogDensity: 0.0019,
          drawDistance: 620,
          shadowMapSize: 4096,
          treeShadows: true,
          grassRadius: 40,
          grassSpacing: 0.5,
          treeBudget: 4200,
          postFX: true,
          detail: 1,
        };
    quality.groundTexture = Math.min(quality.groundTexture, this.renderer.capabilities.maxTextureSize);
    this.quality = quality;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.25, quality.drawDistance);
    this.world = new World(this.scene, this.renderer, this.collision, quality);
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, this.world.env, quality.postFX);
    this.skids = new SkidMarks(this.scene);
    this.followCam = new FollowCamera(this.camera);
    this.minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement);

    for (const s of VEHICLE_SPAWNS) {
      const p = this.world.roadSpawn(s.x, s.z, s.main);
      const v = new Vehicle(s.kind, s.color, p.x, p.z, p.heading);
      v.y = this.world.heightAt(p.x, p.z);
      this.vehicles.push(v);
      this.scene.add(v.rig.root);
      v.update(0.001, PARKED, this.world, this.collision, this.skids);
    }

    this.scene.add(this.player.root);
    this.player.spawn(SPAWN.x, SPAWN.z, this.world.heightAt(SPAWN.x, SPAWN.z), SPAWN.facing);

    this.renderer.domElement.addEventListener('click', () => {
      if (this.running && !this.input.locked) this.input.requestLock();
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    window.__game = this;
  }

  /** Called from the start screen (a user gesture, so audio and pointer lock are allowed). */
  begin(): void {
    this.running = true;
    this.audio.init();
    if (this.touch) {
      // Phones: go fullscreen and landscape where the browser allows it.
      try {
        document.documentElement
          .requestFullscreen?.()
          .then(() => {
            const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
            return o.lock?.('landscape');
          })
          .catch(() => undefined);
      } catch {
        /* fullscreen not available (e.g. iPhone Safari) */
      }
    } else this.input.requestLock();
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.pipeline.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private readonly frame = (nowMs: number): void => {
    requestAnimationFrame(this.frame);
    const now = nowMs / 1000;
    const dt = this.last < 0 ? FIXED_STEP : Math.min(0.1, now - this.last);
    this.last = now;
    this.update(dt, now);
    this.pipeline.render();
  };

  /** Advances the simulation by `dt` seconds (also used by automated tests). */
  update(dt: number, now = performance.now() / 1000): void {
    this.time += dt;
    if (this.running) this.handleActions();

    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED_STEP && steps < MAX_STEPS) {
      this.step(FIXED_STEP);
      this.acc -= FIXED_STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;

    const v = this.player.vehicle;
    for (const veh of this.vehicles) {
      if (veh === v && veh.impact > 4) this.followCam.addShake(veh.impact * 0.03);
      veh.impact = 0;
    }

    const mouse = this.running ? this.input.consumeMouse() : { dx: 0, dy: 0 };
    this.followCam.update(
      dt,
      mouse,
      now - this.input.lastLookTime,
      {
        position: this.player.pos,
        heading: v ? v.heading : this.player.facing,
        speed: v ? v.speed : 0,
        inVehicle: !!v,
        distance: v ? v.spec.camDistance : 5.2,
        height: v ? v.spec.camHeight : 1.55,
      },
      this.collision,
      this.world,
    );

    this.world.update(dt, this.time, this.player.pos, this.camera);
    this.audio.update(v);

    const zone = this.world.zoneAt(this.player.pos.x, this.player.pos.z);
    const near = v ? null : this.nearestVehicle();
    const action = this.touch ? 'Toca <b>ROBAR</b>' : 'Pulsa <b>F</b> / <b>E</b> para robar';
    const prompt = near ? `${action}: <b>${near.spec.label}</b>` : null;
    this.touch?.setDriving(!!v);
    this.hud.update(dt, zone, this.player.state, v, prompt, this.input.locked || !this.running || !!this.touch);
    this.minimap.draw(this.player.pos.x, this.player.pos.z, this.player.facing, this.followCam.yaw, this.vehicles, v);
    this.input.endFrame();
  }

  private handleActions(): void {
    const i = this.input;
    if (i.wasPressed(...KEYS.use)) this.toggleVehicle();
    if (i.wasPressed(...KEYS.jump)) this.jumpQueued = true;
    if (i.wasPressed('KeyH')) this.hud.toggleHelp();
    if (i.wasPressed('KeyM')) this.hud.flash(this.audio.toggleMute() ? 'Sonido: OFF' : 'Sonido: ON');
    if (i.wasPressed('KeyR')) this.respawn();
  }

  private step(dt: number): void {
    const i = this.input;
    const drive = this.player.vehicle;
    const active = this.running;
    for (const v of this.vehicles) {
      let c: DriveControls = PARKED;
      if (v === drive && active) {
        c = {
          throttle: this.forwardAxis(),
          steer: this.sideAxis(),
          handbrake: i.isDown(...KEYS.jump),
        };
      } else if (v === drive) c = { throttle: 0, steer: 0, handbrake: false };
      v.update(dt, c, this.world, this.collision, this.skids);
    }
    for (let a = 0; a < this.vehicles.length; a++) {
      for (let b = a + 1; b < this.vehicles.length; b++) Vehicle.collidePair(this.vehicles[a], this.vehicles[b]);
    }

    if (drive) {
      this.player.followVehicle();
      this.jumpQueued = false;
      return;
    }
    // Camera-relative movement.
    let mx = 0,
      mz = 0;
    if (active) {
      const f = this.forwardAxis();
      const s = this.sideAxis();
      const fw = this.followCam.forward();
      // Camera right = forward rotated 90° clockwise seen from above.
      mx = fw.x * f - fw.z * s;
      mz = fw.z * f + fw.x * s;
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
    }
    this.player.update(
      dt,
      { moveX: mx, moveZ: mz, run: active && (i.isDown(...KEYS.run) || Math.hypot(i.stickX, i.stickY) > 0.92), jump: this.jumpQueued },
      this.world,
      this.collision,
      this.vehicles,
    );
    this.jumpQueued = false;
  }

  /** Keyboard and touch joystick combined, -1..1. */
  private forwardAxis(): number {
    return clamp(this.input.axis(KEYS.back, KEYS.forward) + this.input.stickY, -1, 1);
  }

  private sideAxis(): number {
    return clamp(this.input.axis(KEYS.left, KEYS.right) + this.input.stickX, -1, 1);
  }

  private nearestVehicle(): Vehicle | null {
    if (this.player.isKnocked) return null;
    const p = this.player.pos;
    let best: Vehicle | null = null;
    let bestD = Infinity;
    for (const v of this.vehicles) {
      if (!v.isNear(p.x, p.z, ENTER_REACH) || Math.abs(p.y - v.y) > 2) continue;
      const d = (v.x - p.x) ** 2 + (v.z - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  toggleVehicle(): void {
    const v = this.player.vehicle;
    if (!v) {
      const near = this.nearestVehicle();
      if (near) {
        this.player.enterVehicle(near);
        this.followCam.addShake(0.05);
      }
      return;
    }
    // Exit on the driver's side if free, otherwise passenger side, then front/back.
    const candidates: [number, number, number][] = [];
    for (const side of [1, -1] as const) {
      const p = v.sidePoint(side);
      candidates.push([p.x, p.z, Math.atan2(p.x - v.x, p.z - v.z)]);
    }
    for (const dir of [1, -1]) {
      const d = (v.spec.length / 2 + 1) * dir;
      candidates.push([v.x + v.forwardX * d, v.z + v.forwardZ * d, v.heading]);
    }
    for (const [x, z, facing] of candidates) {
      const y = this.world.heightAt(x, z);
      if (Math.abs(y - v.y) > 1.2) continue;
      this.contacts.length = 0;
      this.collision.resolveCircle(x, z, this.player.radius, Layer.Player, y, this.player.height, 0.45, this.contacts);
      if (this.contacts.length > 0) continue;
      const speed = Math.abs(v.speed);
      this.player.exitVehicle(x, z, y, facing);
      if (speed > 8) {
        // Bailing out of a moving car: roll on the tarmac.
        this.player.knock(v.vx * 0.5 + Math.sin(facing) * 2, v.vz * 0.5 + Math.cos(facing) * 2, 3);
      }
      return;
    }
    this.hud.flash('No hay sitio para salir');
  }

  private respawn(): void {
    if (this.player.vehicle) this.player.exitVehicle(SPAWN.x, SPAWN.z, this.world.heightAt(SPAWN.x, SPAWN.z), SPAWN.facing);
    else this.player.spawn(SPAWN.x, SPAWN.z, this.world.heightAt(SPAWN.x, SPAWN.z), SPAWN.facing);
    this.followCam.yaw = 0;
    this.hud.flash('Plaza Mayor');
  }
}

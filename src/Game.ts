import * as THREE from 'three';
import { GameAudio } from './audio/GameAudio';
import { FollowCamera } from './camera/FollowCamera';
import type { Config } from './config/Config';
import { EventBus } from './core/EventBus';
import type { GameEvents } from './core/events';
import { FixedStepLoop } from './core/FixedStepLoop';
import { Player } from './entities/Player';
import { SkidMarks } from './entities/SkidMarks';
import { PARKED, Vehicle } from './entities/Vehicle';
import { InputActions } from './input/InputActions';
import { RawInput } from './input/RawInput';
import { Layer } from './physics/PhysicsWorld';
import { RapierPhysics } from './physics/RapierPhysics';
import { Pipeline } from './render/Pipeline';
import { Locomotion } from './systems/Locomotion';
import { VehicleInteraction } from './systems/VehicleInteraction';
import { HUD } from './ui/HUD';
import { Minimap } from './ui/Minimap';
import { TouchControls } from './ui/TouchControls';
import type { MapData } from './world/mapData';
import { World } from './world/World';

declare global {
  interface Window {
    __game?: Game;
  }
}

/**
 * Composition root: builds the renderer, world, entities and systems from the
 * loaded config and runs the frame loop. Gameplay rules live in the systems;
 * this class only wires them together and orders their updates.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly events = new EventBus<GameEvents>();
  readonly input: RawInput;
  readonly actions: InputActions;
  readonly physics = new RapierPhysics();
  readonly world: World;
  readonly player = new Player();
  readonly vehicles: Vehicle[] = [];
  readonly followCam: FollowCamera;
  readonly pipeline: Pipeline;
  readonly quality: Config['quality']['desktop'];
  private readonly loop: FixedStepLoop;
  readonly locomotion: Locomotion;
  readonly interaction: VehicleInteraction;
  private readonly skids: SkidMarks;
  private readonly hud = new HUD();
  private readonly minimap: Minimap;
  private readonly audio = new GameAudio();
  private readonly touch: TouchControls | null;
  private last = -1;
  private time = 0;
  private running = false;

  constructor(
    container: HTMLElement,
    private readonly config: Config,
    map: MapData,
  ) {
    const isTouch = TouchControls.supported();
    const quality = { ...(isTouch ? config.quality.touch : config.quality.desktop) };

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.65;
    container.appendChild(this.renderer.domElement);
    quality.groundTexture = Math.min(quality.groundTexture, this.renderer.capabilities.maxTextureSize);
    this.quality = quality;

    this.input = new RawInput(this.renderer.domElement);
    this.actions = new InputActions(this.input, config.input);
    this.touch = isTouch ? new TouchControls(this.input) : null;

    const cam = config.game.camera;
    this.camera = new THREE.PerspectiveCamera(cam.fov, 1, cam.near, quality.drawDistance);
    this.world = new World(map, this.scene, this.renderer, this.physics, quality);
    this.physics.setTerrain(this.world.heightGrid(2));
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, this.world.env, quality.postFX);
    this.skids = new SkidMarks(this.scene);
    this.followCam = new FollowCamera(this.camera);
    this.minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, map);
    this.loop = new FixedStepLoop(config.game.simulation.fixedStep, config.game.simulation.maxSubSteps);

    this.spawnVehicles();
    this.scene.add(this.player.root);
    this.player.attachBody(
      this.physics.createCharacter({
        radius: this.player.radius,
        height: this.player.height,
        maxStep: this.player.stepHeight,
        maxSlopeDeg: 50,
        mask: Layer.Player,
      }),
    );
    this.respawn(false);

    this.locomotion = new Locomotion(this.player, this.vehicles, this.world, this.physics, this.skids, this.actions, this.followCam);
    this.interaction = new VehicleInteraction(
      this.player,
      this.vehicles,
      this.world,
      this.physics,
      this.events,
      config.game.player.enterReach,
    );
    this.events.on('vehicle:entered', () => this.followCam.addShake(0.05));
    this.events.on('vehicle:impact', (e) => this.followCam.addShake(e.strength * 0.03));
    this.events.on('hud:flash', (e) => this.hud.flash(e.text));

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
    this.locomotion.enabled = true;
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

  private spawnVehicles(): void {
    for (const s of this.config.game.vehicles) {
      const p = this.world.roadSpawn(s.near.x, s.near.z, s.mainRoad);
      const v = new Vehicle(this.config.vehicles[s.type], s.color, p.x, p.z, p.heading);
      v.y = this.world.heightAt(p.x, p.z);
      this.vehicles.push(v);
      this.scene.add(v.rig.root);
      v.attachBody(
        this.physics.createVehicle({
          length: v.spec.length,
          width: v.spec.width,
          height: v.spec.height,
          clearance: 0.3,
          mask: Layer.Vehicle,
        }),
      );
      v.update(0.001, PARKED, this.world, this.skids);
    }
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
    const dt = this.last < 0 ? this.loop.step : Math.min(0.1, now - this.last);
    this.last = now;
    this.update(dt, now);
    this.pipeline.render();
  };

  /** Advances the game by `dt` seconds (also used by automated tests). */
  update(dt: number, now = performance.now() / 1000): void {
    this.time += dt;
    if (this.running) this.handleActions();
    this.locomotion.frame();
    this.loop.advance(dt, (step) => this.locomotion.step(step));

    const v = this.player.vehicle;
    for (const veh of this.vehicles) {
      if (veh === v && veh.impact > 4) this.events.emit('vehicle:impact', { vehicle: veh, strength: veh.impact });
      veh.impact = 0;
    }

    const mouse = this.running ? this.input.consumeMouse() : { dx: 0, dy: 0 };
    const cam = this.config.game.camera;
    this.followCam.update(
      dt,
      mouse,
      now - this.input.lastLookTime,
      {
        position: this.player.pos,
        heading: v ? v.heading : this.player.facing,
        speed: v ? v.speed : 0,
        inVehicle: !!v,
        distance: v ? v.spec.camDistance : cam.walkDistance,
        height: v ? v.spec.camHeight : cam.walkHeight,
      },
      this.physics,
      this.world,
    );

    this.world.update(dt, this.time, this.player.pos, this.camera);
    this.audio.update(v);

    const zone = this.world.zoneAt(this.player.pos.x, this.player.pos.z);
    const near = this.interaction.nearest();
    const action = this.touch ? 'Toca <b>ROBAR</b>' : 'Pulsa <b>F</b> / <b>E</b> para robar';
    const prompt = near ? `${action}: <b>${near.spec.label}</b>` : null;
    this.touch?.setDriving(!!v);
    this.hud.update(dt, zone, this.player.state, v, prompt, this.input.locked || !this.running || !!this.touch);
    this.minimap.draw(this.player.pos.x, this.player.pos.z, this.player.facing, this.followCam.yaw, this.vehicles, v);
    this.input.endFrame();
  }

  private handleActions(): void {
    const a = this.actions;
    if (a.pressed('use')) this.interaction.toggle();
    if (a.pressed('help')) this.hud.toggleHelp();
    if (a.pressed('mute')) this.hud.flash(this.audio.toggleMute() ? 'Sonido: OFF' : 'Sonido: ON');
    if (a.pressed('respawn')) this.respawn(true);
  }

  /** Back to the Plaza Mayor spawn (out of any vehicle). */
  private respawn(announce: boolean): void {
    const s = this.config.game.player.spawn;
    const y = this.world.heightAt(s.x, s.z);
    if (this.player.vehicle) this.player.exitVehicle(s.x, s.z, y, s.facing);
    else this.player.spawn(s.x, s.z, y, s.facing);
    if (!announce) return;
    this.followCam.yaw = 0;
    this.events.emit('player:respawned', { x: s.x, z: s.z });
    this.hud.flash('Plaza Mayor');
  }
}

import * as THREE from 'three';
import { AmbientZones } from './audio/AmbientZones';
import { AudioMix } from './audio/AudioMix';
import { GameAudio } from './audio/GameAudio';
import { RadioSystem } from './audio/Radio';
import { WeatherAudio } from './audio/WeatherAudio';
import { FollowCamera } from './camera/FollowCamera';
import type { Config } from './config/Config';
import { EventBus } from './core/EventBus';
import type { GameEvents } from './core/events';
import { FixedStepLoop } from './core/FixedStepLoop';
import { PedestrianSystem } from './entities/PedestrianSystem';
import { Player } from './entities/Player';
import { SkidMarks } from './entities/SkidMarks';
import { PARKED, Vehicle } from './entities/Vehicle';
import { setHeadlights } from './entities/VehicleModels';
import { InputActions } from './input/InputActions';
import { RawInput } from './input/RawInput';
import { Layer } from './physics/PhysicsWorld';
import { RapierPhysics } from './physics/RapierPhysics';
import { Pipeline } from './render/Pipeline';
import { Locomotion } from './systems/Locomotion';
import { VehicleInteraction } from './systems/VehicleInteraction';
import { HUD } from './ui/HUD';
import { Minimap } from './ui/Minimap';
import { PositionReport, reportText } from './ui/PositionReport';
import { RadioPanel } from './ui/RadioPanel';
import { TouchControls } from './ui/TouchControls';
import { ClimateSystem, WEATHER_LABEL, WEATHERS, type Weather } from './world/Climate';
import type { MapData } from './world/mapData';
import { RainFX } from './world/RainFX';
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
  /** P: where am I (for reporting a detail to fix). */
  private readonly where = new PositionReport(document.getElementById('hud') ?? document.body);
  readonly pipeline: Pipeline;
  readonly quality: Config['quality']['desktop'];
  private readonly loop: FixedStepLoop;
  readonly locomotion: Locomotion;
  readonly interaction: VehicleInteraction;
  private readonly skids: SkidMarks;
  private readonly hud = new HUD();
  private readonly minimap: Minimap;
  private readonly audio = new GameAudio();
  /** Car radio (GTA IV style): on when the player is in a vehicle. */
  readonly radio = new RadioSystem(new RadioPanel(document.getElementById('hud') ?? document.body));
  private wasDriving = false;
  private lastSteps = 0;
  /** Sounds configuration (public/config/audio.json), once loaded. */
  audioConf: { menu?: { music: string; volume?: number }; voices?: Record<string, string[] | string> } | null = null;
  /** Townspeople (global: `__game.pedestrians.panicAt(x, z, r)`). */
  pedestrians: PedestrianSystem | null = null;
  /** Time of day and weather (global: `__game.climate`). */
  readonly climate: ClimateSystem;
  private readonly rain: RainFX;
  private ambient: AmbientZones | null = null;
  private weatherAudio: WeatherAudio | null = null;
  /** Overall level of the world's ambience (0 in the menu, fading in with the world). */
  ambienceGain = 0;

  /** Time of day in hours (kept for tests and the console; see climate). */
  get hours(): number {
    return this.climate.hours;
  }

  set hours(h: number) {
    this.climate.setTime(h);
  }
  /** Game minutes per real second. */
  timeScale = 1;
  private readonly headlamp = new THREE.SpotLight('#fff1d6', 0, 50, 0.6, 0.55, 1.3);
  private readonly touch: TouchControls | null;
  private last = -1;
  private time = 0;
  private running = false;
  /**
   * menu: the live town behind the main menu, filmed by a slow crane shot;
   * intro: the arrival (the camera descends to the player, no control yet);
   * play: the player has control.
   */
  mode: 'menu' | 'intro' | 'play' = 'menu';
  /** Arrival shot progress 0–1 (set by the ArrivalSequence while mode is 'intro'). */
  arrival = 0;
  private menuTime = 0;
  private readonly arrivalFrom = new THREE.Vector3();
  private readonly arrivalLook = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();

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
    // Clock from the local time (or ?hora=21.5&clima=lluvia in the URL, for testing).
    const q = new URLSearchParams(location.search);
    const now = new Date();
    const hourParam = Number.parseFloat(q.get('hora') ?? '');
    const weatherParam = q.get('clima') as Weather | null;
    this.climate = new ClimateSystem(this.world.env, {
      dayMinutes: AudioMix.settings.dayMinutes,
      hours: Number.isFinite(hourParam) ? hourParam : now.getHours() + now.getMinutes() / 60,
      weather: weatherParam && WEATHERS.includes(weatherParam) ? weatherParam : 'despejado',
      dynamic: !weatherParam,
    });
    AudioMix.onChange(() => {
      this.climate.dayMinutes = AudioMix.settings.dayMinutes;
    });
    this.rain = new RainFX(this.scene, (x, z) => this.world.heightAt(x, z), isTouch ? 2500 : 7000);
    this.rain.collectWetMaterials(this.scene);
    void fetch('config/audio.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((conf) => {
        if (!conf) return;
        this.ambient = new AmbientZones(conf.zones ?? [], { riverDistance: (x, z) => this.world.terrain.riverDistance(x, z).d });
        this.weatherAudio = new WeatherAudio(conf.weather ?? {});
        this.audioConf = conf;
        this.pedestrians?.setVoices(conf.voices);
      })
      .catch(() => undefined);
    this.skids = new SkidMarks(this.scene);
    this.followCam = new FollowCamera(this.camera);
    this.minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, map);
    this.loop = new FixedStepLoop(config.game.simulation.fixedStep, config.game.simulation.maxSubSteps);

    this.spawnVehicles();
    this.scene.add(this.player.root);
    this.scene.add(this.headlamp, this.headlamp.target);
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
    // Straight into the world (tests, or skipping the arrival): no menu, HUD on.
    const menu = document.getElementById('menu');
    if (menu) menu.hidden = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.getElementById('hud')?.classList.remove('hud-hidden');
    this.mode = 'play';
    this.ambienceGain = 1;
    this.running = true;
    this.locomotion.enabled = true;
    this.audio.init();
    this.radio.init();
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

  /** The menu's backdrop at a given hour (the real clock is set when entering). */
  menuPreview(hours: number): void {
    this.mode = 'menu';
    this.hours = hours;
  }

  /** Audio unlock (from the menu's click), without taking control yet. */
  unlockAudio(): void {
    this.audio.init();
    this.radio.init();
    AudioMix.unlock();
  }

  /**
   * In the dark between the menu and the world: the player at the spawn,
   * the follow camera settled behind them, and the arrival shot's start high
   * above (it descends to the play camera while mode is 'intro').
   */
  prepareArrival(): void {
    this.respawn(false);
    const s = this.config.game.player.spawn;
    this.followCam.yaw = s.facing + Math.PI;
    this.followCam.pitch = 0.3;
    this.mode = 'intro';
    this.arrival = 0;
    for (let i = 0; i < 30; i++) this.update(1 / 60);
    const p = this.player.pos;
    // Start high above and a little behind, looking down on the plaza.
    const back = this.tmpV.set(Math.sin(this.followCam.yaw), 0, Math.cos(this.followCam.yaw));
    this.arrivalFrom.set(p.x + back.x * 38, p.y + 46, p.z + back.z * 38);
    this.arrivalLook.set(p.x - back.x * 30, p.y, p.z - back.z * 30);
  }

  /**
   * Behind the main menu: a slow crane shot drifting round the Plaza Mayor
   * and the Ayuntamiento, low over the square, as in a film's opening.
   */
  private menuShot(dt: number): void {
    this.menuTime += dt;
    const t = this.menuTime * 0.035;
    const cx = -6,
      cz = 4;
    const r = 34 + Math.sin(t * 0.7) * 6;
    const x = cx + Math.cos(t) * r,
      z = cz + Math.sin(t) * r;
    const cam = this.camera;
    cam.position.set(x, this.world.heightAt(x, z) + 9 + Math.sin(t * 1.3) * 2.5, z);
    cam.lookAt(cx + Math.cos(t + 1.9) * 8, this.world.heightAt(cx, cz) + 6, cz + Math.sin(t + 1.9) * 8);
    if (cam.fov !== 50) {
      cam.fov = 50;
      cam.updateProjectionMatrix();
    }
  }

  /** The arrival: from high above down to the follow camera behind the player, easing in and out. */
  private arrivalShot(): void {
    const k = this.arrival;
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    const cam = this.camera;
    const target = this.tmpV.copy(cam.position);
    cam.position.lerpVectors(this.arrivalFrom, target, e);
    // Look from the plaza ahead towards the player as the camera settles.
    const look = new THREE.Vector3(this.player.pos.x, this.player.pos.y + 1.4, this.player.pos.z);
    look.lerpVectors(this.arrivalLook, look, Math.min(1, e * 1.15));
    cam.lookAt(look);
    cam.fov = 50 + (62 - 50) * e;
    cam.updateProjectionMatrix();
  }

  /** End of the arrival: control to the player. */
  takeControl(lockPointer: boolean): void {
    this.mode = 'play';
    this.running = true;
    this.locomotion.enabled = true;
    if (lockPointer && !this.touch) this.input.requestLock();
  }

  private spawnVehicles(): void {
    for (const s of this.config.game.vehicles) {
      const spec = this.config.vehicles[s.type];
      const p = this.freeSpot(this.world.roadSpawn(s.near.x, s.near.z, s.mainRoad), spec.length, spec.width);
      const v = new Vehicle(spec, s.color, p.x, p.z, p.heading);
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

  /** Slides a spawn point along its street until the car fits (no lamp post or wall in the way). */
  private freeSpot(p: { x: number; z: number; heading: number }, length: number, width: number): { x: number; z: number; heading: number } {
    const fx = Math.sin(p.heading),
      fz = Math.cos(p.heading);
    const fits = (x: number, z: number) => {
      const y = this.world.heightAt(x, z);
      for (const o of [-length / 2 + width / 2, 0, length / 2 - width / 2]) {
        if (this.physics.capsuleBlocked(x + fx * o, y, z + fz * o, width / 2 + 0.3, 1.4, Layer.Vehicle)) return false;
      }
      return true;
    };
    for (let d = 0; d <= 40; d += 2) {
      for (const sgn of d === 0 ? [1] : [1, -1]) {
        const x = p.x + fx * d * sgn,
          z = p.z + fz * d * sgn;
        if (fits(x, z)) return { x, z, heading: p.heading };
      }
    }
    return p;
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

    // Mouse movement is dropped (not saved up) while the player has no control.
    const moved = this.input.consumeMouse();
    const mouse = this.running ? moved : { dx: 0, dy: 0 };
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
    if (this.mode === 'menu') this.menuShot(dt);
    else if (this.mode === 'intro') this.arrivalShot();

    // The menu holds its dusk; the clock runs once in the world.
    this.world.wetness = this.climate.wetness;
    this.climate.update(this.mode === 'menu' ? 0 : dt * this.timeScale, this.camera.position);
    const sky = { night: this.climate.lightsOn };
    // Slightly more exposure at night, so the lamp-lit streets stay readable.
    this.renderer.toneMappingExposure = 0.65 + this.climate.night * 0.35 - this.climate.params.cloud * 0.04;
    this.world.updateNightLights(this.camera.position, sky.night);
    setHeadlights(sky.night);
    this.rain.update(dt, this.camera.position, this.climate.params.rain, this.climate.wetness, 1 + this.climate.params.storm);
    const inCar = !!this.player.vehicle;
    this.ambient?.update(dt, this.camera.position.x, this.camera.position.z, this.climate.night, this.ambienceGain * (inCar ? 0.35 : 1));
    this.weatherAudio?.update(dt, this.climate, this.ambienceGain, inCar);
    {
      const car = this.player.vehicle;
      if (car && sky.night > 0.05) {
        const fx = Math.sin(car.heading),
          fz = Math.cos(car.heading);
        this.headlamp.position.set(car.x + fx * 2.3, car.y + 0.8, car.z + fz * 2.3);
        this.headlamp.target.position.set(car.x + fx * 16, car.y - 0.5, car.z + fz * 16);
        this.headlamp.intensity = 90 * sky.night;
      } else this.headlamp.intensity = 0;
      this.headlamp.visible = this.headlamp.intensity > 0;
    }
    this.world.update(dt, this.time, this.player.pos, this.camera);
    this.world.breakables.update(dt, this.vehicles);
    this.world.parkedCars.update(dt, this.vehicles);
    if (!this.pedestrians) {
      this.pedestrians = new PedestrianSystem(this.world, this.scene, this.touch ? 70 : 160, this.touch ? 14 : 36);
      this.pedestrians.setVoices(this.audioConf?.voices);
    }
    this.pedestrians.update(dt, this.camera.position, this.followCam.yaw, this.climate.lightsOn, this.vehicles);
    this.world.screens.update(
      dt,
      this.renderer,
      this.scene,
      this.camera.position,
      this.player.pos,
      v ? v.heading : this.player.facing,
      v ? Math.abs(v.speed) * 3.6 : 0,
      this.world.zoneAt(this.player.pos.x, this.player.pos.z),
    );
    this.audio.update(v);
    // Footsteps on whatever the player walks on.
    if (!v && this.player.steps !== this.lastSteps) {
      this.lastSteps = this.player.steps;
      const st = this.player.state;
      if (st === 'walk' || st === 'run' || st === 'wade')
        this.audio.footstep(st === 'wade' ? 'water' : this.world.surfaceAt(this.player.pos.x, this.player.pos.z), st === 'run');
    }
    if (!!v !== this.wasDriving) {
      this.wasDriving = !!v;
      document.body.classList.toggle('radio-on', !!v);
      if (v) this.radio.enterVehicle();
      else this.radio.exitVehicle();
    }

    const zone = this.world.zoneAt(this.player.pos.x, this.player.pos.z);
    const near = this.interaction.nearest();
    const action = this.touch ? 'Toca <b>ROBAR</b>' : 'Pulsa <b>F</b> / <b>E</b> para robar';
    const prompt = near ? `${action}: <b>${near.spec.label}</b>` : null;
    this.touch?.setDriving(!!v);
    this.hud.update(dt, zone, this.player.state, v, prompt, this.input.locked || !this.running || !!this.touch, this.hours);
    this.minimap.draw(this.player.pos.x, this.player.pos.z, this.player.facing, this.followCam.yaw, this.vehicles, v);
    this.input.endFrame();
  }

  private handleActions(): void {
    const a = this.actions;
    if (a.pressed('use')) this.interaction.toggle();
    if (a.pressed('help')) this.hud.toggleHelp();
    if (a.pressed('mute')) {
      const muted = this.audio.toggleMute();
      this.radio.setMuted(muted);
      this.hud.flash(muted ? 'Sonido: OFF' : 'Sonido: ON');
    }
    if (a.pressed('timeSkip')) {
      this.hours = (Math.floor(this.hours) + 1) % 24;
      this.hud.flash(`${String(Math.floor(this.hours)).padStart(2, '0')}:00`);
    }
    if (a.pressed('report')) {
      const v = this.player.vehicle;
      // The camera looks back at the player: the view direction is towards the player.
      const lx = this.player.pos.x - this.camera.position.x,
        lz = this.player.pos.z - this.camera.position.z;
      this.where.show(
        reportText({
          x: this.player.pos.x,
          z: this.player.pos.z,
          lookX: lx,
          lookZ: lz,
          vehicle: v ? v.spec.label : null,
          zone: this.world.zoneAt(this.player.pos.x, this.player.pos.z) || 'Villarcayo',
          hours: this.hours,
          weather: WEATHER_LABEL[this.climate.weather],
          origin: this.world.map.meta.utmOrigin ?? { E: 453356, N: 4754203 },
        }),
      );
    }
    if (a.pressed('weatherNext')) this.hud.flash(WEATHER_LABEL[this.climate.cycleWeather()]);
    if (a.pressed('radioPower')) this.radio.togglePower();
    if (a.pressed('radioNext')) this.radio.next();
    if (a.pressed('radioPrev')) this.radio.prev();
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

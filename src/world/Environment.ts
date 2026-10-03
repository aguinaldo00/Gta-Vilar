import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { Rng } from '../core/math';
import type { Quality } from './World';

/** Late-afternoon sun from the south-west: long, warm shadows. */
const SUN_DIR = new THREE.Vector3(-0.55, 0.42, 0.62).normalize();
/** Atmospheric haze colour shared by the fog, the far mountains and the horizon. */
export const HAZE = new THREE.Color('#c9d3d8');

/**
 * Sky, light and the far landscape.
 *
 * - A physically based sky (Preetham scattering + procedural clouds) and a
 *   ring of hazy mountains live in a separate background scene drawn with
 *   its own far plane, so the horizon is kilometres away while the town keeps
 *   a short, cheap draw distance.
 * - The same sky is baked into an environment map (PMREM) that lights every
 *   PBR material, so shade colours come from the sky like in the references.
 * - A warm low sun casts camera-following shadows.
 */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly bgScene = new THREE.Scene();
  readonly bgCamera = new THREE.PerspectiveCamera(60, 1, 10, 30000);
  private readonly sky: Sky;
  private readonly shadowSpan: number;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, rng: Rng, quality: Quality) {
    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.3;
    u.mieCoefficient.value = 0.0022;
    u.mieDirectionalG.value = 0.78;
    u.sunPosition.value.copy(SUN_DIR).multiplyScalar(1000);
    if (u.cloudCoverage) {
      u.cloudCoverage.value = 0.45;
      u.cloudDensity.value = 0.55;
      u.cloudScale.value = 0.00025;
    }
    // The sky shader is calibrated for exposure ~0.5; scale it to this scene's exposure.
    u.skyGain = { value: 0.25 };
    this.sky.material.fragmentShader = this.sky.material.fragmentShader
      .replace('void main() {', 'uniform float skyGain;\nvoid main() {')
      .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyGain, 1.0 );');
    this.bgScene.add(this.sky);
    this.bgScene.add(buildMountains(rng));
    // Valley floor out to the mountains, so the land never ends at the edge of the town.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14000, 48).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: '#6f8a45' }),
    );
    floor.position.y = -0.6;
    this.bgScene.add(floor);
    this.bgScene.fog = new THREE.Fog(HAZE, 600, 11000);
    this.bgScene.add(new THREE.HemisphereLight('#cfe0f0', '#6d6450', 1.2));
    const farSun = new THREE.DirectionalLight('#ffe2b8', 2.2);
    farSun.position.copy(SUN_DIR);
    this.bgScene.add(farSun);

    // Image-based lighting from the sky (without the mountains, which would read as a dark band).
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(1000);
    envSky.material = this.sky.material;
    envScene.add(envSky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    scene.environmentIntensity = 0.35;
    pmrem.dispose();

    scene.background = null;
    scene.fog = new THREE.FogExp2(HAZE, quality.fogDensity);
    scene.add(new THREE.HemisphereLight('#cfe0f0', '#7a6a50', 0.1));

    this.sun = new THREE.DirectionalLight('#ffe0b2', 1.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.shadowSpan = quality.shadowMapSize >= 4096 ? 80 : 60;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -this.shadowSpan;
    cam.right = cam.top = this.shadowSpan;
    cam.near = 1;
    cam.far = 400;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2.5;
    scene.add(this.sun, this.sun.target);
  }

  update(time: number, focus: THREE.Vector3, camera: THREE.PerspectiveCamera): void {
    const u = this.sky.material.uniforms;
    if (u.time) u.time.value = time;
    this.bgCamera.position.copy(camera.position);
    this.bgCamera.quaternion.copy(camera.quaternion);
    if (this.bgCamera.fov !== camera.fov || this.bgCamera.aspect !== camera.aspect) {
      this.bgCamera.fov = camera.fov;
      this.bgCamera.aspect = camera.aspect;
      this.bgCamera.updateProjectionMatrix();
    }
    this.sky.position.copy(camera.position);
    // Snap the shadow frustum to texel-sized steps to avoid shimmering.
    const step = (this.shadowSpan * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / step) * step;
    const fz = Math.round(focus.z / step) * step;
    this.sun.position.set(fx + SUN_DIR.x * 200, focus.y + SUN_DIR.y * 200, fz + SUN_DIR.z * 200);
    this.sun.target.position.set(fx, focus.y, fz);
  }
}

/**
 * Ring of mountains 2.5–14 km away (Las Merindades). This is a backdrop, not
 * real elevation data: the OSM export has none.
 */
function buildMountains(rng: Rng): THREE.Mesh {
  const seg = 220,
    rings = 18;
  const r0 = 2600,
    r1 = 14000;
  const pos: number[] = [],
    col: number[] = [],
    idx: number[] = [];
  const phase = Array.from({ length: 6 }, () => rng.range(0, Math.PI * 2));
  const low = new THREE.Color('#71805a'),
    mid = new THREE.Color('#828569'),
    rock = new THREE.Color('#a39d8e');
  const c = new THREE.Color();
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const r = r0 + (r1 - r0) * t * t;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ridge =
        Math.abs(Math.sin(a * 3 + phase[0] + t * 2)) * 0.5 +
        Math.abs(Math.sin(a * 7 + phase[1] + t * 4)) * 0.3 +
        Math.abs(Math.sin(a * 17 + phase[2])) * 0.12 +
        Math.sin(a * 29 + phase[3] + t * 9) * 0.06;
      const envelope = Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5);
      const h = (120 + ridge * (380 + 520 * t)) * envelope - 40;
      pos.push(Math.cos(a) * r, h, Math.sin(a) * r);
      c.copy(low)
        .lerp(mid, Math.min(1, h / 350))
        .lerp(rock, Math.max(0, Math.min(1, (h - 420) / 300)));
      col.push(c.r, c.g, c.b);
      if (i < seg && j < rings) {
        const k = j * (seg + 1) + i;
        idx.push(k, k + seg + 1, k + 1, k + 1, k + seg + 1, k + seg + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide }),
  );
  m.frustumCulled = false;
  return m;
}

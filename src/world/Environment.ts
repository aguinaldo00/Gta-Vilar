import * as THREE from 'three';
import type { Rng } from '../core/math';

export const SKY_TOP = new THREE.Color('#2f6fd0');
export const SKY_HORIZON = new THREE.Color('#bcd6f2');
const SUN_DIR = new THREE.Vector3(0.55, 0.75, 0.35).normalize();

/** Sky dome, sun with a camera-following shadow frustum, distant mountains and drifting clouds. */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly clouds: THREE.Group;

  constructor(scene: THREE.Scene, rng: Rng) {
    scene.background = SKY_HORIZON.clone();
    scene.fog = new THREE.Fog(SKY_HORIZON.clone(), 160, 560);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1100, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: SKY_TOP },
          horizon: { value: SKY_HORIZON },
          sunDir: { value: SUN_DIR },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top;
          uniform vec3 horizon;
          uniform vec3 sunDir;
          varying vec3 vDir;
          void main() {
            float h = max(vDir.y, 0.0);
            vec3 col = mix(horizon, top, pow(h, 0.5));
            float sun = max(dot(normalize(vDir), sunDir), 0.0);
            col += vec3(1.0, 0.92, 0.75) * (pow(sun, 400.0) * 1.5 + pow(sun, 12.0) * 0.18);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    scene.add(sky);

    scene.add(new THREE.HemisphereLight('#cfe3ff', '#7a6a4a', 1.5));
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -70;
    cam.right = cam.top = 70;
    cam.near = 1;
    cam.far = 320;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);

    // Las Merindades: low mountains all around the valley.
    const mountainMats = ['#6c7f63', '#7d8a6c', '#5f735e', '#8a8f78'].map((c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rng.range(-0.05, 0.05);
      const r = rng.range(330, 470);
      const h = rng.range(35, 95);
      const m = new THREE.Mesh(new THREE.ConeGeometry(rng.range(60, 120), h, 7, 1), rng.pick(mountainMats));
      m.position.set(Math.sin(a) * r, h / 2 - 4, Math.cos(a) * r);
      m.rotation.y = rng.range(0, 3);
      scene.add(m);
    }

    this.clouds = new THREE.Group();
    const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#c9d8ee', emissiveIntensity: 0.55, flatShading: true });
    const blob = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 18; i++) {
      const c = new THREE.Group();
      for (let j = 0; j < 5; j++) {
        const s = rng.range(10, 22);
        const m = new THREE.Mesh(blob, cloudMat);
        m.scale.set(s * 1.6, s * 0.5, s);
        m.position.set(rng.range(-25, 25), rng.range(-3, 3), rng.range(-12, 12));
        c.add(m);
      }
      c.position.set(rng.range(-600, 600), rng.range(140, 190), rng.range(-600, 600));
      this.clouds.add(c);
    }
    scene.add(this.clouds);
  }

  update(dt: number, focus: THREE.Vector3): void {
    // Snap the shadow frustum to texel-sized steps to avoid shimmering.
    const step = 140 / 2048;
    const fx = Math.round(focus.x / step) * step;
    const fz = Math.round(focus.z / step) * step;
    this.sun.position.set(fx + SUN_DIR.x * 150, SUN_DIR.y * 150, fz + SUN_DIR.z * 150);
    this.sun.target.position.set(fx, 0, fz);
    for (const c of this.clouds.children) {
      c.position.x += dt * 3;
      if (c.position.x > 650) c.position.x = -650;
    }
  }
}

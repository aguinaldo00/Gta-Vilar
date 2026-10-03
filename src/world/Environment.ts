import * as THREE from 'three';
import type { Rng } from '../core/math';
import type { Quality } from './World';

export const SKY_TOP = new THREE.Color('#2f6fd0');
export const SKY_HORIZON = new THREE.Color('#bcd6f2');
const SUN_DIR = new THREE.Vector3(0.55, 0.75, 0.35).normalize();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Sky dome that follows the camera (with the Merindades mountains painted on
 * its horizon, so they cost nothing and are never clipped by the far plane),
 * sun with a camera-following shadow frustum, and drifting clouds.
 */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly sky: THREE.Mesh;
  private readonly clouds: THREE.InstancedMesh;
  private readonly cloudPos: THREE.Vector3[] = [];
  private readonly blobs: { cloud: number; offset: THREE.Vector3; scale: THREE.Vector3 }[] = [];

  constructor(scene: THREE.Scene, rng: Rng, quality: Quality) {
    scene.background = SKY_HORIZON.clone();
    scene.fog = new THREE.Fog(SKY_HORIZON.clone(), quality.fogNear, quality.fogFar);
    const radius = quality.fogFar * 0.9;

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 48, 24),
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
          float ridge(float a, float f, float s) { return sin(a * f + s) * 0.5 + 0.5; }
          void main() {
            vec3 d = normalize(vDir);
            float h = max(d.y, 0.0);
            vec3 col = mix(horizon, top, pow(h, 0.5));
            float sun = max(dot(d, sunDir), 0.0);
            col += vec3(1.0, 0.92, 0.75) * (pow(sun, 400.0) * 1.5 + pow(sun, 12.0) * 0.18);
            // Two layers of low mountains around the valley.
            float az = atan(d.z, d.x);
            float far = 0.035 + 0.03 * ridge(az, 3.0, 1.0) + 0.02 * ridge(az, 7.0, 2.0) + 0.008 * ridge(az, 19.0, 0.5);
            float near = 0.018 + 0.02 * ridge(az, 5.0, 4.0) + 0.012 * ridge(az, 11.0, 1.3) + 0.005 * ridge(az, 31.0, 2.2);
            if (d.y < far) col = mix(col, vec3(0.52, 0.62, 0.66), 0.85);
            if (d.y < near) col = mix(col, vec3(0.38, 0.48, 0.38), 0.9);
            if (d.y < 0.0) col = vec3(0.38, 0.48, 0.38);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    scene.add(new THREE.HemisphereLight('#cfe3ff', '#7a6a4a', 1.5));
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -70;
    cam.right = cam.top = 70;
    cam.near = 1;
    cam.far = 320;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);

    // All clouds in one InstancedMesh (one draw call): 16 clouds x 5 blobs.
    const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#c9d8ee', emissiveIntensity: 0.55, flatShading: true, fog: false });
    for (let i = 0; i < 16; i++) {
      this.cloudPos.push(new THREE.Vector3(rng.range(-radius, radius) * 0.8, rng.range(140, 180), rng.range(-radius, radius) * 0.8));
      for (let j = 0; j < 5; j++) {
        const s = rng.range(10, 22);
        this.blobs.push({ cloud: i, offset: new THREE.Vector3(rng.range(-25, 25), rng.range(-3, 3), rng.range(-12, 12)), scale: new THREE.Vector3(s * 1.6, s * 0.5, s) });
      }
    }
    this.clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), cloudMat, this.blobs.length);
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera): void {
    this.sky.position.copy(camera.position);
    this.clouds.position.set(camera.position.x, 0, camera.position.z);
    const lim = (this.sky.geometry as THREE.SphereGeometry).parameters.radius * 0.8;
    for (const c of this.cloudPos) {
      c.x += dt * 3;
      if (c.x > lim) c.x = -lim;
    }
    this.blobs.forEach((b, i) => {
      _m.compose(_v.copy(this.cloudPos[b.cloud]).add(b.offset), _q, b.scale);
      this.clouds.setMatrixAt(i, _m);
    });
    this.clouds.instanceMatrix.needsUpdate = true;
    // Snap the shadow frustum to texel-sized steps to avoid shimmering.
    const step = 140 / 2048;
    const fx = Math.round(focus.x / step) * step;
    const fz = Math.round(focus.z / step) * step;
    this.sun.position.set(fx + SUN_DIR.x * 150, focus.y + SUN_DIR.y * 150, fz + SUN_DIR.z * 150);
    this.sun.target.position.set(fx, focus.y, fz);
  }
}

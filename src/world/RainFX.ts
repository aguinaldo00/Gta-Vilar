import * as THREE from 'three';

const BOX = 46;
const HEIGHT = 26;

/**
 * Rain around the camera: streaks falling in a box that follows the view
 * (moved in the vertex shader, so thousands of drops cost nothing on the
 * CPU), splashes rippling on the ground in heavy rain, and the wet look of
 * the town (darker, glossier surfaces that reflect the sky).
 */
export class RainFX {
  private readonly streaks: THREE.LineSegments;
  private readonly mat: THREE.ShaderMaterial;
  private readonly splashes: THREE.InstancedMesh;
  private readonly splashAge: Float32Array;
  private readonly splashPos: Float32Array;
  private readonly m = new THREE.Matrix4();
  private readonly wetMats: { m: THREE.MeshStandardMaterial; rough: number; color: THREE.Color }[] = [];
  private lastWet = -1;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private readonly heightAt: (x: number, z: number) => number,
    drops: number,
  ) {
    const pos = new Float32Array(drops * 6);
    const seed = new Float32Array(drops * 2);
    for (let i = 0; i < drops; i++) {
      const x = Math.random() * BOX,
        y = Math.random() * HEIGHT,
        z = Math.random() * BOX;
      pos.set([x, y, z, x, y, z], i * 6);
      const r = Math.random();
      seed.set([r, r], i * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    // Second vertex of each pair is the tail of the streak.
    const tail = new Float32Array(drops * 2);
    for (let i = 0; i < drops; i++) tail[i * 2 + 1] = 1;
    g.setAttribute('tail', new THREE.BufferAttribute(tail, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uAmount: { value: 0 },
        uWind: { value: new THREE.Vector2(1.2, 0.6) },
        uColor: { value: new THREE.Color('#c7d3dd') },
      },
      vertexShader: /* glsl */ `
        attribute float seed; attribute float tail;
        uniform float uTime; uniform vec3 uCam; uniform float uAmount; uniform vec2 uWind;
        varying float vA;
        void main() {
          vec3 p = position;
          float speed = 11.0 + seed * 4.0;
          // Fall, wrapped in a box that follows the camera.
          vec3 base = uCam - vec3(${(BOX / 2).toFixed(1)}, ${(HEIGHT * 0.35).toFixed(1)}, ${(BOX / 2).toFixed(1)});
          vec3 w;
          w.xz = base.xz + mod(p.xz - base.xz, ${BOX.toFixed(1)});
          w.y = base.y + mod(p.y - uTime * speed - base.y, ${HEIGHT.toFixed(1)});
          w.xz += uWind * (w.y - base.y) * 0.04;
          // Streak length along the fall (and the wind).
          w += tail * vec3(uWind.x * 0.05, 0.55 + seed * 0.3, uWind.y * 0.05);
          // Only a share of the drops at light rain.
          vA = step(seed, uAmount) * (0.35 + 0.4 * tail);
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main() { if (vA < 0.01) discard; gl_FragColor = vec4(uColor, vA * 0.45); }`,
    });
    this.streaks = new THREE.LineSegments(g, this.mat);
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    this.streaks.renderOrder = 10;
    scene.add(this.streaks);

    // Splash rings on the ground (heavy rain).
    const n = 260;
    const ring = new THREE.RingGeometry(0.03, 0.09, 10).rotateX(-Math.PI / 2);
    const smat = new THREE.MeshBasicMaterial({ color: '#dfe7ee', transparent: true, opacity: 0.55, depthWrite: false });
    this.splashes = new THREE.InstancedMesh(ring, smat, n);
    this.splashes.frustumCulled = false;
    this.splashes.visible = false;
    this.splashAge = new Float32Array(n).map(() => Math.random());
    this.splashPos = new Float32Array(n * 3);
    scene.add(this.splashes);
  }

  /** Collects the town's materials once (after the world is built) for the wet look. */
  collectWetMaterials(scene: THREE.Scene): void {
    const seen = new Set<THREE.Material>();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh === (this.splashes as unknown)) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const sm = m as THREE.MeshStandardMaterial;
        if (!sm || seen.has(sm) || !sm.isMeshStandardMaterial || sm.transparent) continue;
        seen.add(sm);
        this.wetMats.push({ m: sm, rough: sm.roughness, color: sm.color.clone() });
      }
    });
  }

  /**
   * Drops and splashes are switched off until the realistic rain is made (a
   * screen-space / volumetric pass in the spirit of Cyberpunk): this is the
   * hook it plugs into. The weather state, wet ground and sound already work.
   */
  static particles = false;

  update(dt: number, camera: THREE.Vector3, rain: number, wetness: number, wind = 1): void {
    this.time += dt;
    if (!RainFX.particles) rain = Math.min(rain, 0);
    const on = rain > 0.01;
    this.streaks.visible = on;
    if (on) {
      this.mat.uniforms.uTime.value = this.time;
      this.mat.uniforms.uCam.value.copy(camera);
      this.mat.uniforms.uAmount.value = 0.15 + rain * 0.85;
      this.mat.uniforms.uWind.value.set(1.2 * wind, 0.6 * wind);
    }
    // Splashes in heavy rain, around the camera.
    const heavy = Math.max(0, rain - 0.4) / 0.6;
    this.splashes.visible = heavy > 0.02;
    if (this.splashes.visible) {
      const n = this.splashAge.length;
      for (let i = 0; i < n; i++) {
        this.splashAge[i] += dt * (2.2 + (i % 5) * 0.2);
        if (this.splashAge[i] >= 1) {
          this.splashAge[i] = 0;
          const a = Math.random() * Math.PI * 2,
            r = 1 + Math.sqrt(Math.random()) * 16;
          const x = camera.x + Math.cos(a) * r,
            z = camera.z + Math.sin(a) * r;
          this.splashPos.set([x, this.heightAt(x, z) + 0.04, z], i * 3);
        }
        const k = this.splashAge[i];
        const s = i / n < heavy ? 0.4 + k * 2.2 : 0;
        this.m.makeScale(s, 1, s).setPosition(this.splashPos[i * 3], this.splashPos[i * 3 + 1], this.splashPos[i * 3 + 2]);
        this.splashes.setMatrixAt(i, this.m);
      }
      this.splashes.instanceMatrix.needsUpdate = true;
      (this.splashes.material as THREE.MeshBasicMaterial).opacity = 0.5 * heavy;
    }
    // Wet surfaces: darker and glossier (they pick up the sky in the reflections).
    if (Math.abs(wetness - this.lastWet) > 0.01) {
      this.lastWet = wetness;
      for (const w of this.wetMats) {
        w.m.roughness = w.rough * (1 - wetness * 0.55);
        w.m.color.copy(w.color).multiplyScalar(1 - wetness * 0.28);
      }
    }
  }
}

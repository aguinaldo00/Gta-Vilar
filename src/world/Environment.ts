import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { Rng } from '../core/math';
import { mixColor, NIGHT, type SunState, sunState } from './DayNight';
import type { MapData } from './mapData';
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
  private readonly floor: THREE.Mesh;
  readonly bgCamera = new THREE.PerspectiveCamera(60, 1, 10, 30000);
  private readonly sky: Sky;
  private readonly shadowSpan: number;
  private readonly scene: THREE.Scene;
  private readonly hemi: THREE.HemisphereLight;
  private readonly bgHemi: THREE.HemisphereLight;
  private readonly farSun: THREE.DirectionalLight;
  private readonly stars: THREE.Points;
  /** Direction the shadow-casting light comes from (the sun by day, the moon at night). */
  private readonly lightDir = SUN_DIR.clone();
  /** Current time of day (see setTime). */
  state: SunState = sunState(17.5);

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, rng: Rng, quality: Quality, map?: MapData) {
    this.scene = scene;
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
    // The sky adds over a twilight backdrop (blue hour after sunset, night blue).
    this.sky.material.blending = THREE.AdditiveBlending;
    this.sky.material.depthWrite = false;
    this.bgScene.background = new THREE.Color('#000000');
    this.bgScene.add(this.sky);
    const real = map ? buildSurroundings(map, quality.detail === 1 ? 4 : 8, quality) : null;
    // The real hills of Las Merindades when the map has them; a stylised ring of mountains otherwise.
    this.bgScene.add(real ?? buildMountains(rng));
    // Valley floor out to the mountains, so the land never ends at the edge of the town.
    const floor = (this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(14000, 48).rotateX(-Math.PI / 2),
      // Far enough to be mostly haze: matches the town ground fading into the fog at the draw distance.
      new THREE.MeshBasicMaterial({ color: '#a9b4a6', fog: false }),
    ));
    floor.position.y = -0.6;
    if (!real) this.bgScene.add(floor);
    this.bgScene.fog = new THREE.Fog(HAZE, 600, 11000);
    this.bgHemi = new THREE.HemisphereLight('#cfe0f0', '#6d6450', 1.2);
    this.bgScene.add(this.bgHemi);
    const farSun = (this.farSun = new THREE.DirectionalLight('#ffe2b8', 2.2));
    farSun.position.copy(SUN_DIR);
    this.bgScene.add(farSun);
    this.stars = buildStars(rng);
    this.bgScene.add(this.stars);

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
    this.hemi = new THREE.HemisphereLight('#cfe0f0', '#7a6a50', 0.1);
    scene.add(this.hemi);

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

  /**
   * Lighting for a clock time (hours): sun or moon direction and colour, sky,
   * haze, ambient light, stars; NIGHT drives the lamps and lit windows.
   * Returns the state so the game can light lamps and headlights.
   */
  setTime(hours: number): SunState {
    const st = (this.state = sunState(hours));
    const { day, golden, night } = st;
    const u = this.sky.material.uniforms;
    // The sky follows the real sun (it darkens by itself below the horizon).
    // Below the horizon the scattering model goes black at once: hold its sun at the horizon
    // and dim it with the night instead, for a blue-and-amber twilight.
    u.sunPosition.value.copy(st.sun).setY(Math.max(st.sun.y, 0.005)).normalize().multiplyScalar(1000);
    u.turbidity.value = 4 + golden * 6;
    u.rayleigh.value = 1.3 + golden * 1.2;
    // Keep the sky bright through the golden hour: the low sun paints it orange by itself.
    u.skyGain.value = 0.25 * (0.04 + 0.96 * Math.max(day, golden * 1.1, 1 - night)) * (1 - 0.9 * night);
    // Shadows from the sun by day and from the moon at night.
    this.lightDir.copy(st.elevation > -0.02 ? st.sun : st.moon);
    if (this.lightDir.y < 0.12) this.lightDir.setY(0.12).normalize();
    const sunCol = mixColor('#ff8a3c', '#fff1dc', (st.elevation - 0.02) / 0.4);
    const moonCol = new THREE.Color('#8ea6d8');
    this.sun.color.copy(sunCol).lerp(moonCol, night);
    this.sun.intensity = 2.1 * day + 0.32 * night;
    this.farSun.color.copy(this.sun.color);
    this.farSun.intensity = 2.2 * day + 0.25 * night;
    this.farSun.position.copy(this.lightDir);
    // Ambient: sky light by day, a dim blue at night.
    this.hemi.color.copy(mixColor('#cfe0f0', '#ffcfa0', golden)).lerp(new THREE.Color('#41557d'), night);
    this.hemi.intensity = 0.1 + night * 0.35;
    this.bgHemi.color.copy(this.hemi.color);
    this.bgHemi.intensity = 1.2 * (0.12 + 0.88 * day);
    this.scene.environmentIntensity = 0.35 * (0.12 + 0.88 * day);
    // Haze: blue-grey by day, peach at sunset, deep blue at night.
    const fog = mixColor(HAZE, '#d6a483', golden).lerp(new THREE.Color('#0d1626'), night);
    (this.scene.fog as THREE.FogExp2).color.copy(fog);
    (this.bgScene.fog as THREE.Fog).color.copy(fog);
    (this.floor.material as THREE.MeshBasicMaterial).color.copy(mixColor('#a9b4a6', '#141c26', night));
    (this.stars.material as THREE.PointsMaterial).opacity = night * 0.9;
    // Blue hour: strongest half-way into the night, fading to a dark night blue.
    const twilight = Math.min(1, night * (1 - night) * 4);
    (this.bgScene.background as THREE.Color).copy(mixColor('#000000', '#0a1220', night)).lerp(new THREE.Color('#2b4a78'), twilight * 0.85);
    this.stars.visible = night > 0.02;
    NIGHT.value = night;
    return st;
  }

  /** Height of the distant valley floor (so it meets the edge of the map). */
  setFloorHeight(y: number): void {
    this.floor.position.y = y;
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
    const L = this.lightDir;
    this.sun.position.set(fx + L.x * 200, focus.y + L.y * 200, fz + L.z * 200);
    this.stars.position.copy(camera.position);
    this.sun.target.position.set(fx, focus.y, fz);
  }
}

/** A dome of stars (seen through the night sky). */
function buildStars(rng: Rng): THREE.Points {
  const n = 2500;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const y = rng.range(0.05, 1);
    const r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * r * 9000, y * 9000, Math.sin(a) * r * 9000], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({
    color: '#dfe8ff',
    size: 1.6,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    fog: false,
    depthWrite: false,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = -1;
  return p;
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

/**
 * The landscape around the playable map from the IGN MDT25 heights and a
 * PNOA orthophoto (tools/geodata/fetch_surroundings.py): the real valley and
 * hills on the horizon. Inside the map it sinks a little under the detailed
 * town ground, which is drawn on top in the main pass.
 */
function buildSurroundings(map: MapData, step: number, quality: Quality): THREE.Mesh | null {
  const s = map.meta.surroundings;
  const h = map.surroundings;
  if (!s || !h) return null;
  const B = map.meta.bounds;
  const cols = Math.floor((s.cols - 1) / step) + 1,
    rows = Math.floor((s.rows - 1) / step) + 1;
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const [ix0, iz0, ix1, iz1] = s.imageBounds;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sr = Math.min(s.rows - 1, r * step),
        sc = Math.min(s.cols - 1, c * step);
      const x = s.minX + sc * s.cell,
        z = s.minZ + sr * s.cell;
      const inside = x > B.minX - 20 && x < B.maxX + 20 && z > B.minZ - 20 && z < B.maxZ + 20;
      const k = r * cols + c;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h[sr * s.cols + sc] - (inside ? 4 : 0.5);
      pos[k * 3 + 2] = z;
      uv[k * 2] = (x - ix0) / (ix1 - ix0);
      uv[k * 2 + 1] = 1 - (z - iz0) / (iz1 - iz0);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c,
        b = a + 1,
        d = a + cols,
        e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const tex = new THREE.TextureLoader().load(new URL(s.image, map.baseUrl).href);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshLambertMaterial({ map: tex, color: '#e6e6e6' });
  // Where the town is clipped by its far plane, the landscape must carry on with
  // the same haze as the town ground, or the edge of the draw distance shows as
  // a seam. Use the town's exponential fog up to the draw distance and keep it
  // there until the long-range linear haze catches up.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.townFog = { value: new THREE.Vector2(quality.fogDensity, quality.drawDistance) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\nuniform vec2 townFog;')
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
        float townD = townFog.x * min(vFogDepth, townFog.y);
        float fogFactor = max(1.0 - exp(-townD * townD), smoothstep(fogNear, fogFar, vFogDepth));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
      #endif`,
      );
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'surroundings';
  return mesh;
}

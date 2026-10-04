import * as THREE from 'three';
import { NIGHT } from './DayNight';
import { facadeStylesTexture, N_CELLS, N_STYLES } from './facadeStyles';
import * as T from './textures';
import { waterTime } from './Water';

type Lambert = THREE.MeshStandardMaterial;

/** Storey height used for window tiling and default building heights. */
export const FLOOR_H = 3.1;

/** PBR material (rough, non-metallic by default) with shadow flags read by the batcher. */
function lambert(params: THREE.MeshStandardMaterialParameters, shadows: { cast?: boolean; receive?: boolean } = {}): Lambert {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...params });
  m.userData.castShadow = shadows.cast ?? true;
  m.userData.receiveShadow = shadows.receive ?? true;
  return m;
}

/** Shared material palette. One material == one draw call after batching. */
export class Materials {
  readonly facades: Lambert[];
  readonly stone: Lambert;
  readonly stoneTrim: Lambert;
  readonly plinth: Lambert;
  readonly paving: Lambert;
  readonly sidewalk: Lambert;
  readonly asphalt: Lambert;
  readonly marking: Lambert;
  readonly roof: Lambert;
  readonly galeria: Lambert;
  readonly glass: Lambert;
  readonly darkWood: Lambert;
  readonly wood: Lambert;
  readonly iron: Lambert;
  readonly ironGreen: Lambert;
  readonly ironwork: Lambert;
  readonly clock: Lambert;
  readonly terrain: Lambert;
  readonly dirt: Lambert;
  readonly gravel: Lambert;
  readonly rail: Lambert;
  readonly sleeper: Lambert;
  readonly corrugated: Lambert;
  readonly corrugatedRust: Lambert;
  readonly rust: Lambert;
  readonly foliage: Lambert[];
  readonly springLeaf: Lambert;
  readonly pine: Lambert;
  readonly bark: Lambert;
  readonly trunk: Lambert;
  readonly concrete: Lambert;
  readonly white: Lambert;
  readonly bronze: Lambert;
  readonly lampGlass: Lambert;
  readonly awnings: Lambert[];
  readonly fields: Lambert[];
  readonly hay: Lambert;
  readonly flowers: Lambert;
  readonly hedge: Lambert;
  readonly redPaint: Lambert;
  readonly coachGreen: Lambert;
  /** Vertex-coloured variants used by the merged town geometry. */
  readonly facadeVC: Lambert;
  readonly stoneVC: Lambert;
  readonly roofVC: Lambert;
  /** Neutral tiles tinted per roof with its real colour (vertex colour, in units of the texture's 50 % grey). */
  readonly roofTintVC: Lambert;
  readonly corrugatedVC: Lambert;
  readonly treeVC: Lambert;
  /** Leaf cards + bark (alpha-tested). `leavesWind` sways in the wind (instanced trees). */
  readonly leaves: Lambert;
  readonly leavesWind: Lambert;
  readonly leavesDepth: THREE.MeshDepthMaterial;
  /** Every plain-coloured prop material is folded into this one by the batcher. */
  readonly propsVC: Lambert;
  readonly detail: THREE.Texture;
  /** Asphalt, sidewalk, paving, dirt, gravel and paint in one material (one draw call per chunk). */
  readonly roadAtlas: Lambert;
  /** Unlit vertex-coloured material for lit signs and neon (blooms on desktop). */
  readonly glowVC = new THREE.MeshBasicMaterial({ vertexColors: true });
  private readonly tints = new Map<string, THREE.Material>();

  constructor() {
    const facade = T.facadeTexture();
    this.facades = ['#f2ede2', '#e7d6b4', '#f6f4ef', '#dcc39a', '#e9cdb8', '#d8d0c0'].map((c) => lambert({ color: c, map: facade }));

    const ashlar = T.ashlarTexture();
    const ashlarN = T.normalMapFrom(ashlar, 3);
    this.stone = lambert({ map: ashlar, normalMap: ashlarN });
    this.stoneTrim = lambert({ color: '#e6d6b0' });
    this.plinth = lambert({ map: ashlar, color: '#b8a888' });

    this.paving = lambert({ map: T.pavingTexture(), color: '#e2ddd3' }, { cast: false });
    this.sidewalk = lambert({ map: T.sidewalkTexture() }, { cast: false });
    this.asphalt = lambert({ map: T.asphaltTexture() }, { cast: false });
    this.marking = lambert({ color: '#efefe6', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, { cast: false });

    const tiles = T.roofTilesTexture();
    const tilesN = T.normalMapFrom(tiles, 4);
    this.roof = lambert({ map: tiles, normalMap: tilesN, side: THREE.DoubleSide, roughness: 0.8 });
    this.galeria = lambert({ map: T.galeriaTexture() }, { cast: false });
    this.glass = lambert({ color: '#2a3642', roughness: 0.15, metalness: 0.3 });
    this.darkWood = lambert({ color: '#4a2f1f' });
    this.wood = lambert({ map: T.woodTexture() });
    this.iron = lambert({ color: '#2b2f2e' });
    this.ironGreen = lambert({ color: '#2f5b55' });
    this.ironwork = lambert({ map: T.ironworkTexture(), alphaTest: 0.5, side: THREE.DoubleSide, transparent: false }, { cast: false });
    this.clock = lambert({ map: T.clockTexture() }, { cast: false });

    this.terrain = lambert({ map: T.grassDetailTexture(), vertexColors: true }, { cast: false });
    this.dirt = lambert({ map: T.dirtTexture() }, { cast: false });
    this.gravel = lambert({ map: T.gravelTexture() }, { cast: false });
    this.rail = lambert({ color: '#6d4a35' });
    this.sleeper = lambert({ color: '#5a4834' });
    const corr = T.corrugatedTexture();
    this.corrugated = lambert({ map: corr, side: THREE.DoubleSide });
    this.corrugatedRust = lambert({ map: corr, color: '#b06a45', side: THREE.DoubleSide });
    this.rust = lambert({ color: '#7a4428' });

    this.foliage = ['#4f7a32', '#3f6a2c', '#5f8a3a', '#6b8f36'].map((c) => lambert({ color: c, flatShading: true }));
    this.springLeaf = lambert({ color: '#9cbc4a', flatShading: true });
    this.pine = lambert({ color: '#2f5230', flatShading: true });
    this.bark = lambert({ map: T.barkTexture() });
    this.trunk = lambert({ color: '#5a4330' });

    this.concrete = lambert({ color: '#bdb8ad' });
    this.white = lambert({ color: '#f2f0ea' });
    this.bronze = lambert({ color: '#5b4a35' });
    this.lampGlass = lambert({ color: '#fff3c9', emissive: '#ffd27a', emissiveIntensity: 0.35 });
    this.awnings = ['#b8332a', '#2d6a4f', '#1d4e89', '#d08a1f'].map((c) => lambert({ color: c }));
    const field = T.fieldTexture();
    this.fields = ['#c9ad5a', '#86a64a', '#9a7653', '#b9c25c'].map((c) => lambert({ color: c, map: field }, { cast: false }));
    this.hay = lambert({ color: '#d8bb6a' });
    this.flowers = lambert({ color: '#e7c12c', flatShading: true });
    this.hedge = lambert({ color: '#3e6b2e', flatShading: true });
    this.redPaint = lambert({ color: '#b33228' });
    this.coachGreen = lambert({ color: '#4e6b55' });

    const atlas = facadeStylesTexture();
    this.facadeVC = storeyAtlas(lambert({ map: atlas.map, normalMap: T.normalMapFrom(atlas.relief, 2.5), vertexColors: true }), atlas.mask);
    this.stoneVC = lambert({ map: ashlar, normalMap: ashlarN, vertexColors: true });
    this.roofVC = lambert({ map: tiles, normalMap: tilesN, vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
    this.roofTintVC = lambert({
      map: T.neutralRoofTilesTexture(),
      normalMap: tilesN,
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.8,
    });
    this.corrugatedVC = lambert({ map: corr, vertexColors: true, side: THREE.DoubleSide });
    this.treeVC = lambert({ vertexColors: true, flatShading: true, roughness: 1 });
    this.propsVC = lambert({ vertexColors: true });
    const treeAtlas = T.treeAtlasTexture();
    this.leaves = lambert({ map: treeAtlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
    this.leavesWind = windSway(lambert({ map: treeAtlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }));
    this.leavesDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: treeAtlas, alphaTest: 0.5 });
    this.leaves.userData.depthMaterial = this.leavesDepth;

    for (const [name, value] of Object.entries(this)) {
      if (value instanceof THREE.Material) value.name = name;
      else if (Array.isArray(value))
        value.forEach((m, i) => {
          if (m instanceof THREE.Material) m.name = `${name}${i}`;
        });
    }

    // Fold materials into shared vertex-coloured ones (fewer draw calls).
    const fold = (m: Lambert, target: Lambert, color?: THREE.ColorRepresentation) => {
      m.userData.redirect = { mat: target, color: new THREE.Color(color ?? m.color) };
    };
    fold(this.stone, this.stoneVC, '#ffffff');
    fold(this.plinth, this.stoneVC, '#b8a888');
    fold(this.roof, this.roofVC, '#ffffff');
    fold(this.corrugated, this.corrugatedVC, '#ffffff');
    fold(this.corrugatedRust, this.corrugatedVC, '#c27a52');
    fold(this.wood, this.propsVC, '#8a6440');
    for (const m of [
      this.stoneTrim,
      this.glass,
      this.darkWood,
      this.iron,
      this.ironGreen,
      this.white,
      this.bronze,
      this.lampGlass,
      this.rail,
      this.sleeper,
      this.rust,
      this.trunk,
      this.concrete,
      this.redPaint,
      this.coachGreen,
      this.hay,
      this.flowers,
      this.hedge,
      this.springLeaf,
      this.pine,
      ...this.awnings,
      ...this.foliage,
    ])
      fold(m, this.propsVC);
    this.detail = this.terrain.map!;
    this.roadAtlas = roadAtlasMaterial([this.asphalt.map!, this.sidewalk.map!, this.paving.map!, this.dirt.map!, this.gravel.map!, null]);
    this.glowVC.name = 'glowVC';
    this.glowVC.userData.castShadow = false;
  }

  /** Plain colour, batched into the shared vertex-coloured props material. */
  tint(color: THREE.ColorRepresentation): THREE.Material {
    const key = `t${new THREE.Color(color).getHexString()}`;
    let m = this.tints.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color });
      m.userData.redirect = { mat: this.propsVC, color: new THREE.Color(color) };
      this.tints.set(key, m);
    }
    return m;
  }

  /** Self-lit colour (neon, lit signs, screens), batched into `glowVC`. */
  glow(color: THREE.ColorRepresentation): THREE.Material {
    const key = `g${new THREE.Color(color).getHexString()}`;
    let m = this.tints.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      m.userData.redirect = { mat: this.glowVC, color: new THREE.Color(color) };
      this.tints.set(key, m);
    }
    return m;
  }
}

/**
 * Packs several tiling textures into a 4x2 atlas. Geometry carries world-space
 * UVs plus an `atlasCell` attribute; the shader wraps the UVs inside the
 * chosen cell (with explicit gradients so mipmapping stays seam-free).
 */
function roadAtlasMaterial(tiles: (THREE.Texture | null)[]): Lambert {
  const C = 512;
  const canvas = document.createElement('canvas');
  canvas.width = C * 4;
  canvas.height = C * 2;
  const g = canvas.getContext('2d')!;
  tiles.forEach((t, i) => {
    const x = (i % 4) * C;
    const y = (1 - Math.floor(i / 4)) * C; // UV row 0 is the bottom of the canvas
    if (t) g.drawImage(t.image as CanvasImageSource, x, y, C, C);
    else {
      g.fillStyle = '#f2f2ea';
      g.fillRect(x, y, C, C);
    }
  });
  // Slot 6: red concrete paving, the sidewalk slabs dyed red (the newer streets and car parks).
  g.drawImage(canvas, C, C, C, C, 2 * C, 0, C, C);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = '#c4705f';
  g.fillRect(2 * C, 0, C, C);
  g.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = lambert({ map: tex }, { cast: false });
  m.name = 'roadAtlas';
  m.userData.attributes = ['atlasCell'];
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float atlasCell;\nvarying float vCell;\nvarying vec2 vWorldXZ;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vCell = atlasCell;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vCell;
varying vec2 vWorldXZ;
float rh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh(i), rh(i + vec2(1, 0)), f.x), mix(rh(i + vec2(0, 1)), rh(i + vec2(1, 1)), f.x), f.y);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `float cellI = floor(vCell + 0.5);
  vec2 cell = vec2(mod(cellI, 4.0), floor(cellI / 4.0));
  vec2 scale = vec2(0.25, 0.5) * 0.96;
  vec2 auv = (cell + 0.02) * vec2(0.25, 0.5) + fract(vMapUv) * scale;
  vec4 sampledDiffuseColor = textureGrad(map, auv, dFdx(vMapUv) * scale, dFdy(vMapUv) * scale);
  // Anti-tiling: a second, rotated and larger sample of the same tile, blended by a world-space noise,
  // and slow brightness variation (worn and fresher stretches, damp shade).
  vec2 ruv = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.37 + 0.31;
  vec2 auv2 = (cell + 0.02) * vec2(0.25, 0.5) + fract(ruv) * scale;
  vec4 second = textureGrad(map, auv2, dFdx(ruv) * scale, dFdy(ruv) * scale);
  float n1 = vnoise(vWorldXZ * 0.09);
  float n2 = vnoise(vWorldXZ * 0.021 + 7.3);
  sampledDiffuseColor = mix(sampledDiffuseColor, second, smoothstep(0.35, 0.65, n1) * 0.55);
  sampledDiffuseColor.rgb *= 0.9 + 0.2 * n2 + 0.06 * (n1 - 0.5);
  diffuseColor *= sampledDiffuseColor;`,
      );
  };
  return m;
}

/**
 * Facade shader: UV.y counts storeys from the ground (1 unit = FLOOR_H), so
 * the ground floor (v < 1) samples the right atlas cell (plinth, doorway) and
 * upper storeys the left one (windows). Applied to both colour and normals.
 */
/**
 * Facade material over the style atlas (src/world/facadeStyles.ts). Each vertex carries `fstyle`
 * = style row + 0.5 * a per-building seed. The fragment shader picks the cell of each bay and
 * storey: ground floor door or window (per bay), upper storeys in one of two window variants
 * (per bay column, so balconies stack). Wall pixels (atlas alpha 255) take the building colour
 * from the vertex colour; windows, doors, shutters and railings (alpha 128) keep their own.
 */
function storeyAtlas(m: Lambert, mask: THREE.Texture): Lambert {
  m.userData.attributes = ['fstyle'];
  m.onBeforeCompile = (shader) => {
    shader.uniforms.wallMaskMap = { value: mask };
    shader.uniforms.nightGlow = NIGHT;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float fstyle;\nvarying float vStyle;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStyle = fstyle;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vStyle;
uniform sampler2D wallMaskMap;
uniform float nightGlow;
float h11(float n) { return fract(sin(n * 12.9898 + 4.1) * 43758.5453); }
vec2 storeyCell(vec2 uv) {
  // Interpolation leaves tiny per-pixel errors in the attribute: snap it, or the hashed
  // door/window choice would flip from pixel to pixel.
  float style = floor(vStyle + 0.004);
  float seed = floor((vStyle - style) * 128.0 + 0.5) / 64.0;
  float bay = floor(uv.x);
  float ground = step(uv.y, 0.999);
  float door = step(h11(bay + seed * 57.0), 0.38);
  float variant = step(h11(bay * 1.7 + seed * 13.0 + 3.0), 0.4);
  float cell = ground * (2.0 - door) + (1.0 - ground) * variant * 3.0;
  float v = 1.0 - (style + 1.0) / ${N_STYLES}.0 + (0.01 + fract(uv.y) * 0.98) / ${N_STYLES}.0;
  return vec2((cell + 0.01 + fract(uv.x) * 0.98) / ${N_CELLS}.0, v);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `
  vec2 cellUv = storeyCell(vMapUv);
  vec2 gscale = vec2(0.98 / ${N_CELLS}.0, 0.98 / ${N_STYLES}.0);
  vec4 texel = textureGrad(map, cellUv, dFdx(vMapUv) * gscale, dFdy(vMapUv) * gscale);
  float wallMask = textureGrad(wallMaskMap, cellUv, dFdx(vMapUv) * gscale, dFdy(vMapUv) * gscale).r;
  diffuseColor.rgb *= texel.rgb * mix(vec3(1.0), vColor.rgb, wallMask);`,
      )
      .replace('#include <color_fragment>', '')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  // At night some windows are lit: warm light behind the glass of a random third of them.
  if (nightGlow > 0.01) {
    float lum = dot(texel.rgb, vec3(0.3, 0.59, 0.11));
    float glassPx = (1.0 - wallMask) * step(lum, 0.32) * step(texel.r, texel.b + 0.03);
    vec2 win = floor(vMapUv);
    float lit = step(h11(win.x * 3.17 + win.y * 11.3 + floor(vStyle * 64.0) * 0.71), 0.24);
    totalEmissiveRadiance += vec3(1.0, 0.7, 0.4) * glassPx * lit * nightGlow * 0.75;
  }`,
      )
      .replace(
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        `vec3 mapN = textureGrad( normalMap, storeyCell(vNormalMapUv), dFdx(vNormalMapUv) * vec2(0.98 / ${N_CELLS}.0, 0.98 / ${N_STYLES}.0), dFdy(vNormalMapUv) * vec2(0.98 / ${N_CELLS}.0, 0.98 / ${N_STYLES}.0) ).xyz * 2.0 - 1.0;`,
      );
  };
  return m;
}

/** Crowns bend with the wind: displacement grows with height above the trunk, phase varies per tree. */
function windSway(m: Lambert): Lambert {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  #ifdef USE_INSTANCING
    vec2 treePos = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
  #else
    vec2 treePos = vec2(0.0);
  #endif
  float sway = max(0.0, position.y - 2.0) * 0.045;
  transformed.x += sin(uTime * 1.5 + treePos.x * 0.21 + position.y * 0.35) * sway;
  transformed.z += cos(uTime * 1.2 + treePos.y * 0.17) * sway * 0.7;`,
    );
  };
  return m;
}

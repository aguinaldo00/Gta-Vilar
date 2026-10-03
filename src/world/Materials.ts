import * as THREE from 'three';
import * as T from './textures';

type Lambert = THREE.MeshLambertMaterial;

/** Storey height used for window tiling and default building heights. */
export const FLOOR_H = 3.1;

function lambert(params: THREE.MeshLambertMaterialParameters, shadows: { cast?: boolean; receive?: boolean } = {}): Lambert {
  const m = new THREE.MeshLambertMaterial(params);
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
  readonly corrugatedVC: Lambert;
  readonly treeVC: Lambert;
  /** Every plain-coloured prop material is folded into this one by the batcher. */
  readonly propsVC: Lambert;
  readonly detail: THREE.Texture;
  /** Asphalt, sidewalk, paving, dirt, gravel and paint in one material (one draw call per chunk). */
  readonly roadAtlas: Lambert;

  constructor() {
    const facade = T.facadeTexture();
    this.facades = ['#f2ede2', '#e7d6b4', '#f6f4ef', '#dcc39a', '#e9cdb8', '#d8d0c0'].map((c) => lambert({ color: c, map: facade }));

    const ashlar = T.ashlarTexture();
    this.stone = lambert({ map: ashlar });
    this.stoneTrim = lambert({ color: '#e6d6b0' });
    this.plinth = lambert({ map: ashlar, color: '#b8a888' });

    this.paving = lambert({ map: T.pavingTexture(), color: '#e2ddd3' }, { cast: false });
    this.sidewalk = lambert({ map: T.sidewalkTexture() }, { cast: false });
    this.asphalt = lambert({ map: T.asphaltTexture() }, { cast: false });
    this.marking = lambert({ color: '#efefe6', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, { cast: false });

    this.roof = lambert({ map: T.roofTexture(), side: THREE.DoubleSide });
    this.galeria = lambert({ map: T.galeriaTexture() }, { cast: false });
    this.glass = lambert({ color: '#2a3642' });
    this.darkWood = lambert({ color: '#4a2f1f' });
    this.wood = lambert({ map: T.woodTexture() });
    this.iron = lambert({ color: '#2b2f2e' });
    this.ironGreen = lambert({ color: '#2f5b55' });
    this.ironwork = lambert({ map: T.ironworkTexture(), alphaTest: 0.5, side: THREE.DoubleSide, transparent: false }, { cast: false });
    this.clock = lambert({ map: T.clockTexture() }, { cast: false });

    this.terrain = lambert({ map: T.groundDetailTexture(), vertexColors: true }, { cast: false });
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

    this.facadeVC = lambert({ map: facade, vertexColors: true });
    this.stoneVC = lambert({ map: ashlar, vertexColors: true });
    this.roofVC = lambert({ map: this.roof.map, vertexColors: true, side: THREE.DoubleSide });
    this.corrugatedVC = lambert({ map: corr, vertexColors: true, side: THREE.DoubleSide });
    this.treeVC = lambert({ vertexColors: true, flatShading: true });
    this.propsVC = lambert({ vertexColors: true });

    for (const [name, value] of Object.entries(this)) {
      if (value instanceof THREE.Material) value.name = name;
      else if (Array.isArray(value)) value.forEach((m, i) => m instanceof THREE.Material && (m.name = `${name}${i}`));
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
      this.stoneTrim, this.glass, this.darkWood, this.iron, this.ironGreen, this.white, this.bronze, this.lampGlass,
      this.rail, this.sleeper, this.rust, this.trunk, this.concrete, this.redPaint, this.coachGreen, this.hay,
      this.flowers, this.hedge, this.springLeaf, this.pine, ...this.awnings, ...this.foliage,
    ]) fold(m, this.propsVC);
    this.detail = this.terrain.map!;
    this.roadAtlas = roadAtlasMaterial([this.asphalt.map!, this.sidewalk.map!, this.paving.map!, this.dirt.map!, this.gravel.map!, null]);
  }
}

/**
 * Packs several tiling textures into a 4x2 atlas. Geometry carries world-space
 * UVs plus an `atlasCell` attribute; the shader wraps the UVs inside the
 * chosen cell (with explicit gradients so mipmapping stays seam-free).
 */
function roadAtlasMaterial(tiles: (THREE.Texture | null)[]): Lambert {
  const C = 256;
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
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = lambert({ map: tex }, { cast: false });
  m.name = 'roadAtlas';
  m.userData.attributes = ['atlasCell'];
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float atlasCell;\nvarying float vCell;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vCell = atlasCell;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCell;')
      .replace(
        '#include <map_fragment>',
        `float cellI = floor(vCell + 0.5);
  vec2 cell = vec2(mod(cellI, 4.0), floor(cellI / 4.0));
  vec2 scale = vec2(0.25, 0.5) * 0.96;
  vec2 auv = (cell + 0.02) * vec2(0.25, 0.5) + fract(vMapUv) * scale;
  vec4 sampledDiffuseColor = textureGrad(map, auv, dFdx(vMapUv) * scale, dFdy(vMapUv) * scale);
  diffuseColor *= sampledDiffuseColor;`,
      );
  };
  return m;
}

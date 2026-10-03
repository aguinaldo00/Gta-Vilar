import * as THREE from 'three';
import * as T from './textures';

type Lambert = THREE.MeshLambertMaterial;

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
    this.galeria = lambert({ map: T.galeriaTexture() });
    this.glass = lambert({ color: '#2a3642' });
    this.darkWood = lambert({ color: '#4a2f1f' });
    this.wood = lambert({ map: T.woodTexture() });
    this.iron = lambert({ color: '#2b2f2e' });
    this.ironGreen = lambert({ color: '#2f5b55' });
    this.ironwork = lambert({ map: T.ironworkTexture(), alphaTest: 0.5, side: THREE.DoubleSide, transparent: false });
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
  }
}

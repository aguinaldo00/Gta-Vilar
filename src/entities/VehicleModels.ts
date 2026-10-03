import * as THREE from 'three';
import type { VehicleKind } from './vehicleSpecs';

export interface WheelRig {
  /** Steering pivot (rotates around Y for front wheels). */
  pivot: THREE.Group;
  /** Rolling pivot (rotates around X). */
  spin: THREE.Group;
  front: boolean;
  x: number;
  z: number;
  r: number;
}

export interface VehicleRig {
  root: THREE.Group;
  /** Everything above the wheels; tilted for body roll / pitch. */
  body: THREE.Group;
  wheels: WheelRig[];
  brakeMat: THREE.MeshLambertMaterial;
  driver: THREE.Group;
}

let shared: Record<'tire' | 'glass' | 'dark' | 'chrome' | 'headlight' | 'plate' | 'skin' | 'shirt' | 'hair', THREE.Material> | null = null;

function sharedMats() {
  if (!shared) {
    shared = {
      tire: new THREE.MeshLambertMaterial({ color: '#1c1c1c' }),
      glass: new THREE.MeshLambertMaterial({ color: '#1f2a36', emissive: '#0d1520', emissiveIntensity: 0.3 }),
      dark: new THREE.MeshLambertMaterial({ color: '#2a2a2c' }),
      chrome: new THREE.MeshLambertMaterial({ color: '#c9ccd0' }),
      headlight: new THREE.MeshLambertMaterial({ color: '#fffbe8', emissive: '#fff2c4', emissiveIntensity: 0.6 }),
      plate: new THREE.MeshLambertMaterial({ color: '#f4f4f4' }),
      skin: new THREE.MeshLambertMaterial({ color: '#d9a47e' }),
      shirt: new THREE.MeshLambertMaterial({ color: '#f1f1ec' }),
      hair: new THREE.MeshLambertMaterial({ color: '#2b1d14' }),
    };
  }
  return shared;
}

function box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function wheel(root: THREE.Group, r: number, width: number, rimMat: THREE.Material, front: boolean, x: number, z: number): WheelRig {
  const M = sharedMats();
  const pivot = new THREE.Group();
  pivot.position.set(x, r, z);
  const spin = new THREE.Group();
  pivot.add(spin);
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, 16).rotateZ(Math.PI / 2), M.tire);
  tire.castShadow = true;
  spin.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, width + 0.02, 10).rotateZ(Math.PI / 2), rimMat);
  spin.add(rim);
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, r * 1.15, r * 0.22), rimMat);
  spin.add(spoke);
  root.add(pivot);
  return { pivot, spin, front, x, z, r };
}

/** Low-poly driver bust shown in the seat while the vehicle is driven. */
function driverBust(): THREE.Group {
  const M = sharedMats();
  const g = new THREE.Group();
  box(g, 0.5, 0.55, 0.28, M.shirt, 0, 0.28, 0);
  box(g, 0.28, 0.3, 0.28, M.skin, 0, 0.72, 0);
  box(g, 0.3, 0.1, 0.3, M.hair, 0, 0.9, -0.01);
  g.visible = false;
  return g;
}

function paint(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function brake(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: '#7a0d0d', emissive: '#ff2a1a', emissiveIntensity: 0.15 });
}

function buildSedan(color: string): VehicleRig {
  const M = sharedMats();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const p = paint(color);
  const bm = brake();
  box(body, 1.86, 0.55, 4.4, p, 0, 0.64, 0);
  box(body, 1.62, 0.52, 2.1, M.glass, 0, 1.17, -0.25);
  box(body, 1.66, 0.08, 1.75, p, 0, 1.46, -0.3);
  box(body, 1.66, 0.3, 0.08, p, 0, 1.3, 0.79); // windscreen header
  box(body, 1.9, 0.22, 0.25, M.dark, 0, 0.45, 2.2);
  box(body, 1.9, 0.22, 0.25, M.dark, 0, 0.45, -2.2);
  for (const s of [-1, 1]) {
    box(body, 0.38, 0.14, 0.05, M.headlight, s * 0.6, 0.74, 2.2);
    box(body, 0.42, 0.14, 0.05, bm, s * 0.6, 0.76, -2.2);
    box(body, 0.12, 0.1, 0.2, p, s * 0.98, 1.0, 0.75);
    box(body, 0.02, 0.04, 2.0, M.chrome, s * 0.935, 0.66, 0);
  }
  box(body, 0.7, 0.14, 0.04, M.dark, 0, 0.62, 2.22);
  box(body, 0.52, 0.12, 0.03, M.plate, 0, 0.45, 2.34);
  box(body, 0.52, 0.12, 0.03, M.plate, 0, 0.45, -2.34);
  const rim = M.chrome;
  const wheels = [
    wheel(root, 0.36, 0.26, rim, true, 0.8, 1.35),
    wheel(root, 0.36, 0.26, rim, true, -0.8, 1.35),
    wheel(root, 0.36, 0.26, rim, false, 0.8, -1.35),
    wheel(root, 0.36, 0.26, rim, false, -0.8, -1.35),
  ];
  const driver = driverBust();
  driver.position.set(0.38, 0.55, -0.15);
  body.add(driver);
  return { root, body, wheels, brakeMat: bm, driver };
}

function buildVan(color: string): VehicleRig {
  const M = sharedMats();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const p = paint(color);
  const bm = brake();
  box(body, 2.0, 1.55, 4.8, p, 0, 1.15, -0.05);
  box(body, 1.98, 0.5, 0.9, p, 0, 0.62, 2.0); // bonnet
  box(body, 1.84, 0.62, 0.08, M.glass, 0, 1.5, 2.36);
  for (const s of [-1, 1]) {
    box(body, 0.04, 0.55, 1.0, M.glass, s * 1.0, 1.5, 1.55);
    box(body, 0.34, 0.16, 0.05, M.headlight, s * 0.68, 0.72, 2.46);
    box(body, 0.24, 0.3, 0.05, bm, s * 0.82, 0.95, -2.46);
    box(body, 0.12, 0.12, 0.22, M.dark, s * 1.08, 1.45, 1.9);
    box(body, 0.02, 0.18, 3.0, paint('#1d4e89'), s * 1.005, 1.05, -0.6); // livery stripe
  }
  box(body, 2.04, 0.22, 0.25, M.dark, 0, 0.45, 2.45);
  box(body, 2.04, 0.22, 0.25, M.dark, 0, 0.45, -2.5);
  box(body, 0.52, 0.12, 0.03, M.plate, 0, 0.45, 2.59);
  const rim = M.chrome;
  const wheels = [
    wheel(root, 0.38, 0.28, rim, true, 0.86, 1.6),
    wheel(root, 0.38, 0.28, rim, true, -0.86, 1.6),
    wheel(root, 0.38, 0.28, rim, false, 0.86, -1.5),
    wheel(root, 0.38, 0.28, rim, false, -0.86, -1.5),
  ];
  const driver = driverBust();
  driver.position.set(0.42, 0.95, 1.2);
  body.add(driver);
  return { root, body, wheels, brakeMat: bm, driver };
}

function buildTractor(color: string): VehicleRig {
  const M = sharedMats();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const p = paint(color);
  const bm = brake();
  const yellow = paint('#e3b622');
  box(body, 0.8, 0.6, 2.8, M.dark, 0, 0.95, 0.25); // chassis
  box(body, 0.86, 0.78, 1.6, p, 0, 1.3, 1.0); // bonnet
  box(body, 0.8, 0.6, 0.06, M.dark, 0, 1.25, 1.82); // grille
  for (const s of [-1, 1]) box(body, 0.16, 0.12, 0.05, M.headlight, s * 0.28, 1.5, 1.82);
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 8), M.dark);
  exhaust.position.set(0.3, 2.15, 1.35);
  body.add(exhaust);
  // Cab: floor, four posts, roof, front glass.
  box(body, 1.4, 0.14, 1.4, M.dark, 0, 1.25, -0.55);
  for (const [px, pz] of [[-0.65, 0.1], [0.65, 0.1], [-0.65, -1.2], [0.65, -1.2]]) box(body, 0.08, 1.55, 0.08, M.dark, px, 2.05, pz);
  box(body, 1.5, 0.12, 1.55, p, 0, 2.85, -0.55);
  const cabGlass = new THREE.MeshLambertMaterial({ color: '#9fb6c8', transparent: true, opacity: 0.35 });
  box(body, 1.25, 1.1, 0.03, cabGlass, 0, 2.15, 0.1);
  box(body, 0.6, 0.12, 0.55, M.dark, 0, 1.55, -0.75); // seat
  for (const s of [-1, 1]) {
    box(body, 0.6, 0.12, 1.6, p, s * 0.9, 1.75, -0.7); // rear fenders
    box(body, 0.14, 0.18, 0.05, bm, s * 0.95, 1.6, -1.52);
  }
  const wheels = [
    wheel(root, 0.46, 0.3, yellow, true, 0.74, 1.35),
    wheel(root, 0.46, 0.3, yellow, true, -0.74, 1.35),
    wheel(root, 0.82, 0.48, yellow, false, 0.9, -0.7),
    wheel(root, 0.82, 0.48, yellow, false, -0.9, -0.7),
  ];
  const driver = driverBust();
  driver.position.set(0, 1.62, -0.6);
  body.add(driver);
  return { root, body, wheels, brakeMat: bm, driver };
}

export function buildVehicleModel(kind: VehicleKind, color: string): VehicleRig {
  const rig = kind === 'sedan' ? buildSedan(color) : kind === 'van' ? buildVan(color) : buildTractor(color);
  rig.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return rig;
}

import * as THREE from 'three';

const MAX = 700;

/** Ring buffer of tyre-mark quads drawn with a single InstancedMesh. */
export class SkidMarks {
  private readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: '#151515',
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  add(x0: number, z0: number, x1: number, z1: number, y: number, width: number): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    this.p.set((x0 + x1) / 2, y + 0.02, (z0 + z1) / 2);
    this.q.setFromAxisAngle(this.up, Math.atan2(dx, dz));
    this.s.set(width, 1, len + 0.05);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(this.next, this.m);
    this.next = (this.next + 1) % MAX;
    this.mesh.count = Math.min(this.mesh.count + 1, MAX);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

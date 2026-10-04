import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Breakables } from '@/world/Breakables';

describe('breakable street furniture', () => {
  const make = () => {
    const b = new Breakables();
    const geo = new THREE.BoxGeometry(0.1, 2, 0.1);
    const mat = new THREE.MeshBasicMaterial();
    b.add(10, 0, 0, 0, 0.1, [{ key: 'post', geo, mat, local: new THREE.Matrix4().makeTranslation(0, 1, 0) }]);
    const scene = new THREE.Scene();
    b.finish(scene);
    const mesh = scene.children[0] as THREE.InstancedMesh;
    const top = () => {
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(0, m);
      return new THREE.Vector3(0, 1, 0).applyMatrix4(m);
    };
    return { b, top };
  };

  it('a car running into a sign knocks it over the way it was going, and loses a little speed', () => {
    const { b, top } = make();
    expect(top().y).toBeCloseTo(2, 3);
    const car = { x: 9.5, z: 0, vx: 10, vz: 0, radius: 2.2, speed: 10, impact: 0 };
    for (let i = 0; i < 40; i++) b.update(1 / 60, [car]);
    expect(top().y).toBeLessThan(0.5);
    expect(top().x).toBeGreaterThan(11);
    expect(car.speed).toBeLessThan(10);
  });

  it('a parked or crawling car leaves it standing', () => {
    const { b, top } = make();
    for (let i = 0; i < 40; i++) b.update(1 / 60, [{ x: 9.5, z: 0, vx: 0.5, vz: 0, radius: 2.2, speed: 0.5, impact: 0 }]);
    expect(top().y).toBeCloseTo(2, 3);
  });
});
